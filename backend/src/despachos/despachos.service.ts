import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Trazabilidad de despachos internos.
//
// El portal NO registra guías nuevas: trabaja sobre las guías de despacho
// internas que ya existen en el sistema (licitacion_documentos con
// tipo = 'guia_despacho' y empresa_despacho = 'Despacho interno').
//
// Cada guía interna es un "despacho". La tabla `despachos` guarda el
// seguimiento (estado, evidencia, firma) y se crea on-demand la primera vez
// que se interviene una guía. Todo se referencia por licitacion_documento_id.

const BUCKET = 'despachos';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
const SIGNED_URL_TTL = 3600; // 1h

const ESTADOS = ['Preparación', 'En ruta', 'Entregado', 'No entregado'];

function esInterno(empresa: any): boolean {
  return String(empresa || '').trim().toLowerCase() === 'despacho interno';
}

function nombreSeguro(nombre: string): string {
  return String(nombre || 'archivo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

@Injectable()
export class DespachosService {
  constructor(private supabase: SupabaseService) {}

  private get client() {
    return this.supabase.getClient();
  }

  private async urlFirmada(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    return data?.signedUrl || null;
  }

  // ── Listado: todas las guías de despacho internas + su seguimiento.
  async listar() {
    const { data: docs, error } = await this.client
      .from('licitacion_documentos')
      .select('id, licitacion_id, tipo, numero, fecha_oc, monto, empresa_despacho, n_seguimiento, created_at')
      .eq('tipo', 'guia_despacho')
      .order('created_at', { ascending: false })
      .limit(800);
    if (error) throw new BadRequestException(error.message);

    const internas = (docs || []).filter((d: any) => esInterno(d.empresa_despacho));
    if (internas.length === 0) return [];

    // Cotizaciones asociadas.
    const licIds = [...new Set(internas.map((d: any) => d.licitacion_id).filter(Boolean))];
    const { data: lics } = licIds.length
      ? await this.client
          .from('licitaciones')
          .select('id, id_licitacion, nombre, nombre_entidad, comuna')
          .in('id', licIds)
      : { data: [] as any[] };
    const licMap = new Map((lics || []).map((l: any) => [l.id, l]));

    // Seguimiento existente.
    const docIds = internas.map((d: any) => d.id);
    const { data: tracks } = await this.client
      .from('despachos')
      .select('licitacion_documento_id, estado, firma_path, entregado_at')
      .in('licitacion_documento_id', docIds);
    const trackMap = new Map(
      (tracks || []).map((t: any) => [t.licitacion_documento_id, t]),
    );

    return internas.map((d: any) => {
      const lic: any = licMap.get(d.licitacion_id) || {};
      const tr: any = trackMap.get(d.id);
      return {
        documento_id: d.id,
        numero_guia: d.numero || null,
        fecha_guia: d.fecha_oc || null,
        monto: d.monto || null,
        licitacion_id: d.licitacion_id || null,
        id_licitacion: lic.id_licitacion || null,
        cliente_nombre: lic.nombre_entidad || lic.nombre || null,
        comuna: lic.comuna || null,
        estado: tr?.estado || 'Preparación',
        tiene_firma: Boolean(tr?.firma_path),
        tiene_seguimiento: Boolean(tr),
        entregado_at: tr?.entregado_at || null,
        created_at: d.created_at,
      };
    });
  }

  // ── Detalle de una guía interna (por id del documento).
  async obtener(docIdRaw: string) {
    const docId = Number(docIdRaw);
    if (!docId || Number.isNaN(docId)) {
      throw new BadRequestException('Identificador de guía no válido.');
    }

    const { data: guia, error } = await this.client
      .from('licitacion_documentos')
      .select('*')
      .eq('id', docId)
      .single();
    if (error || !guia) throw new NotFoundException('Guía de despacho no encontrada.');
    if (guia.tipo !== 'guia_despacho' || !esInterno(guia.empresa_despacho)) {
      throw new BadRequestException('La guía indicada no es un despacho interno.');
    }

    const { data: lic } = await this.client
      .from('licitaciones')
      .select('id, id_licitacion, nombre, nombre_entidad, comuna, region, estado')
      .eq('id', guia.licitacion_id)
      .maybeSingle();

    const { data: tr } = await this.client
      .from('despachos')
      .select('*')
      .eq('licitacion_documento_id', docId)
      .maybeSingle();

    let archivos: any[] = [];
    let eventos: any[] = [];
    if (tr) {
      const [archRes, evtRes] = await Promise.all([
        this.client
          .from('despacho_archivos')
          .select('*')
          .eq('despacho_id', tr.id)
          .order('created_at', { ascending: false }),
        this.client
          .from('despacho_eventos')
          .select('*')
          .eq('despacho_id', tr.id)
          .order('created_at', { ascending: true }),
      ]);
      archivos = await Promise.all(
        (archRes.data || []).map(async (a: any) => ({
          ...a,
          url: await this.urlFirmada(a.storage_path),
        })),
      );
      eventos = evtRes.data || [];
    }

    return {
      guia: {
        id: guia.id,
        numero: guia.numero || null,
        fecha_oc: guia.fecha_oc || null,
        monto: guia.monto || null,
        empresa_despacho: guia.empresa_despacho || null,
        n_seguimiento: guia.n_seguimiento || null,
        created_at: guia.created_at,
      },
      licitacion: lic || null,
      despacho: {
        estado: tr?.estado || 'Preparación',
        receptor_nombre: tr?.receptor_nombre || null,
        receptor_rut: tr?.receptor_rut || null,
        firma_url: tr ? await this.urlFirmada(tr.firma_path) : null,
        firma_at: tr?.firma_at || null,
        entregado_at: tr?.entregado_at || null,
        tiene_seguimiento: Boolean(tr),
      },
      archivos,
      eventos,
    };
  }

  // ── Obtiene (o crea) la fila de seguimiento de una guía interna.
  private async asegurarDespacho(docIdRaw: string | number, autorEmail: string) {
    const docId = Number(docIdRaw);
    if (!docId || Number.isNaN(docId)) {
      throw new BadRequestException('Identificador de guía no válido.');
    }

    const existente = await this.client
      .from('despachos')
      .select('*')
      .eq('licitacion_documento_id', docId)
      .maybeSingle();
    if (existente.data) return existente.data;

    // Validar que el documento sea efectivamente una guía interna.
    const { data: guia } = await this.client
      .from('licitacion_documentos')
      .select('id, tipo, empresa_despacho')
      .eq('id', docId)
      .single();
    if (!guia || guia.tipo !== 'guia_despacho' || !esInterno(guia.empresa_despacho)) {
      throw new BadRequestException('La guía indicada no es un despacho interno.');
    }

    const { data: nuevo, error } = await this.client
      .from('despachos')
      .insert([
        {
          licitacion_documento_id: docId,
          estado: 'Preparación',
          creado_por: autorEmail || null,
        },
      ])
      .select()
      .single();
    if (error) {
      // Posible carrera: otra petición lo creó entremedio.
      const retry = await this.client
        .from('despachos')
        .select('*')
        .eq('licitacion_documento_id', docId)
        .maybeSingle();
      if (retry.data) return retry.data;
      throw new BadRequestException(error.message);
    }
    return nuevo;
  }

  // ── Cambio de estado del despacho (con bitácora).
  async cambiarEstado(
    docId: string,
    estado: string,
    nota: string,
    autorEmail: string,
  ) {
    const nuevo = (estado || '').trim();
    if (!ESTADOS.includes(nuevo)) {
      throw new BadRequestException(`Estado no válido: ${estado}`);
    }

    const tr = await this.asegurarDespacho(docId, autorEmail);

    const ahora = new Date().toISOString();
    const patch: Record<string, any> = { estado: nuevo, actualizado_at: ahora };
    if (nuevo === 'Entregado') patch.entregado_at = ahora;

    const { error } = await this.client
      .from('despachos')
      .update(patch)
      .eq('id', tr.id);
    if (error) throw new BadRequestException(error.message);

    await this.client.from('despacho_eventos').insert([
      {
        despacho_id: tr.id,
        estado: nuevo,
        nota: (nota || '').toString().trim() || `Estado cambiado a ${nuevo}.`,
        autor: autorEmail || null,
      },
    ]);

    return { ok: true };
  }

  // ── Subida de un adjunto (foto, PDF u otro).
  async subirArchivo(docId: string, file: Express.Multer.File, autorEmail: string) {
    if (!file) throw new BadRequestException('Falta el archivo.');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `El archivo supera el máximo permitido (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`,
      );
    }

    const tr = await this.asegurarDespacho(docId, autorEmail);

    const mime = file.mimetype || 'application/octet-stream';
    let tipo: 'foto' | 'pdf' | 'otro' = 'otro';
    if (mime.startsWith('image/')) tipo = 'foto';
    else if (mime === 'application/pdf') tipo = 'pdf';

    const safe = nombreSeguro(file.originalname);
    const storagePath = `${tr.id}/${Date.now()}_${safe}`;

    const { error: errUp } = await this.client.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, { contentType: mime, upsert: false });
    if (errUp) throw new BadRequestException(`No se pudo subir: ${errUp.message}`);

    const { data: archivo, error } = await this.client
      .from('despacho_archivos')
      .insert([
        {
          despacho_id: tr.id,
          tipo,
          storage_path: storagePath,
          nombre: file.originalname || safe,
          mime,
          tamano: file.size,
          subido_por: autorEmail || null,
        },
      ])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    return { ok: true, archivo: { ...archivo, url: await this.urlFirmada(storagePath) } };
  }

  // ── Guardado de la firma de recepción (PNG dibujado en pantalla).
  async guardarFirma(
    docId: string,
    dto: { firma?: string; receptor_nombre?: string; receptor_rut?: string },
    autorEmail: string,
  ) {
    const raw = (dto?.firma || '').toString();
    const match = raw.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new BadRequestException('Firma inválida.');
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('La firma es demasiado grande.');
    }

    const tr = await this.asegurarDespacho(docId, autorEmail);

    const storagePath = `${tr.id}/firma_${Date.now()}.png`;
    const { error: errUp } = await this.client.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: 'image/png', upsert: false });
    if (errUp) {
      throw new BadRequestException(`No se pudo guardar la firma: ${errUp.message}`);
    }

    const ahora = new Date().toISOString();
    const { error } = await this.client
      .from('despachos')
      .update({
        firma_path: storagePath,
        firma_at: ahora,
        receptor_nombre: (dto?.receptor_nombre || '').toString().trim() || null,
        receptor_rut: (dto?.receptor_rut || '').toString().trim() || null,
        actualizado_at: ahora,
      })
      .eq('id', tr.id);
    if (error) throw new BadRequestException(error.message);

    await this.client.from('despacho_eventos').insert([
      {
        despacho_id: tr.id,
        estado: null,
        nota: `Firma de recepción registrada${
          dto?.receptor_nombre ? ` (${dto.receptor_nombre})` : ''
        }.`,
        autor: autorEmail || null,
      },
    ]);

    return { ok: true, firma_url: await this.urlFirmada(storagePath) };
  }
}
