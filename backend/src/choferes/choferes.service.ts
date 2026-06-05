import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { plantillaBienvenidaChofer } from '../correos/correos.templates';

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ESTADOS = ['Asignado', 'En ruta', 'Entregado', 'No entregado', 'Cancelado'];
const ESTADOS_ACTIVOS = ['Asignado', 'En ruta'];
// Estados que el propio chofer puede fijar desde su portal.
const ESTADOS_CHOFER = ['En ruta', 'Entregado', 'No entregado'];
// Un chofer se considera "online" si reportó presencia hace < 100s.
const ONLINE_WINDOW_SECONDS = 100;

export type ChoferTokenPayload = {
  chofer_id: string;
  rut: string;
  nombre: string;
  exp: number;
};

function base64urlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecodeToString(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

// Normaliza un RUT chileno: minúsculas, sólo dígitos + 'k'.
function normalizarRut(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^0-9k]/g, '');
}

// Validación de RUT chileno (formato + dígito verificador).
function esRutValido(rutNorm: string): boolean {
  if (!rutNorm || rutNorm.length < 2) return false;
  const cuerpo = rutNorm.slice(0, -1);
  const dv = rutNorm.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  const dvCalc = resto === 11 ? '0' : resto === 10 ? 'k' : String(resto);
  return dv === dvCalc;
}

