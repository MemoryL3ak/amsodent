import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import * as crypto from 'crypto';

const PORTAL_BUCKET_DEFAULT = 'portal-cliente';
const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

// Tipos de documento que el cliente puede subir desde el portal.
// Para tipos "internos" (OC/Guía/Factura) usamos el mismo bucket que la app
// para que aparezcan automáticamente en Trazabilidad. Para "otro" usamos un
// bucket dedicado del portal.
const TIPOS_PERMITIDOS: Record<string, { bucket: string; label: string }> = {
  orden_compra: { bucket: 'orden-compra', label: 'Orden de Compra' },
  guia_despacho: { bucket: 'guia-despacho', label: 'Guía de Despacho' },
  factura: { bucket: 'factura', label: 'Factura' },
  otro: { bucket: PORTAL_BUCKET_DEFAULT, label: 'Otro documento' },
};

function base64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecodeToString(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

function normalizarRut(input: string): string {
  // Deja sólo dígitos y K, en minúscula. Quita puntos, guiones y espacios.
  return String(input || '').toLowerCase().replace(/[^0-9k]/g, '');
}

@Injectable()
export class PortalService {
  constructor(private supabase: SupabaseService) {}

  private get secret(): string {
    return process.env.PORTAL_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret';
  }

  signToken(payload: Record<string, any>): string {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const fullPayload = { ...payload, exp };
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerEnc = base64urlEncode(JSON.stringify(header));
    const payloadEnc = base64urlEncode(JSON.stringify(fullPayload));
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerEnc}.${payloadEnc}`)
      .digest();
    return `${headerEnc}.${payloadEnc}.${base64urlEncode(signature)}`;
  }

  verifyToken(token: string): { licitacion_id: number; id_licitacion: string; rut: string; exp: number } | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerEnc, payloadEnc, sigEnc] = parts;
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerEnc}.${payloadEnc}`)
      .digest();
    const got = Buffer.from(sigEnc.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
    try {
      const payload = JSON.parse(base64urlDecodeToString(payloadEnc));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  // ── Login: RUT + id_licitacion (case-insensitive sobre id_licitacion).
  async login(rut: string, idLicitacion: string) {
    const rutN = normalizarRut(rut);
    const idLic = String(idLicitacion || '').trim();
    if (!rutN || !idLic) {
      throw new BadRequestException('Debe ingresar RUT y N° de cotización.');
    }

    const { data, error } = await this.supabase.getClient()
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, rut_entidad, estado')
      .ilike('id_licitacion', idLic)
      .limit(1);

    if (error) throw new BadRequestException(error.message);
    if (!data || data.length === 0) {
      throw new UnauthorizedException('No encontramos una cotización con esos datos.');
    }

    const lic = data[0];
    if (normalizarRut(lic.rut_entidad) !== rutN) {
      throw new UnauthorizedException('No encontramos una cotización con esos datos.');
    }

    const token = this.signToken({
      licitacion_id: Number(lic.id),
      id_licitacion: lic.id_licitacion,
      rut: rutN,
    });

    return {
      token,
      licitacion: {
        id: lic.id,
        id_licitacion: lic.id_licitacion,
        nombre_entidad: lic.nombre_entidad,
      },
    };
  }

  // ── Detalle completo de la cotización (lo que ve el cliente).
  async getCotizacion(licitacionId: number) {
    const client = this.supabase.getClient();

    const { data: lic, error } = await client
      .from('licitaciones')
      .select('*')
      .eq('id', licitacionId)
      .single();

    if (error || !lic) throw new BadRequestException('Cotización no disponible.');

    // Productos asociados
    const { data: productos } = await client
      .from('licitacion_productos')
      .select('*')
      .eq('licitacion_id', licitacionId);

    return { licitacion: lic, productos: productos || [] };
  }

  // ── Documentos de la cotización (sus subidos + los nuestros).
  // Reintenta sin la columna `descripcion` si todavía no se ejecutó la migración,
  // así el portal sigue funcionando aunque falte el schema.
  async getDocumentos(licitacionId: number) {
    const client = this.supabase.getClient();
    const baseCols = 'id, tipo, numero, fecha_oc, monto, storage_path, bucket, subido_por_cliente, empresa_despacho, n_seguimiento, created_at, deriva_de_id';
    const withDesc = `${baseCols}, descripcion`;

    let { data, error } = await client
      .from('licitacion_documentos')
      .select(withDesc)
      .eq('licitacion_id', licitacionId)
      .order('created_at', { ascending: false });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      // Fallback: schema no actualizado todavía (descripcion o subido_por_cliente)
      if (msg.includes('descripcion') || msg.includes('subido_por_cliente')) {
        const safeCols = 'id, tipo, numero, fecha_oc, monto, storage_path, bucket, empresa_despacho, n_seguimiento, created_at, deriva_de_id';
        const r2 = await client
          .from('licitacion_documentos')
          .select(safeCols)
          .eq('licitacion_id', licitacionId)
          .order('created_at', { ascending: false });
        if (r2.error) throw new BadRequestException(r2.error.message);
        return (r2.data || []).map((d: any) => ({ ...d, subido_por_cliente: false, descripcion: null }));
      }
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  // ── URL firmada para descargar/visualizar un documento (cliente o nuestro).
  async getSignedUrlDoc(licitacionId: number, docId: number, expiresIn = 3600) {
    const client = this.supabase.getClient();
    const { data: doc, error } = await client
      .from('licitacion_documentos')
      .select('id, licitacion_id, bucket, storage_path')
      .eq('id', docId)
      .single();
    if (error || !doc) throw new BadRequestException('Documento no encontrado.');
    if (Number(doc.licitacion_id) !== Number(licitacionId)) {
      throw new UnauthorizedException('Documento ajeno a la cotización.');
    }
    if (!doc.bucket || !doc.storage_path) {
      throw new BadRequestException('Documento sin archivo asociado.');
    }
    const { data: signed, error: e2 } = await client
      .storage.from(doc.bucket)
      .createSignedUrl(doc.storage_path, expiresIn);
    if (e2) throw new BadRequestException(e2.message);
    return signed;
  }

  // ── Subida desde el portal: tipo + archivo + número y descripción opcionales.
  async uploadDocumento(
    licitacionId: number,
    file: Express.Multer.File,
    opts: { tipo?: string; numero?: string; descripcion?: string },
    actorRut: string,
  ) {
    if (!file) throw new BadRequestException('Falta el archivo.');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`El archivo supera el máximo permitido (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`);
    }

    const tipoIn = String(opts?.tipo || 'otro').toLowerCase().trim();
    const cfg = TIPOS_PERMITIDOS[tipoIn];
    if (!cfg) {
      throw new BadRequestException(`Tipo de documento no válido: ${tipoIn}`);
    }
    const tipoFinal = tipoIn === 'otro' ? 'portal_cliente' : tipoIn;
    const bucket = cfg.bucket;

    const client = this.supabase.getClient();

    // Verificar que la licitación existe y rescatar creado_por para notificar.
    const { data: lic, error: errLic } = await client
      .from('licitaciones')
      .select('id, id_licitacion, creado_por, nombre_entidad')
      .eq('id', licitacionId)
      .single();
    if (errLic || !lic) throw new BadRequestException('Cotización no disponible.');

    const safeName = (file.originalname || 'archivo')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    const ts = Date.now();
    const storagePath = `${licitacionId}/${ts}_${safeName}`;

    const { error: errUp } = await client.storage
      .from(bucket)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: false,
      });
    if (errUp) throw new BadRequestException(`No se pudo subir: ${errUp.message}`);

    const numeroLimpio = (opts?.numero || '').toString().trim().slice(0, 80) || null;
    const descLimpia = (opts?.descripcion || '').toString().trim().slice(0, 500) || null;

    const fileName = file.originalname || safeName;

    const { data: docInsert, error: errIns } = await client
      .from('licitacion_documentos')
      .insert([{
        licitacion_id: licitacionId,
        tipo: tipoFinal,
        numero: numeroLimpio,
        fecha_oc: null,
        monto: null,
        bucket,
        storage_path: storagePath,
        file_name: fileName,
        descripcion: descLimpia,
        subido_por_cliente: true,
      }])
      .select()
      .single();

    if (errIns) throw new BadRequestException(errIns.message);

    // Notificación in-app al vendedor de la licitación + un admin de respaldo.
    // Email normalizado a lowercase para que matchee con el listado (que también
    // hace lowercase en notificaciones.controller).
    const destinatarios = new Set<string>();
    if (lic.creado_por) {
      destinatarios.add(String(lic.creado_por).trim().toLowerCase());
    }
    // Notificar también a todos los admins para que nadie se pierda el aviso.
    const { data: admins } = await client
      .from('profiles')
      .select('email')
      .in('rol', ['admin', 'administrador']);
    (admins || []).forEach((a: any) => {
      if (a?.email) destinatarios.add(String(a.email).trim().toLowerCase());
    });

    if (destinatarios.size > 0) {
      const etiqueta = cfg.label;
      const mensaje = `${lic.nombre_entidad || 'El cliente'} subió ${etiqueta}${numeroLimpio ? ` ${numeroLimpio}` : ''} en la cotización ${lic.id_licitacion}.`;
      const rows = Array.from(destinatarios).map((user_email) => ({
        user_email,
        tipo: 'portal_upload',
        mensaje,
        link: `/trazabilidad?licitacion=${lic.id}`,
        metadata: {
          licitacion_id: lic.id,
          id_licitacion: lic.id_licitacion,
          documento_id: docInsert?.id,
          tipo: tipoFinal,
          numero: numeroLimpio,
          subido_por_rut: actorRut,
        },
      }));
      const { error: errNotif } = await client.from('notificaciones').insert(rows);
      if (errNotif) {
        // No bloqueamos la subida si la notificación falla, pero lo logueamos.
        console.error('[PortalService] No se pudo crear notificación:', errNotif.message);
      }
    }

    return { ok: true, documento: docInsert };
  }
}