// Formatea el RUT normalizado: 12.345.678-9
function formatearRut(rutNorm: string): string {
  if (!rutNorm) return '';
  const cuerpo = rutNorm.slice(0, -1);
  const dv = rutNorm.slice(-1).toUpperCase();
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${conPuntos}-${dv}`;
}

// Contraseñas con scrypt (sin dependencias nativas). Formato scrypt$salt$hash.
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(plain: string, stored?: string | null): boolean {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const got = crypto.scryptSync(String(plain), salt, expected.length);
    return expected.length === got.length && crypto.timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

function calcularExpira(vigencia: string): {
  vigencia: '1m' | '3m' | 'indefinido';
  expira: string | null;
} {
  const v = String(vigencia || '').trim();
  if (v === 'indefinido') return { vigencia: 'indefinido', expira: null };
  if (v === '1m' || v === '3m') {
    const d = new Date();
    d.setMonth(d.getMonth() + (v === '1m' ? 1 : 3));
    return { vigencia: v, expira: d.toISOString() };
  }
  throw new BadRequestException('Vigencia inválida. Use 1m, 3m o indefinido.');
}

function vigenciaTexto(vigencia?: string | null): string {
  if (vigencia === '1m') return '1 mes';
  if (vigencia === '3m') return '3 meses';
  return 'Acceso indefinido';
}

function esInterno(empresa: any): boolean {
  return String(empresa || '').trim().toLowerCase() === 'despacho interno';
}

// ── Fotos del despacho (bucket privado, URLs firmadas) ──────────────────
const BUCKET_VIAJES = 'viajes';
const MAX_FOTO_BYTES = 20 * 1024 * 1024; // 20MB
const FOTO_URL_TTL = 3600; // 1h

function nombreSeguro(nombre: string): string {
  return String(nombre || 'foto')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

@Injectable()
export class ChoferesService {
  private readonly logger = new Logger(ChoferesService.name);

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
  ) {}

  private get client() {
    return this.supabase.getClient();
  }

  private get secret(): string {
    return (
      process.env.PORTAL_CHOFER_JWT_SECRET ||
      process.env.PORTAL_JWT_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      'dev-secret-chofer'
    );
  }

  // ── Token del portal del chofer ───────────────────────────────────────
  private signToken(payload: Omit<ChoferTokenPayload, 'exp'>): string {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const full = { ...payload, exp };
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerEnc = base64urlEncode(JSON.stringify(header));
    const payloadEnc = base64urlEncode(JSON.stringify(full));
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerEnc}.${payloadEnc}`)
      .digest();
    return `${headerEnc}.${payloadEnc}.${base64urlEncode(signature)}`;
  }

  verifyToken(token: string): ChoferTokenPayload | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerEnc, payloadEnc, sigEnc] = parts;
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerEnc}.${payloadEnc}`)
      .digest();
    const got = Buffer.from(sigEnc.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
      return null;
    }
    try {
      const payload = JSON.parse(base64urlDecodeToString(payloadEnc));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  // ── Admin: CRUD de choferes ───────────────────────────────────────────
  async listarChoferes() {
    const { data, error } = await this.client
      .from('choferes')
      .select(
        'id, rut, nombre, telefono, email, patente, activo, acceso_habilitado, acceso_vigencia, acceso_expira, password_temporal, ultimo_acceso, created_at',
      )
      .order('nombre', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((c: any) => ({
      ...c,
      rut_formateado: formatearRut(normalizarRut(c.rut)),
      acceso_vigente:
        !!c.acceso_habilitado &&
        (!c.acceso_expira || new Date(c.acceso_expira).getTime() >= Date.now()),
    }));
  }

  async crearChofer(body: {
    nombre?: string;
    rut?: string;
    telefono?: string;
    email?: string;
    patente?: string;
  }) {
    const nombre = String(body?.nombre || '').trim();
    const rutN = normalizarRut(body?.rut || '');
    if (!nombre) throw new BadRequestException('El nombre del chofer es obligatorio.');
    if (!rutN || !esRutValido(rutN)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }
    const email = String(body?.email || '').trim().toLowerCase() || null;
    if (email && !RE_EMAIL.test(email)) {
      throw new BadRequestException('El correo del chofer no es válido.');
    }
    const { data, error } = await this.client
      .from('choferes')
      .insert({
        rut: rutN,
        nombre,
        telefono: String(body?.telefono || '').trim() || null,
        email,
        patente: String(body?.patente || '').trim().toUpperCase() || null,
      })
      .select()
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        throw new BadRequestException('Ya existe un chofer con ese RUT.');
      }
      throw new BadRequestException(error.message);
    }
    return { ...data, rut_formateado: formatearRut(rutN) };
  }

  async actualizarChofer(id: string, body: any) {
    const patch: any = { updated_at: new Date().toISOString() };
    if (body?.nombre !== undefined) patch.nombre = String(body.nombre || '').trim();
    if (body?.telefono !== undefined) patch.telefono = String(body.telefono || '').trim() || null;
    if (body?.email !== undefined) {
      const email = String(body.email || '').trim().toLowerCase() || null;
      if (email && !RE_EMAIL.test(email)) {
        throw new BadRequestException('El correo del chofer no es válido.');
      }
      patch.email = email;
    }
    if (body?.patente !== undefined) patch.patente = String(body.patente || '').trim().toUpperCase() || null;
    if (body?.activo !== undefined) patch.activo = !!body.activo;
    const { data, error } = await this.client
      .from('choferes')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async desactivarChofer(id: string) {
    const ahora = new Date().toISOString();
    const { error } = await this.client
      .from('choferes')
      .update({ activo: false, acceso_habilitado: false, updated_at: ahora })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  private async buscarChofer(opts: { id?: string; rut?: string }) {
    let q = this.client.from('choferes').select('*');
    if (opts.id) q = q.eq('id', opts.id);
    else if (opts.rut) q = q.eq('rut', normalizarRut(opts.rut));
    else throw new BadRequestException('Falta el identificador del chofer.');
    const { data, error } = await q.maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data as any;
  }

  // ── Admin: habilitación de acceso al portal ───────────────────────────
  async habilitarAcceso(opts: {
    chofer_id?: string;
    rut?: string;
    password: string;
    vigencia: string;
    adminEmail?: string | null;
  }) {
    const password = String(opts.password || '');
    if (password.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
    }
    const chofer = await this.buscarChofer({ id: opts.chofer_id, rut: opts.rut });
    if (!chofer) {
      throw new BadRequestException('El chofer no existe. Créalo antes de habilitar el acceso.');
    }
    const { vigencia, expira } = calcularExpira(opts.vigencia);
    const ahora = new Date().toISOString();
    const { error } = await this.client
      .from('choferes')
      .update({
        acceso_habilitado: true,
        password_hash: hashPassword(password),
        password_temporal: true,
        password_actualizada_en: ahora,
        acceso_vigencia: vigencia,
        acceso_expira: expira,
        acceso_habilitado_en: ahora,
        acceso_habilitado_por: opts.adminEmail || null,
        updated_at: ahora,
      })
      .eq('id', chofer.id);
    if (error) throw new BadRequestException(error.message);

    const correo = await this.enviarCorreoBienvenida({
      rut: chofer.rut,
      nombre: chofer.nombre,
      email: chofer.email,
      passwordTemporal: password,
      vigencia,
      expira,
    });
    return {
      ok: true,
      correo_enviado: correo.enviado,
      correo_destino: correo.para,
    };
  }

  async deshabilitarAcceso(opts: { chofer_id?: string; rut?: string }) {
    const chofer = await this.buscarChofer(opts);
    if (!chofer) throw new BadRequestException('Chofer no encontrado.');
    const { error } = await this.client
      .from('choferes')
      .update({ acceso_habilitado: false, updated_at: new Date().toISOString() })
      .eq('id', chofer.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async regenerarClave(opts: {
    chofer_id?: string;
    rut?: string;
    password: string;
    adminEmail?: string | null;
    reenviar_correo?: boolean;
    recuperacion_id?: number;
  }) {
    const password = String(opts.password || '');
    if (password.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
    }
    const chofer = await this.buscarChofer({ id: opts.chofer_id, rut: opts.rut });
    if (!chofer) {
      throw new BadRequestException('Chofer no encontrado. Habilita el acceso primero.');
    }
    const ahora = new Date().toISOString();
    const { error } = await this.client
      .from('choferes')
      .update({
        acceso_habilitado: true,
        password_hash: hashPassword(password),
        password_temporal: true,
        password_actualizada_en: ahora,
        updated_at: ahora,
      })
      .eq('id', chofer.id);
    if (error) throw new BadRequestException(error.message);

    let correo = { enviado: false, para: null as string | null };
    if (opts.reenviar_correo !== false) {
      correo = await this.enviarCorreoBienvenida({
        rut: chofer.rut,
        nombre: chofer.nombre,
        email: chofer.email,
        passwordTemporal: password,
        vigencia: chofer.acceso_vigencia || 'indefinido',
        expira: chofer.acceso_expira || null,
      });
    }
    if (opts.recuperacion_id) {
      await this.client
        .from('chofer_recuperacion_solicitudes')
        .update({ estado: 'resuelta', resuelta_at: ahora, resuelta_por: opts.adminEmail || null })
        .eq('id', opts.recuperacion_id);
    }
    return { ok: true, correo_enviado: correo.enviado, correo_destino: correo.para };
  }

  async listarRecuperaciones(estado?: string) {
    let q = this.client
      .from('chofer_recuperacion_solicitudes')
      .select('*')
      .order('created_at', { ascending: false });
    if (estado === 'pendiente' || estado === 'resuelta') q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((r: any) => ({
      ...r,
      rut_formateado: formatearRut(normalizarRut(r.rut)),
    }));
  }

  async resolverRecuperacion(id: number, adminEmail?: string | null) {
    const { error } = await this.client
      .from('chofer_recuperacion_solicitudes')
      .update({ estado: 'resuelta', resuelta_at: new Date().toISOString(), resuelta_por: adminEmail || null })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  private async enviarCorreoBienvenida(opts: {
    rut: string;
    nombre?: string | null;
    email?: string | null;
    passwordTemporal: string;
    vigencia: string;
    expira: string | null;
  }): Promise<{ enviado: boolean; para: string | null }> {
    const para = String(opts.email || '').trim().toLowerCase();
    if (!RE_EMAIL.test(para)) {
      this.logger.warn(`Bienvenida chofer: ${opts.rut} sin correo válido; no se envió.`);
      return { enviado: false, para: null };
    }
    const base = String(
      process.env.APP_PUBLIC_URL ||
        process.env.PUBLIC_APP_URL ||
        process.env.FRONTEND_URL ||
        'http://localhost:5173',
    ).replace(/\/+$/, '');
    const urlPortal = `${base}/portal-chofer`;
    const expiraTexto = opts.expira
      ? new Date(opts.expira).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const { asunto, html } = plantillaBienvenidaChofer({
      nombre: String(opts.nombre || '').trim() || formatearRut(opts.rut),
      rutFmt: formatearRut(opts.rut),
      passwordTemporal: opts.passwordTemporal,
      vigenciaTexto: vigenciaTexto(opts.vigencia),
      expiraTexto,
      urlPortal,
    });
    try {
      await this.mailings.enviarUno({ para, asunto, cuerpoHtml: html });
      return { enviado: true, para };
    } catch (e: any) {
      this.logger.warn(`Bienvenida chofer falló para ${para}: ${e?.message || e}`);
      return { enviado: false, para };
    }
  }

  // ── Admin: guías internas disponibles para asignar ────────────────────
  async listarGuiasInternasDisponibles() {
    const { data: docs, error } = await this.client
      .from('licitacion_documentos')
      .select('id, licitacion_id, numero, fecha_oc, empresa_despacho, n_seguimiento, created_at')
      .eq('tipo', 'guia_despacho')
      .order('created_at', { ascending: false })
      .limit(800);
    if (error) throw new BadRequestException(error.message);
    const internas = (docs || []).filter((d: any) => esInterno(d.empresa_despacho));
    if (internas.length === 0) return [];

    const docIds = internas.map((d: any) => d.id);
    // Excluir las que ya tienen un viaje activo.
    const { data: viajesActivos } = await this.client
      .from('viajes')
      .select('licitacion_documento_id, estado')
      .in('licitacion_documento_id', docIds)
      .in('estado', ESTADOS_ACTIVOS);
    const ocupadas = new Set(
      (viajesActivos || []).map((v: any) => v.licitacion_documento_id),
    );

    const licIds = [...new Set(internas.map((d: any) => d.licitacion_id).filter(Boolean))];
    const { data: lics } = licIds.length
      ? await this.client
          .from('licitaciones')
          .select('id, id_licitacion, nombre, nombre_entidad, comuna')
          .in('id', licIds)
      : { data: [] as any[] };
    const licMap = new Map((lics || []).map((l: any) => [l.id, l]));

    return internas
      .filter((d: any) => !ocupadas.has(d.id))
      .map((d: any) => {
        const lic: any = licMap.get(d.licitacion_id) || {};
        return {
          documento_id: d.id,
          numero_amso: d.n_seguimiento || null,
          numero_guia: d.numero || null,
          fecha_guia: d.fecha_oc || null,
          licitacion_id: d.licitacion_id || null,
          id_licitacion: lic.id_licitacion || null,
          cliente_nombre: lic.nombre_entidad || lic.nombre || null,
          comuna: lic.comuna || null,
        };
      });
  }

  // Despachos "Por despachar": guías de despacho interno que aún NO tienen
  // ningún viaje asignado (nunca se les asignó chofer). Caen aquí automáticamente
  // al crearse la guía interna en la cotización. Al asignarles un chofer pasan a
  // ser un viaje y dejan esta lista.
  async listarDespachosPendientes() {
    const { data: docs, error } = await this.client
      .from('licitacion_documentos')
      .select('id, licitacion_id, numero, fecha_oc, empresa_despacho, n_seguimiento, created_at')
      .eq('tipo', 'guia_despacho')
      .order('created_at', { ascending: false })
      .limit(800);
    if (error) throw new BadRequestException(error.message);
    const internas = (docs || []).filter((d: any) => esInterno(d.empresa_despacho));
    if (internas.length === 0) return [];

    const docIds = internas.map((d: any) => d.id);
    // Excluir las que ya tienen CUALQUIER viaje (de cualquier estado): una vez
    // asignado un chofer, el despacho vive como viaje. La reasignación tras
    // cancelar se hace desde "Asignar viaje".
    const { data: conViaje } = await this.client
      .from('viajes')
      .select('licitacion_documento_id')
      .in('licitacion_documento_id', docIds);
    const yaAsignadas = new Set(
      (conViaje || []).map((v: any) => v.licitacion_documento_id),
    );

    const licIds = [...new Set(internas.map((d: any) => d.licitacion_id).filter(Boolean))];
    const { data: lics } = licIds.length
      ? await this.client
          .from('licitaciones')
          .select('id, id_licitacion, nombre, nombre_entidad, comuna')
          .in('id', licIds)
      : { data: [] as any[] };
    const licMap = new Map((lics || []).map((l: any) => [l.id, l]));

    return internas
      .filter((d: any) => !yaAsignadas.has(d.id))
      .map((d: any) => {
        const lic: any = licMap.get(d.licitacion_id) || {};
        return {
          documento_id: d.id,
          numero_amso: d.n_seguimiento || null,
          numero_guia: d.numero || null,
          fecha_guia: d.fecha_oc || null,
          licitacion_id: d.licitacion_id || null,
          id_licitacion: lic.id_licitacion || null,
          cliente_nombre: lic.nombre_entidad || lic.nombre || null,
          comuna: lic.comuna || null,
          estado: 'Por despachar',
        };
      });
  }

  // ── Admin: viajes ─────────────────────────────────────────────────────
  async crearViaje(body: any, creadoPor?: string | null) {
    const choferId = String(body?.chofer_id || '').trim();
    if (!choferId) throw new BadRequestException('Debe seleccionar un chofer.');
    const chofer = await this.buscarChofer({ id: choferId });
    if (!chofer || !chofer.activo) {
      throw new BadRequestException('El chofer no existe o está inactivo.');
    }

    const bultosNum =
      body?.bultos != null && body.bultos !== '' && Number.isFinite(Number(body.bultos))
        ? Math.max(0, Math.trunc(Number(body.bultos)))
        : null;
    const numOrNull = (v: any) =>
      v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
    const row: any = {
      chofer_id: choferId,
      titulo: String(body?.titulo || '').trim() || null,
      destino_direccion: String(body?.destino_direccion || '').trim() || null,
      destino_comuna: String(body?.destino_comuna || '').trim() || null,
      destino_lat: numOrNull(body?.destino_lat),
      destino_lng: numOrNull(body?.destino_lng),
      receptor_nombre: String(body?.receptor_nombre || '').trim() || null,
      notas: String(body?.notas || '').trim() || null,
      bultos: bultosNum,
      detalle_carga: String(body?.detalle_carga || '').trim() || null,
      programado_para: body?.programado_para || null,
      creado_por: creadoPor || null,
    };

    const docId = body?.licitacion_documento_id ? Number(body.licitacion_documento_id) : null;
    if (docId) {
      const { data: guia } = await this.client
        .from('licitacion_documentos')
        .select('id, tipo, empresa_despacho, n_seguimiento, numero, licitacion_id')
        .eq('id', docId)
        .maybeSingle();
      if (!guia || guia.tipo !== 'guia_despacho' || !esInterno(guia.empresa_despacho)) {
        throw new BadRequestException('La guía indicada no es un despacho interno.');
      }
      row.licitacion_documento_id = docId;
      row.numero_amso = guia.n_seguimiento || null;
      if (!row.titulo) row.titulo = `Despacho ${guia.n_seguimiento || guia.numero || docId}`;
    } else if (!row.titulo && !row.destino_direccion) {
      throw new BadRequestException(
        'Un viaje libre necesita al menos un título o una dirección de destino.',
      );
    }

    let { data, error } = await this.client.from('viajes').insert(row).select().single();
    // Si la migración de carga aún no se aplicó, reintentar sin esos campos.
    if (error && ((error as any).code === '42703' || /column .* does not exist/i.test(error.message))) {
      const { bultos, detalle_carga, ...sinCarga } = row;
      ({ data, error } = await this.client.from('viajes').insert(sinCarga).select().single());
    }
    if (error) {
      if ((error as any).code === '23505') {
        throw new BadRequestException('Esa guía ya tiene un viaje activo asignado.');
      }
      throw new BadRequestException(error.message);
    }
    await this.client.from('viaje_eventos').insert({
      viaje_id: data.id,
      estado: 'Asignado',
      nota: `Viaje asignado a ${chofer.nombre}.`,
      autor: creadoPor || null,
    });
    return data;
  }

  // Edición de un viaje por el admin: chofer, título, destino, receptor, carga y
  // notas. No cambia el estado (lo maneja el chofer) ni el vínculo con la guía.
  async actualizarViaje(id: string, body: any, autorEmail?: string | null) {
    const { data: viaje } = await this.client
      .from('viajes')
      .select('id, estado')
      .eq('id', id)
      .maybeSingle();
    if (!viaje) throw new NotFoundException('Viaje no encontrado.');

    const patch: any = { actualizado_at: new Date().toISOString() };
    if (body?.chofer_id) {
      const chofer = await this.buscarChofer({ id: String(body.chofer_id) });
      if (!chofer || !chofer.activo) {
        throw new BadRequestException('El chofer no existe o está inactivo.');
      }
      patch.chofer_id = String(body.chofer_id);
    }
    if (body?.titulo !== undefined) patch.titulo = String(body.titulo || '').trim() || null;
    if (body?.destino_direccion !== undefined)
      patch.destino_direccion = String(body.destino_direccion || '').trim() || null;
    if (body?.destino_comuna !== undefined)
      patch.destino_comuna = String(body.destino_comuna || '').trim() || null;
    if (body?.destino_lat !== undefined)
      patch.destino_lat =
        body.destino_lat != null && body.destino_lat !== '' && Number.isFinite(Number(body.destino_lat))
          ? Number(body.destino_lat)
          : null;
    if (body?.destino_lng !== undefined)
      patch.destino_lng =
        body.destino_lng != null && body.destino_lng !== '' && Number.isFinite(Number(body.destino_lng))
          ? Number(body.destino_lng)
          : null;
    if (body?.receptor_nombre !== undefined)
      patch.receptor_nombre = String(body.receptor_nombre || '').trim() || null;
    if (body?.notas !== undefined) patch.notas = String(body.notas || '').trim() || null;
    if (body?.bultos !== undefined) {
      patch.bultos =
        body.bultos != null && body.bultos !== '' && Number.isFinite(Number(body.bultos))
          ? Math.max(0, Math.trunc(Number(body.bultos)))
          : null;
    }
    if (body?.detalle_carga !== undefined)
      patch.detalle_carga = String(body.detalle_carga || '').trim() || null;

    let { error } = await this.client.from('viajes').update(patch).eq('id', id);
    // Fallback si las columnas de carga aún no existen (migración pendiente).
    if (error && ((error as any).code === '42703' || /column .* does not exist/i.test(error.message))) {
      const { bultos, detalle_carga, ...sinCarga } = patch;
      ({ error } = await this.client.from('viajes').update(sinCarga).eq('id', id));
    }
    if (error) throw new BadRequestException(error.message);

    await this.client.from('viaje_eventos').insert({
      viaje_id: id,
      estado: viaje.estado,
      nota: 'Datos del viaje editados.',
      autor: autorEmail || null,
    });
    return { ok: true };
  }

  async listarViajes(filtros: { chofer_id?: string; estado?: string }) {
    let q = this.client
      .from('viajes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (filtros.chofer_id) q = q.eq('chofer_id', filtros.chofer_id);
    if (filtros.estado) q = q.eq('estado', filtros.estado);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return this.enriquecerConChofer(data || []);
  }

  private async enriquecerConChofer(viajes: any[]) {
    if (viajes.length === 0) return [];
    const ids = [...new Set(viajes.map((v) => v.chofer_id))];
    const { data: choferes } = await this.client
      .from('choferes')
      .select('id, nombre, rut, telefono')
      .in('id', ids);
    const mapa = new Map((choferes || []).map((c: any) => [c.id, c]));
    return viajes.map((v) => {
      const c: any = mapa.get(v.chofer_id) || {};
      return {
        ...v,
        chofer_nombre: c.nombre || null,
        chofer_rut: c.rut ? formatearRut(normalizarRut(c.rut)) : null,
        chofer_telefono: c.telefono || null,
      };
    });
  }

  async obtenerViaje(id: string) {
    const { data: viaje, error } = await this.client
      .from('viajes')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!viaje) throw new NotFoundException('Viaje no encontrado.');
    const [enriquecidos, eventosRes] = await Promise.all([
      this.enriquecerConChofer([viaje]),
      this.client
        .from('viaje_eventos')
        .select('*')
        .eq('viaje_id', id)
        .order('created_at', { ascending: true }),
    ]);
    const [conFotos] = await this.adjuntarFotos(enriquecidos);
    return { ...conFotos, eventos: eventosRes.data || [] };
  }

  // ── Fotos del despacho ────────────────────────────────────────────────
  private async urlFirmadaViaje(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await this.client.storage
      .from(BUCKET_VIAJES)
      .createSignedUrl(path, FOTO_URL_TTL);
    return data?.signedUrl || null;
  }

  // Adjunta `fotos` (con URL firmada) a cada viaje. Una sola consulta + una sola
  // firma en lote para no encarecer el listado.
  private async adjuntarFotos(viajes: any[]): Promise<any[]> {
    if (!viajes || viajes.length === 0) return viajes || [];
    const ids = viajes.map((v) => v.id);
    const { data: fotos } = await this.client
      .from('viaje_fotos')
      .select('id, viaje_id, storage_path, nombre, created_at')
      .in('viaje_id', ids)
      .order('created_at', { ascending: true });
    const lista = fotos || [];
    if (lista.length === 0) return viajes.map((v) => ({ ...v, fotos: [] }));
    const paths = lista.map((f: any) => f.storage_path);
    const { data: firmadas } = await this.client.storage
      .from(BUCKET_VIAJES)
      .createSignedUrls(paths, FOTO_URL_TTL);
    const urlPorPath = new Map(
      (firmadas || []).map((s: any) => [s.path, s.signedUrl]),
    );
    const porViaje = new Map<string, any[]>();
    for (const f of lista) {
      const arr = porViaje.get(f.viaje_id) || [];
      arr.push({
        id: f.id,
        nombre: f.nombre,
        created_at: f.created_at,
        url: urlPorPath.get(f.storage_path) || null,
      });
      porViaje.set(f.viaje_id, arr);
    }
    return viajes.map((v) => ({ ...v, fotos: porViaje.get(v.id) || [] }));
  }

  async contarFotosViaje(viajeId: string): Promise<number> {
    const { count } = await this.client
      .from('viaje_fotos')
      .select('id', { count: 'exact', head: true })
      .eq('viaje_id', viajeId);
    return count || 0;
  }

  // El chofer sube una foto del despacho. Valida pertenencia del viaje.
  async subirFotoViaje(
    choferId: string,
    viajeId: string,
    file: Express.Multer.File,
    autor?: string | null,
  ) {
    if (!file) throw new BadRequestException('Falta la imagen.');
    if (!String(file.mimetype || '').startsWith('image/')) {
      throw new BadRequestException('El archivo debe ser una imagen.');
    }
    if (file.size > MAX_FOTO_BYTES) {
      throw new BadRequestException(
        `La imagen supera el máximo permitido (${Math.round(MAX_FOTO_BYTES / 1024 / 1024)}MB).`,
      );
    }
    const { data: viaje } = await this.client
      .from('viajes')
      .select('id')
      .eq('id', viajeId)
      .eq('chofer_id', choferId)
      .maybeSingle();
    if (!viaje) throw new NotFoundException('Viaje no encontrado.');

    const safe = nombreSeguro(file.originalname || 'foto.jpg');
    const storagePath = `${viajeId}/${Date.now()}_${safe}`;
    const { error: errUp } = await this.client.storage
      .from(BUCKET_VIAJES)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (errUp) throw new BadRequestException(`No se pudo subir la imagen: ${errUp.message}`);

    const { data: foto, error } = await this.client
      .from('viaje_fotos')
      .insert({
        viaje_id: viajeId,
        storage_path: storagePath,
        nombre: file.originalname || safe,
        mime: file.mimetype,
        tamano: file.size,
        tomada_por: autor || `chofer:${choferId}`,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    return {
      ok: true,
      foto: {
        id: foto.id,
        nombre: foto.nombre,
        created_at: foto.created_at,
        url: await this.urlFirmadaViaje(storagePath),
      },
    };
  }

  async cambiarEstadoViajeAdmin(id: string, estado: string, nota: string, autorEmail: string) {
    return this.aplicarCambioEstado(id, estado, nota, autorEmail, null, null);
  }

  async cancelarViaje(id: string, autorEmail: string) {
    return this.aplicarCambioEstado(id, 'Cancelado', 'Viaje cancelado.', autorEmail, null, null);
  }

  // Recorrido (histórico de posiciones) de un viaje, para dibujar la polyline.
  async recorridoViaje(viajeId: string) {
    const { data, error } = await this.client
      .from('chofer_posiciones')
      .select('lat, lng, velocidad, rumbo, capturado_at')
      .eq('viaje_id', viajeId)
      .order('capturado_at', { ascending: true })
      .limit(2000);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // ── Tracking: snapshot para el mapa admin ─────────────────────────────
  async snapshotMapa() {
    const { data: choferes, error } = await this.client
      .from('choferes')
      .select('id, nombre, rut, telefono, patente, activo')
      .eq('activo', true);
    if (error) throw new BadRequestException(error.message);
    const lista = choferes || [];
    if (lista.length === 0) return [];
    const ids = lista.map((c: any) => c.id);

    const [{ data: sesiones }, { data: viajes }] = await Promise.all([
      this.client.from('chofer_sesiones').select('*').in('chofer_id', ids),
      this.client
        .from('viajes')
        .select('id, chofer_id, estado, numero_amso, titulo, destino_comuna, licitacion_documento_id')
        .in('chofer_id', ids)
        .in('estado', ESTADOS_ACTIVOS)
        .order('created_at', { ascending: false }),
    ]);
    const sesMap = new Map((sesiones || []).map((s: any) => [s.chofer_id, s]));
    const viajeMap = new Map<string, any>();
    (viajes || []).forEach((v: any) => {
      if (!viajeMap.has(v.chofer_id)) viajeMap.set(v.chofer_id, v); // el más reciente
    });

    // Número de cotización (id_licitacion) de los viajes vinculados a una guía
    // interna: viaje → licitacion_documento → licitacion.id_licitacion.
    const docIds = [
      ...new Set(
        [...viajeMap.values()].map((v: any) => v.licitacion_documento_id).filter(Boolean),
      ),
    ];
    const cotizacionPorDoc = new Map<number, string | null>();
    if (docIds.length) {
      const { data: docs } = await this.client
        .from('licitacion_documentos')
        .select('id, licitacion_id')
        .in('id', docIds);
      const licIds = [...new Set((docs || []).map((d: any) => d.licitacion_id).filter(Boolean))];
      const licMap = new Map<number, string>();
      if (licIds.length) {
        const { data: lics } = await this.client
          .from('licitaciones')
          .select('id, id_licitacion')
          .in('id', licIds);
        (lics || []).forEach((l: any) => licMap.set(l.id, l.id_licitacion));
      }
      (docs || []).forEach((d: any) =>
        cotizacionPorDoc.set(d.id, licMap.get(d.licitacion_id) || null),
      );
    }

    const ahora = Date.now();
    return lista.map((c: any) => {
      const s: any = sesMap.get(c.id);
      const lastSeen = s?.last_seen_at ? new Date(s.last_seen_at).getTime() : null;
      const online = lastSeen != null && ahora - lastSeen <= ONLINE_WINDOW_SECONDS * 1000;
      const v: any = viajeMap.get(c.id) || null;
      return {
        chofer_id: c.id,
        nombre: c.nombre,
        rut_formateado: formatearRut(normalizarRut(c.rut)),
        telefono: c.telefono || null,
        patente: c.patente || null,
        online,
        last_seen_at: s?.last_seen_at || null,
        lat: s?.ultima_lat ?? null,
        lng: s?.ultima_lng ?? null,
        velocidad: s?.ultima_velocidad ?? null,
        rumbo: s?.ultimo_rumbo ?? null,
        viaje_activo: v
          ? {
              id: v.id,
              estado: v.estado,
              numero_amso: v.numero_amso,
              titulo: v.titulo,
              destino_comuna: v.destino_comuna,
              id_cotizacion: cotizacionPorDoc.get(v.licitacion_documento_id) || null,
            }
          : null,
      };
    });
  }

  // ── Estadísticas / dashboard de viajes por chofer (admin) ─────────────
  // Agrega los viajes del período por chofer: total, desglose por estado y
  // conteo por día (para el mapa de calor tipo calendario). Las fechas se
  // calculan en horario de Chile (America/Santiago).
  async estadisticasChoferes(opts?: {
    dias?: number | string;
    desde?: string;
    hasta?: string;
  }) {
    const fmtDia = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const diaDe = (iso: any) => (iso ? fmtDia.format(new Date(iso)) : null);
    const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

    // Rango: si llegan desde/hasta válidos se usan; si no, se calcula a partir
    // de `dias` (default 30) hasta hoy (horario de Chile).
    let desde: string;
    let hasta: string;
    const dStr = String(opts?.desde || '');
    const hStr = String(opts?.hasta || '');
    if (RE_FECHA.test(dStr) && RE_FECHA.test(hStr) && dStr <= hStr) {
      desde = dStr;
      hasta = hStr;
    } else {
      const dias = Math.min(Math.max(Number(opts?.dias) || 30, 1), 366);
      const hoyMs = Date.now();
      hasta = fmtDia.format(new Date(hoyMs));
      desde = fmtDia.format(new Date(hoyMs - (dias - 1) * 86400000));
    }

    // Lista de días del rango (ascendente, máx 366) en horario de Chile.
    const diasSet: string[] = [];
    const vistos = new Set<string>();
    let cursor = new Date(`${desde}T12:00:00Z`);
    const finMs = new Date(`${hasta}T12:00:00Z`).getTime();
    let guard = 0;
    while (cursor.getTime() <= finMs && guard < 366) {
      const d = fmtDia.format(cursor);
      if (!vistos.has(d)) { vistos.add(d); diasSet.push(d); }
      cursor = new Date(cursor.getTime() + 86400000);
      guard++;
    }
    const enRango = (dia: string | null) => dia != null && dia >= desde && dia <= hasta;

    const [{ data: choferes, error: errC }, { data: viajes, error: errV }] =
      await Promise.all([
        this.client
          .from('choferes')
          .select('id, nombre, rut, patente, activo')
          .order('nombre', { ascending: true }),
        this.client
          .from('viajes')
          .select('chofer_id, estado, created_at, entregado_at')
          .order('created_at', { ascending: false })
          .limit(5000),
      ]);
    if (errC) throw new BadRequestException(errC.message);
    if (errV) throw new BadRequestException(errV.message);

    const estadoVacio = () =>
      ESTADOS.reduce((acc, e) => ({ ...acc, [e]: 0 }), {} as Record<string, number>);

    const porChofer = new Map<string, any>();
    (choferes || []).forEach((c: any) => {
      porChofer.set(c.id, {
        chofer_id: c.id,
        nombre: c.nombre,
        rut_formateado: formatearRut(normalizarRut(c.rut)),
        patente: c.patente || null,
        activo: !!c.activo,
        total: 0,
        total_historico: 0,
        activos: 0,
        entregados: 0,
        por_estado: estadoVacio(),
        por_dia: {} as Record<string, number>,
        ultimo_viaje_at: null as string | null,
      });
    });

    const totalesGlobal = { total: 0, por_estado: estadoVacio() };
    let maxPorDia = 0;
    let maxPorEstado = 0;

    (viajes || []).forEach((v: any) => {
      const c = porChofer.get(v.chofer_id);
      if (!c) return; // chofer eliminado/inactivo no listado
      c.total_historico += 1;
      if (!c.ultimo_viaje_at || v.created_at > c.ultimo_viaje_at) {
        c.ultimo_viaje_at = v.created_at;
      }
      const dia = diaDe(v.created_at);
      if (!enRango(dia)) return;
      const estado = ESTADOS.includes(v.estado) ? v.estado : 'Asignado';
      c.total += 1;
      c.por_estado[estado] += 1;
      if (c.por_estado[estado] > maxPorEstado) maxPorEstado = c.por_estado[estado];
      if (estado === 'Asignado' || estado === 'En ruta') c.activos += 1;
      if (estado === 'Entregado') c.entregados += 1;
      c.por_dia[dia!] = (c.por_dia[dia!] || 0) + 1;
      if (c.por_dia[dia!] > maxPorDia) maxPorDia = c.por_dia[dia!];
      totalesGlobal.total += 1;
      totalesGlobal.por_estado[estado] += 1;
    });

    const lista = [...porChofer.values()].sort((a, b) => b.total - a.total);
    return {
      generado_at: new Date().toISOString(),
      rango: { dias: diasSet.length, desde, hasta },
      estados: ESTADOS,
      dias_lista: diasSet,
      max_por_dia: maxPorDia,
      max_por_estado: maxPorEstado,
      totales: totalesGlobal,
      choferes: lista,
    };
  }

  // ── Portal del chofer ─────────────────────────────────────────────────
  async login(opts: { rut: string; password: string; ip?: string | null }) {
    const rutN = normalizarRut(opts.rut);
    const password = String(opts.password || '');
    if (!rutN || !esRutValido(rutN)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }
    if (!password) throw new BadRequestException('Debe ingresar su contraseña.');

    const { data: chofer, error } = await this.client
      .from('choferes')
      .select('*')
      .eq('rut', rutN)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!chofer || !chofer.activo || !chofer.acceso_habilitado) {
      throw new UnauthorizedException(
        'Su acceso al portal no está habilitado. Contáctese con Amsodent para activarlo.',
      );
    }
    if (chofer.acceso_expira && new Date(chofer.acceso_expira).getTime() < Date.now()) {
      throw new UnauthorizedException('Su acceso al portal expiró. Contáctese con Amsodent para renovarlo.');
    }
    if (!verifyPassword(password, chofer.password_hash)) {
      throw new UnauthorizedException('RUT o contraseña incorrectos.');
    }
    const ahora = new Date().toISOString();
    await this.client.from('choferes').update({ ultimo_acceso: ahora, updated_at: ahora }).eq('id', chofer.id);

    const token = this.signToken({ chofer_id: chofer.id, rut: rutN, nombre: chofer.nombre });
    return {
      token,
      chofer: {
        id: chofer.id,
        rut: rutN,
        rut_formateado: formatearRut(rutN),
        nombre: chofer.nombre,
        debe_cambiar_clave: !!chofer.password_temporal,
      },
    };
  }

  async cambiarClave(choferId: string, passwordNueva: string) {
    const nueva = String(passwordNueva || '');
    if (nueva.length < 6) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 6 caracteres.');
    }
    const ahora = new Date().toISOString();
    const { error } = await this.client
      .from('choferes')
      .update({
        password_hash: hashPassword(nueva),
        password_temporal: false,
        password_actualizada_en: ahora,
        updated_at: ahora,
      })
      .eq('id', choferId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async solicitarRecuperacion(opts: {
    rut: string;
    contacto_email?: string;
    contacto_telefono?: string;
    mensaje?: string;
    ip?: string | null;
    user_agent?: string | null;
  }) {
    const rutN = normalizarRut(opts.rut);
    if (!rutN || !esRutValido(rutN)) {
      throw new BadRequestException('Debe ingresar un RUT válido.');
    }
    const email = String(opts.contacto_email || '').trim().toLowerCase();
    const telefono = String(opts.contacto_telefono || '').trim();
    if (!email && !telefono) {
      throw new BadRequestException('Indique un correo o teléfono de contacto.');
    }
    if (email && !RE_EMAIL.test(email)) {
      throw new BadRequestException('El correo de contacto no es válido.');
    }
    const { data: chofer } = await this.client
      .from('choferes')
      .select('nombre')
      .eq('rut', rutN)
      .maybeSingle();
    const { error } = await this.client.from('chofer_recuperacion_solicitudes').insert({
      rut: rutN,
      nombre: chofer?.nombre || null,
      contacto_email: email || null,
      contacto_telefono: telefono || null,
      mensaje: String(opts.mensaje || '').trim() || null,
      ip_address: opts.ip || null,
      user_agent: opts.user_agent || null,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async misViajes(choferId: string, estado?: string) {
    let q = this.client
      .from('viajes')
      .select('*')
      .eq('chofer_id', choferId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (estado) q = q.eq('estado', estado);
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return this.adjuntarFotos(data || []);
  }

  async obtenerMiViaje(choferId: string, viajeId: string) {
    const { data, error } = await this.client
      .from('viajes')
      .select('*')
      .eq('id', viajeId)
      .eq('chofer_id', choferId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Viaje no encontrado.');
    const [conFotos] = await this.adjuntarFotos([data]);
    return conFotos;
  }

  async cambiarEstadoViaje(
    choferId: string,
    viajeId: string,
    body: { estado: string; lat?: number; lng?: number; nota?: string },
  ) {
    if (!ESTADOS_CHOFER.includes(String(body?.estado || '').trim())) {
      throw new BadRequestException(`Estado no permitido: ${body?.estado}`);
    }
    return this.aplicarCambioEstado(
      viajeId,
      body.estado,
      body?.nota || '',
      null,
      body?.lat ?? null,
      body?.lng ?? null,
      choferId,
    );
  }

  // Núcleo de transición de estado (admin o chofer). Si choferId viene, valida
  // pertenencia. Setea timestamps e inserta el evento en la bitácora.
  private async aplicarCambioEstado(
    viajeId: string,
    estado: string,
    nota: string,
    autorEmail: string | null,
    lat: number | null,
    lng: number | null,
    choferId?: string,
  ) {
    const nuevo = String(estado || '').trim();
    if (!ESTADOS.includes(nuevo)) throw new BadRequestException(`Estado no válido: ${estado}`);

    let q = this.client.from('viajes').select('*').eq('id', viajeId);
    if (choferId) q = q.eq('chofer_id', choferId);
    const { data: viaje, error: errSel } = await q.maybeSingle();
    if (errSel) throw new BadRequestException(errSel.message);
    if (!viaje) throw new NotFoundException('Viaje no encontrado.');

    // Cuando es el chofer quien marca "Entregado", exigimos al menos una foto
    // del despacho como respaldo de la entrega.
    if (nuevo === 'Entregado' && choferId) {
      const fotos = await this.contarFotosViaje(viaje.id);
      if (fotos === 0) {
        throw new BadRequestException(
          'Debe cargar al menos una foto del despacho antes de marcarlo como entregado.',
        );
      }
    }

    const ahora = new Date().toISOString();
    const patch: any = { estado: nuevo, actualizado_at: ahora };
    if (nuevo === 'En ruta' && !viaje.iniciado_at) patch.iniciado_at = ahora;
    if (nuevo === 'Entregado' || nuevo === 'No entregado') patch.entregado_at = ahora;

    const { error } = await this.client.from('viajes').update(patch).eq('id', viaje.id);
    if (error) throw new BadRequestException(error.message);

    await this.client.from('viaje_eventos').insert({
      viaje_id: viaje.id,
      estado: nuevo,
      nota: String(nota || '').trim() || `Estado cambiado a ${nuevo}.`,
      autor: autorEmail || (choferId ? `chofer:${choferId}` : null),
      lat,
      lng,
    });

    // Si vino ubicación con el cambio de estado, la registramos también.
    if (choferId && lat != null && lng != null) {
      await this.registrarPosicion(choferId, { lat, lng, viaje_id: viaje.id });
    }
    return { ok: true };
  }

  async registrarPosicion(
    choferId: string,
    body: {
      lat: number;
      lng: number;
      precision_m?: number;
      velocidad?: number;
      rumbo?: number;
      viaje_id?: string | null;
    },
  ) {
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('Coordenadas inválidas.');
    }
    const ahora = new Date().toISOString();
    const { error } = await this.client.from('chofer_posiciones').insert({
      chofer_id: choferId,
      viaje_id: body?.viaje_id || null,
      lat,
      lng,
      precision_m: body?.precision_m ?? null,
      velocidad: body?.velocidad ?? null,
      rumbo: body?.rumbo ?? null,
      capturado_at: ahora,
    });
    if (error) throw new BadRequestException(error.message);

    // Presencia + última posición materializada (para el snapshot del mapa).
    const { error: errSes } = await this.client.from('chofer_sesiones').upsert(
      {
        chofer_id: choferId,
        last_seen_at: ahora,
        ultima_lat: lat,
        ultima_lng: lng,
        ultima_velocidad: body?.velocidad ?? null,
        ultimo_rumbo: body?.rumbo ?? null,
        updated_at: ahora,
      },
      { onConflict: 'chofer_id' },
    );
    if (errSes) this.logger.warn(`No se pudo actualizar la sesión del chofer: ${errSes.message}`);
    return { ok: true };
  }

  // El chofer dejó de compartir ubicación: limpiamos last_seen_at para que el
  // mapa lo muestre "desconectado" de inmediato (sin esperar la ventana de 100s).
  // Conservamos la última posición para seguir mostrando dónde quedó.
  async detenerPresencia(choferId: string) {
    const { error } = await this.client
      .from('chofer_sesiones')
      .update({ last_seen_at: null, updated_at: new Date().toISOString() })
      .eq('chofer_id', choferId);
    if (error) this.logger.warn(`No se pudo detener la presencia: ${error.message}`);
    return { ok: true };
  }
}
