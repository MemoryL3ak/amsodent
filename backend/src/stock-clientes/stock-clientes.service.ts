import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { CorreosService } from '../correos/correos.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';
import {
  plantillaAlertaStock,
  plantillaSolicitudCotizacion,
  plantillaBienvenidaPortal,
} from '../correos/correos.templates';

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12h
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Precio en pesos (entero). Los precios CLP no llevan decimales; se toman solo
// los dígitos para que "19.900" (separador de miles) se guarde como 19900 y no
// como 19,9 (que descuadraría el total = stock × precio).
function precioEnteroPesos(raw: any): number | null {
  if (raw == null || raw === '') return null;
  const digitos = String(raw).replace(/[^\d]/g, '');
  if (!digitos) return null;
  const n = Number(digitos);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type SemaforoColor = 'verde' | 'amarillo' | 'rojo';

export type ItemDeclaracion = {
  nombre: string;
  // SKU/código opcional que el cliente asocia al producto.
  sku?: string | null;
  marca?: string | null;
  unidad?: string | null;
  stock_actual: number;
  // Umbral crítico (rojo): stock_actual ≤ stock_minimo.
  stock_minimo: number;
  // Umbral de stock bajo (amarillo): stock_actual ≤ stock_alerta.
  // Lo declara el cliente explícitamente por producto. Si no se declara,
  // se usa el fallback de 1.5×stock_minimo.
  stock_alerta?: number | null;
  // Precio unitario declarado por el cliente (para valorizar su inventario).
  precio_unitario?: number | null;
  // Producto marcado como esencial para la operación del cliente. Independiente
  // del semáforo: identifica importancia del producto, no nivel de stock.
  es_critico?: boolean;
  // Ubicación física del producto (bodega/caja/estante). El cliente gestiona
  // su propia lista de ubicaciones y asigna una por producto.
  ubicacion_id?: number | null;
  ubicacion?: string | null;
  semaforo: SemaforoColor;
};

export type StockTokenPayload = {
  rut: string;
  razon_social: string;
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

// Validación mínima de RUT chileno (formato + dígito verificador).
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

// Formatea el RUT normalizado en formato legible: 12.345.678-9
function formatearRut(rutNorm: string): string {
  if (!rutNorm) return '';
  const cuerpo = rutNorm.slice(0, -1);
  const dv = rutNorm.slice(-1).toUpperCase();
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${conPuntos}-${dv}`;
}

// Calcula el color del semáforo según los umbrales declarados por el cliente.
// - Rojo: stock actual ≤ stock_minimo (umbral crítico)
// - Amarillo: stock actual ≤ stock_alerta (umbral de advertencia declarado)
//   Si stock_alerta no se declaró, se cae al fallback 1.5×stock_minimo.
// - Verde: por sobre el umbral de alerta.
function calcularSemaforo(
  actual: number,
  minimo: number,
  alerta?: number | null,
): SemaforoColor {
  const a = Number(actual) || 0;
  const m = Number(minimo) || 0;
  if (m <= 0) return 'verde';
  if (a <= m) return 'rojo';

  const alertaNum = alerta == null ? NaN : Number(alerta);
  const umbralAmarillo =
    Number.isFinite(alertaNum) && alertaNum > m ? alertaNum : m * 1.5;
  if (a <= umbralAmarillo) return 'amarillo';
  return 'verde';
}

// ── Contraseñas del portal ──────────────────────────────────────────────
// Usamos scrypt del módulo `crypto` (sin dependencias nativas). El hash se
// guarda como `scrypt$<saltHex>$<hashHex>`.
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Política de contraseña del portal del cliente: mínimo 8 caracteres, con al
// menos una mayúscula, una minúscula y un número. Devuelve un mensaje de error
// si no cumple, o null si es válida.
function validarPasswordPortal(plain: string): string | null {
  const pw = String(plain || '');
  if (pw.length < 8)
    return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Z]/.test(pw))
    return 'La contraseña debe incluir al menos una letra mayúscula.';
  if (!/[a-z]/.test(pw))
    return 'La contraseña debe incluir al menos una letra minúscula.';
  if (!/[0-9]/.test(pw))
    return 'La contraseña debe incluir al menos un número.';
  return null;
}

function verifyPassword(plain: string, stored?: string | null): boolean {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const got = crypto.scryptSync(String(plain), salt, expected.length);
    return (
      expected.length === got.length && crypto.timingSafeEqual(expected, got)
    );
  } catch {
    return false;
  }
}

// Traduce la vigencia elegida por el admin a una fecha de expiración.
// '1m' → +1 mes, '3m' → +3 meses, 'indefinido' → sin expiración (null).
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
  throw new BadRequestException(
    'Vigencia inválida. Use 1m, 3m o indefinido.',
  );
}

function vigenciaTexto(vigencia?: string | null): string {
  if (vigencia === '1m') return '1 mes';
  if (vigencia === '3m') return '3 meses';
  return 'Acceso indefinido';
}

@Injectable()
export class StockClientesService {
  private readonly logger = new Logger(StockClientesService.name);

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
    private correos: CorreosService,
    private licitaciones: LicitacionesService,
  ) {}

  private get secret(): string {
    // Contención auditoría 2026-09-04: sin literal 'dev-secret' forjable.
    const s =
      process.env.PORTAL_STOCK_JWT_SECRET ||
      process.env.PORTAL_JWT_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!s) throw new BadRequestException('El portal no está configurado (falta PORTAL_STOCK_JWT_SECRET).');
    return s;
  }

  // ── Token del portal de stock ─────────────────────────────────────────

  private signToken(payload: Omit<StockTokenPayload, 'exp'>): string {
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

  verifyToken(token: string): StockTokenPayload | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerEnc, payloadEnc, sigEnc] = parts;
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(`${headerEnc}.${payloadEnc}`)
      .digest();
    const got = Buffer.from(
      sigEnc.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    );
    if (
      expected.length !== got.length ||
      !crypto.timingSafeEqual(expected, got)
    ) {
      return null;
    }
    try {
      const payload = JSON.parse(base64urlDecodeToString(payloadEnc));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  // ── Verificación previa de RUT ────────────────────────────────────────

  // Busca un cliente en el maestro de Amsodent (tabla `clientes`) cuyo RUT
  // matchee con el normalizado provisto. El formato en BD puede variar
  // (con/sin puntos, con/sin guión), así que normalizamos ambos lados.
  private async buscarClientePorRut(
    rutNorm: string,
  ): Promise<{ id: number; rut: string; nombre: string; email?: string | null; telefono?: string | null } | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('id, rut, nombre, email, telefono')
      .range(0, 20000);
    if (error) throw new BadRequestException(error.message);
    const match = (data || []).find(
      (c: any) => normalizarRut(c?.rut) === rutNorm,
    );
    return (match as any) || null;
  }

  // El cliente ingresa primero su RUT. Validamos contra el maestro de
  // clientes de Amsodent: si el RUT no está registrado, no puede acceder.
  // Si está registrado, devolvemos su razón social oficial (no la decide
  // el cliente) y si necesita aceptar el acuerdo de confidencialidad.
  async verificarRut(rut: string) {
    const rutN = normalizarRut(rut);
    if (!rutN) {
      throw new BadRequestException('Debe ingresar su RUT.');
    }
    if (!esRutValido(rutN)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }

    const cliente = await this.buscarClientePorRut(rutN);
    if (!cliente) {
      throw new BadRequestException(
        'Su RUT no se encuentra registrado en nuestros sistemas. Por favor contáctenos para activar el acceso al portal.',
      );
    }

    // Estado en el portal de stock (para saber si ya aceptó el acuerdo)
    const { data: portalCli, error: errPortal } = await this.supabase
      .getClient()
      .from('stock_clientes_portal')
      .select('rut, acepto_acuerdo_en')
      .eq('rut', rutN)
      .maybeSingle();
    if (errPortal) throw new BadRequestException(errPortal.message);

    // Contención auditoría 2026-09-04: este endpoint es público y devolvía
    // email y teléfono del cliente — un oráculo para extraer el maestro
    // completo iterando RUTs. Solo se entrega lo mínimo para el flujo.
    return {
      rut: rutN,
      rut_formateado: formatearRut(rutN),
      existe: !!portalCli,
      razon_social: cliente.nombre,
      requiere_acuerdo: !portalCli?.acepto_acuerdo_en,
    };
  }

  // ── Acceso del cliente (RUT + contraseña) ─────────────────────────────

  // Login con RUT y contraseña. El acceso debe estar habilitado por el admin
  // y vigente (no expirado). Devuelve el token del portal e indica si el
  // cliente debe cambiar su clave (temporal) o aceptar el acuerdo.
  async login(opts: { rut: string; password: string; ip?: string | null }) {
    const rutN = normalizarRut(opts.rut);
    const password = String(opts.password || '');
    if (!rutN) throw new BadRequestException('Debe ingresar su RUT.');
    if (!esRutValido(rutN)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }
    if (!password) throw new BadRequestException('Debe ingresar su contraseña.');

    // El RUT debe existir en el maestro de clientes.
    const cliente = await this.buscarClientePorRut(rutN);
    if (!cliente) {
      throw new UnauthorizedException('RUT o contraseña incorrectos.');
    }

    const client = this.supabase.getClient();
    const { data: portal, error } = await client
      .from('stock_clientes_portal')
      .select('*')
      .eq('rut', rutN)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);

    if (!portal || !portal.acceso_habilitado) {
      throw new UnauthorizedException(
        'Su acceso al portal no está habilitado. Contáctese con su ejecutivo de Amsodent para activarlo.',
      );
    }
    if (
      portal.acceso_expira &&
      new Date(portal.acceso_expira).getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        'Su acceso al portal expiró. Contáctese con su ejecutivo de Amsodent para renovarlo.',
      );
    }
    if (!verifyPassword(password, portal.password_hash)) {
      throw new UnauthorizedException('RUT o contraseña incorrectos.');
    }

    const razonSocial =
      String(cliente.nombre || portal.razon_social || '').trim();
    const ahora = new Date().toISOString();
    await client
      .from('stock_clientes_portal')
      .update({ ultimo_acceso: ahora, updated_at: ahora })
      .eq('rut', rutN);

    const token = this.signToken({ rut: rutN, razon_social: razonSocial });
    return {
      token,
      cliente: {
        rut: rutN,
        rut_formateado: formatearRut(rutN),
        razon_social: razonSocial,
        debe_cambiar_clave: !!portal.password_temporal,
        requiere_acuerdo: !portal.acepto_acuerdo_en,
      },
    };
  }

  // Cambio de clave del cliente autenticado (incluye el cambio obligatorio
  // del primer ingreso). Marca la clave como definitiva.
  async cambiarClave(rut: string, passwordNueva: string) {
    const rutN = normalizarRut(rut);
    const nueva = String(passwordNueva || '');
    const errPw = validarPasswordPortal(nueva);
    if (errPw) throw new BadRequestException(errPw);
    const ahora = new Date().toISOString();
    const { error } = await this.supabase
      .getClient()
      .from('stock_clientes_portal')
      .update({
        password_hash: hashPassword(nueva),
        password_temporal: false,
        password_actualizada_en: ahora,
        updated_at: ahora,
      })
      .eq('rut', rutN);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Marca el acuerdo de confidencialidad como aceptado (cliente autenticado).
  async aceptarAcuerdo(rut: string, ip?: string | null) {
    const rutN = normalizarRut(rut);
    const client = this.supabase.getClient();
    const { data: portal } = await client
      .from('stock_clientes_portal')
      .select('acepto_acuerdo_en')
      .eq('rut', rutN)
      .maybeSingle();
    const ahora = new Date().toISOString();
    const patch: any = { updated_at: ahora };
    if (!portal?.acepto_acuerdo_en) {
      patch.acepto_acuerdo_en = ahora;
      patch.acepto_acuerdo_ip = ip || null;
    }
    const { error } = await client
      .from('stock_clientes_portal')
      .update(patch)
      .eq('rut', rutN);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // El cliente solicita recuperar su clave: deja una solicitud para que el
  // equipo de soporte la atienda (regenerando la clave). No revela si el RUT
  // tiene o no acceso, para no filtrar información.
  async solicitarRecuperacion(opts: {
    rut: string;
    contacto_nombre?: string;
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
      throw new BadRequestException(
        'Indique un correo o teléfono de contacto para poder responderle.',
      );
    }
    if (email && !RE_EMAIL.test(email)) {
      throw new BadRequestException('El correo de contacto no es válido.');
    }

    const cliente = await this.buscarClientePorRut(rutN);
    const { error } = await this.supabase
      .getClient()
      .from('stock_recuperacion_solicitudes')
      .insert({
        rut: rutN,
        razon_social: cliente?.nombre || null,
        contacto_nombre: String(opts.contacto_nombre || '').trim() || null,
        contacto_email: email || null,
        contacto_telefono: telefono || null,
        mensaje: String(opts.mensaje || '').trim() || null,
        ip_address: opts.ip || null,
        user_agent: opts.user_agent || null,
      });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── Administración del acceso al portal ───────────────────────────────

  // Lista los clientes con registro en el portal y su estado de acceso.
  // El correo/razón social se resuelven SIEMPRE contra el maestro de
  // clientes (en vivo), no contra el snapshot guardado en el portal, para
  // reflejar ediciones recientes del cliente.
  async listarAccesos() {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('stock_clientes_portal')
      .select(
        'rut, razon_social, email, telefono, acceso_habilitado, acceso_vigencia, acceso_expira, acceso_habilitado_en, acceso_habilitado_por, password_temporal, ultimo_acceso, acepto_acuerdo_en',
      )
      .order('acceso_habilitado_en', { ascending: false, nullsFirst: false });
    if (error) throw new BadRequestException(error.message);

    // Maestro de clientes para enriquecer con datos vigentes.
    const { data: maestro } = await client
      .from('clientes')
      .select('rut, nombre, email, telefono')
      .range(0, 20000);
    const mapa = new Map<string, any>();
    (maestro || []).forEach((m: any) => mapa.set(normalizarRut(m?.rut), m));

    return (data || []).map((c: any) => {
      const m = mapa.get(normalizarRut(c.rut));
      return {
        ...c,
        razon_social: m?.nombre || c.razon_social,
        email: m?.email || c.email,
        telefono: m?.telefono || c.telefono,
        rut_formateado: formatearRut(normalizarRut(c.rut)),
        // Acceso vigente = habilitado y no expirado.
        vigente:
          !!c.acceso_habilitado &&
          (!c.acceso_expira ||
            new Date(c.acceso_expira).getTime() >= Date.now()),
      };
    });
  }

  // Búsqueda en el maestro de clientes para habilitar nuevos accesos (por
  // nombre o RUT). El formato del RUT en BD varía, así que normalizamos.
  async buscarClientesParaAcceso(query: string) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const qRut = normalizarRut(q);
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('id, rut, nombre, email, telefono')
      .range(0, 20000);
    if (error) throw new BadRequestException(error.message);
    return (data || [])
      .filter((c: any) => {
        const nombre = String(c?.nombre || '').toLowerCase();
        const rutN = normalizarRut(c?.rut);
        return nombre.includes(ql) || (qRut.length >= 2 && rutN.includes(qRut));
      })
      .slice(0, 20)
      .map((c: any) => {
        const rutN = normalizarRut(c?.rut);
        return {
          id: c.id,
          rut: rutN,
          rut_formateado: formatearRut(rutN),
          nombre: c.nombre,
          email: c.email || null,
          telefono: c.telefono || null,
        };
      });
  }

  // Habilita el acceso al portal para un cliente: fija contraseña temporal,
  // vigencia y envía el correo de bienvenida con la clave y el paso a paso.
  async habilitarAcceso(opts: {
    rut: string;
    password: string;
    vigencia: string;
    adminEmail?: string | null;
  }) {
    const rutN = normalizarRut(opts.rut);
    if (!rutN || !esRutValido(rutN)) {
      throw new BadRequestException('El RUT ingresado no es válido.');
    }
    const password = String(opts.password || '');
    const errPw = validarPasswordPortal(password);
    if (errPw) throw new BadRequestException(errPw);
    const cliente = await this.buscarClientePorRut(rutN);
    if (!cliente) {
      throw new BadRequestException(
        'El RUT no existe en el maestro de clientes. Cree el cliente antes de habilitar el acceso.',
      );
    }
    const { vigencia, expira } = calcularExpira(opts.vigencia);
    const ahora = new Date().toISOString();
    const client = this.supabase.getClient();
    const { data: existente } = await client
      .from('stock_clientes_portal')
      .select('email, telefono')
      .eq('rut', rutN)
      .maybeSingle();

    const razonSocial = String(cliente.nombre || '').trim();
    const email = cliente.email || existente?.email || null;
    const payload: any = {
      rut: rutN,
      razon_social: razonSocial,
      email,
      telefono: cliente.telefono || existente?.telefono || null,
      acceso_habilitado: true,
      password_hash: hashPassword(password),
      password_temporal: true,
      password_actualizada_en: ahora,
      acceso_vigencia: vigencia,
      acceso_expira: expira,
      acceso_habilitado_en: ahora,
      acceso_habilitado_por: opts.adminEmail || null,
      updated_at: ahora,
    };
    const { error } = await client
      .from('stock_clientes_portal')
      .upsert(payload, { onConflict: 'rut' });
    if (error) throw new BadRequestException(error.message);

    const correo = await this.enviarCorreoBienvenida({
      rut: rutN,
      razonSocial,
      email,
      passwordTemporal: password,
      vigencia,
      expira,
    });

    return {
      ok: true,
      rut: rutN,
      rut_formateado: formatearRut(rutN),
      correo_enviado: correo.enviado,
      correo_destino: correo.para,
    };
  }

  // Deshabilita el acceso (sin borrar el registro ni la clave).
  async deshabilitarAcceso(rut: string) {
    const rutN = normalizarRut(rut);
    const { error } = await this.supabase
      .getClient()
      .from('stock_clientes_portal')
      .update({ acceso_habilitado: false, updated_at: new Date().toISOString() })
      .eq('rut', rutN);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Regenera una clave temporal nueva (recuperación de clave). Opcionalmente
  // reenvía el correo y resuelve la solicitud de recuperación asociada.
  async regenerarClave(opts: {
    rut: string;
    password: string;
    adminEmail?: string | null;
    reenviar_correo?: boolean;
    recuperacion_id?: number;
  }) {
    const rutN = normalizarRut(opts.rut);
    if (!rutN) throw new BadRequestException('RUT inválido.');
    const password = String(opts.password || '');
    const errPw = validarPasswordPortal(password);
    if (errPw) throw new BadRequestException(errPw);
    const client = this.supabase.getClient();
    const { data: portal, error: errSel } = await client
      .from('stock_clientes_portal')
      .select('razon_social, email, acceso_vigencia, acceso_expira')
      .eq('rut', rutN)
      .maybeSingle();
    if (errSel) throw new BadRequestException(errSel.message);
    if (!portal) {
      throw new BadRequestException(
        'Este cliente no tiene acceso al portal. Habilítelo primero.',
      );
    }

    const ahora = new Date().toISOString();
    const { error } = await client
      .from('stock_clientes_portal')
      .update({
        password_hash: hashPassword(password),
        password_temporal: true,
        password_actualizada_en: ahora,
        updated_at: ahora,
      })
      .eq('rut', rutN);
    if (error) throw new BadRequestException(error.message);

    let correo = { enviado: false, para: null as string | null };
    if (opts.reenviar_correo !== false) {
      correo = await this.enviarCorreoBienvenida({
        rut: rutN,
        razonSocial: portal.razon_social,
        email: portal.email,
        passwordTemporal: password,
        vigencia: portal.acceso_vigencia || 'indefinido',
        expira: portal.acceso_expira || null,
      });
    }

    if (opts.recuperacion_id) {
      await client
        .from('stock_recuperacion_solicitudes')
        .update({
          estado: 'resuelta',
          resuelta_at: ahora,
          resuelta_por: opts.adminEmail || null,
        })
        .eq('id', opts.recuperacion_id);
    }

    return {
      ok: true,
      correo_enviado: correo.enviado,
      correo_destino: correo.para,
    };
  }

  // Solicitudes de recuperación de clave para la bandeja del admin.
  async listarRecuperaciones(estado?: string) {
    let q = this.supabase
      .getClient()
      .from('stock_recuperacion_solicitudes')
      .select('*')
      .order('created_at', { ascending: false });
    if (estado === 'pendiente' || estado === 'resuelta') {
      q = q.eq('estado', estado);
    }
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((r: any) => ({
      ...r,
      rut_formateado: formatearRut(normalizarRut(r.rut)),
    }));
  }

  async resolverRecuperacion(id: number, adminEmail?: string | null) {
    const { error } = await this.supabase
      .getClient()
      .from('stock_recuperacion_solicitudes')
      .update({
        estado: 'resuelta',
        resuelta_at: new Date().toISOString(),
        resuelta_por: adminEmail || null,
      })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Envía el correo de bienvenida (clave temporal + período + paso a paso).
  // Sale por el SMTP del sistema (no depende del Gmail del admin). Si el
  // cliente no tiene correo válido, no falla la habilitación: solo avisa.
  private async enviarCorreoBienvenida(opts: {
    rut: string;
    razonSocial?: string | null;
    email?: string | null;
    passwordTemporal: string;
    vigencia: string;
    expira: string | null;
  }): Promise<{ enviado: boolean; para: string | null }> {
    const rutN = normalizarRut(opts.rut);
    let para = String(opts.email || '').trim().toLowerCase();
    if (!para) {
      const cli = await this.buscarClientePorRut(rutN);
      para = String(cli?.email || '').trim().toLowerCase();
    }
    if (!RE_EMAIL.test(para)) {
      this.logger.warn(
        `Bienvenida portal: cliente ${rutN} sin correo válido; no se envió.`,
      );
      return { enviado: false, para: null };
    }

    const base = String(
      process.env.APP_PUBLIC_URL ||
        process.env.PUBLIC_APP_URL ||
        process.env.FRONTEND_URL ||
        'http://localhost:5173',
    ).replace(/\/+$/, '');
    const urlPortal = `${base}/portal-cliente`;
    const expiraTexto = opts.expira
      ? new Date(opts.expira).toLocaleDateString('es-CL', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '';

    const { asunto, html } = plantillaBienvenidaPortal({
      razonSocial: String(opts.razonSocial || '').trim() || formatearRut(rutN),
      rutFmt: formatearRut(rutN),
      passwordTemporal: opts.passwordTemporal,
      vigenciaTexto: vigenciaTexto(opts.vigencia),
      expiraTexto,
      urlPortal,
    });

    try {
      await this.mailings.enviarUno({ para, asunto, cuerpoHtml: html });
      return { enviado: true, para };
    } catch (e: any) {
      this.logger.warn(
        `Bienvenida portal falló para ${para}: ${e?.message || e}`,
      );
      return { enviado: false, para };
    }
  }

  // ── Productos del cliente (persistentes entre sesiones) ───────────────

  // ── Sucursales del cliente (catálogos de stock por dirección) ──────────
  // Lista las sucursales activas. Si el cliente no tiene ninguna, crea una
  // "Casa Matriz" por defecto para que siempre exista al menos una.
  // Sucursales visibles en el PORTAL del cliente: activas Y habilitadas por el
  // admin. Tolera que la columna `habilitada_portal` aún no esté migrada (42703):
  // en ese caso cae al comportamiento anterior (todas las activas).
  async listarSucursales(rut: string) {
    const rutN = normalizarRut(rut);
    if (!rutN) return [];
    // Garantiza la Casa Matriz por defecto (con dirección/contacto del cliente).
    await this.asegurarCasaMatriz(rutN);
    const client = this.supabase.getClient();
    let { data, error } = await client
      .from('stock_sucursales')
      .select('*')
      .eq('rut', rutN)
      .eq('activo', true)
      .eq('habilitada_portal', true)
      .order('created_at', { ascending: true });
    if (error) {
      const msg = [error.message, (error as any).code].filter(Boolean).join(' ').toLowerCase();
      if (msg.includes('habilitada_portal') || msg.includes('42703')) {
        ({ data, error } = await client
          .from('stock_sucursales')
          .select('*')
          .eq('rut', rutN)
          .eq('activo', true)
          .order('created_at', { ascending: true }));
      }
    }
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // Datos generales del cliente CRM (dirección + contacto) para poblar la Casa
  // Matriz por defecto. Empareja por RUT normalizado (el maestro guarda el RUT
  // con formato). Devuelve null si el cliente no está en el maestro.
  private async datosGeneralesCliente(
    rutNorm: string,
  ): Promise<{ direccion: string; comuna: string; contacto: string; telefono: string; email: string } | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('*')
      .range(0, 20000);
    if (error) return null;
    const c: any = (data || []).find((x: any) => normalizarRut(x?.rut) === rutNorm);
    if (!c) return null;
    return {
      direccion: String(c.direccion || '').trim(),
      comuna: String(c.comuna || '').trim(),
      contacto: String(c.contacto || '').trim(),
      telefono: String(c.telefono || '').trim(),
      email: String(c.email || '').trim(),
    };
  }

  // Inserta una sucursal tolerando columnas aún no migradas (42703): si la BD
  // rechaza una columna, la quita del payload y reintenta.
  private async insertarSucursalTolerante(row: any): Promise<any> {
    const client = this.supabase.getClient();
    const intento: any = { ...row };
    for (let i = 0; i < 6; i++) {
      const { data, error } = await client
        .from('stock_sucursales')
        .insert(intento)
        .select()
        .single();
      if (!error) return data;
      const msg = [error.message, (error as any).code].filter(Boolean).join(' ').toLowerCase();
      const col = /column "([^"]+)"/.exec(error.message || '')?.[1];
      if (col && col in intento && (msg.includes('42703') || msg.includes('does not exist'))) {
        delete intento[col];
        continue;
      }
      throw new BadRequestException(error.message);
    }
    throw new BadRequestException('No se pudo crear la sucursal.');
  }

  // Actualiza una sucursal tolerando columnas aún no migradas (42703).
  private async actualizarSucursalTolerante(id: number, patch: any): Promise<any> {
    const client = this.supabase.getClient();
    const intento: any = { ...patch };
    for (let i = 0; i < 6; i++) {
      const { data, error } = await client
        .from('stock_sucursales')
        .update(intento)
        .eq('id', id)
        .select()
        .single();
      if (!error) return data;
      const msg = [error.message, (error as any).code].filter(Boolean).join(' ').toLowerCase();
      const col = /column "([^"]+)"/.exec(error.message || '')?.[1];
      if (col && col in intento && (msg.includes('42703') || msg.includes('does not exist'))) {
        delete intento[col];
        continue;
      }
      throw new BadRequestException(error.message);
    }
    throw new BadRequestException('No se pudo actualizar la sucursal.');
  }

  // Garantiza que el cliente tenga al menos una sucursal. Si no tiene ninguna,
  // crea "Casa Matriz" por defecto (habilitada en el portal) tomando la
  // dirección y el contacto generales del cliente CRM. Devuelve la lista
  // completa de sucursales del RUT (existentes o la recién creada).
  private async asegurarCasaMatriz(rutN: string): Promise<any[]> {
    const client = this.supabase.getClient();
    const { data: existentes, error } = await client
      .from('stock_sucursales')
      .select('*')
      .eq('rut', rutN)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    if (existentes && existentes.length > 0) return existentes;

    const cli = await this.datosGeneralesCliente(rutN);
    const creada = await this.insertarSucursalTolerante({
      rut: rutN,
      nombre: 'Casa Matriz',
      direccion: cli?.direccion || null,
      comuna: cli?.comuna || null,
      contacto: cli?.contacto || null,
      telefono: cli?.telefono || null,
      email: cli?.email || null,
      habilitada_portal: true,
    });
    return [creada];
  }

  // Habilita/deshabilita una sucursal para el portal (solo admin). No la borra,
  // solo controla su visibilidad en el portal del cliente.
  async habilitarSucursalPortal(rut: string, id: number, habilitada: boolean) {
    const rutN = normalizarRut(rut);
    const client = this.supabase.getClient();
    const { data: suc } = await client
      .from('stock_sucursales')
      .select('id, rut')
      .eq('id', id)
      .maybeSingle();
    if (!suc) throw new NotFoundException('Sucursal no encontrada.');
    if (rutN && normalizarRut(suc.rut) !== rutN) throw new ForbiddenException('No autorizado.');
    const { data, error } = await client
      .from('stock_sucursales')
      .update({ habilitada_portal: !!habilitada })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crearSucursal(
    rut: string,
    body: {
      nombre?: string; direccion?: string; comuna?: string;
      contacto?: string; telefono?: string; email?: string;
    },
  ) {
    const rutN = normalizarRut(rut);
    if (!rutN) throw new UnauthorizedException('Sesión inválida.');
    const nombre = String(body?.nombre || '').trim().slice(0, 160);
    if (!nombre) throw new BadRequestException('El nombre de la sucursal es obligatorio.');
    return await this.insertarSucursalTolerante({
      rut: rutN,
      nombre,
      direccion: String(body?.direccion || '').trim().slice(0, 300) || null,
      comuna: String(body?.comuna || '').trim().slice(0, 120) || null,
      contacto: String(body?.contacto || '').trim().slice(0, 160) || null,
      telefono: String(body?.telefono || '').trim().slice(0, 60) || null,
      email: String(body?.email || '').trim().slice(0, 160) || null,
    });
  }

  async actualizarSucursal(
    rut: string,
    id: number,
    body: {
      nombre?: string; direccion?: string; comuna?: string;
      contacto?: string; telefono?: string; email?: string;
    },
  ) {
    const rutN = normalizarRut(rut);
    const client = this.supabase.getClient();
    const { data: suc } = await client
      .from('stock_sucursales')
      .select('id, rut')
      .eq('id', id)
      .maybeSingle();
    if (!suc) throw new NotFoundException('Sucursal no encontrada.');
    if (normalizarRut(suc.rut) !== rutN) throw new ForbiddenException('No autorizado.');
    const patch: any = {};
    if (body?.nombre !== undefined) {
      const n = String(body.nombre || '').trim().slice(0, 160);
      if (!n) throw new BadRequestException('El nombre de la sucursal es obligatorio.');
      patch.nombre = n;
    }
    if (body?.direccion !== undefined) patch.direccion = String(body.direccion || '').trim().slice(0, 300) || null;
    if (body?.comuna !== undefined) patch.comuna = String(body.comuna || '').trim().slice(0, 120) || null;
    if (body?.contacto !== undefined) patch.contacto = String(body.contacto || '').trim().slice(0, 160) || null;
    if (body?.telefono !== undefined) patch.telefono = String(body.telefono || '').trim().slice(0, 60) || null;
    if (body?.email !== undefined) patch.email = String(body.email || '').trim().slice(0, 160) || null;
    return await this.actualizarSucursalTolerante(id, patch);
  }

  async eliminarSucursal(rut: string, id: number) {
    const rutN = normalizarRut(rut);
    const client = this.supabase.getClient();
    const { data: suc } = await client
      .from('stock_sucursales')
      .select('id, rut')
      .eq('id', id)
      .maybeSingle();
    if (!suc) throw new NotFoundException('Sucursal no encontrada.');
    if (normalizarRut(suc.rut) !== rutN) throw new ForbiddenException('No autorizado.');
    // Baja lógica para conservar el histórico de declaraciones de la sucursal.
    const { error } = await client
      .from('stock_sucursales')
      .update({ activo: false })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Sucursales por RUT para el dashboard admin (incluye inactivas). Garantiza
  // la Casa Matriz por defecto (con dirección/contacto del cliente) si el
  // cliente aún no tiene ninguna sucursal registrada.
  async listarSucursalesPorRut(rut: string) {
    const rutN = normalizarRut(rut);
    if (!rutN) return [];
    await this.asegurarCasaMatriz(rutN);
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_sucursales')
      .select('*')
      .eq('rut', rutN)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // ── Ubicaciones (bodega/caja/estante) gestionadas por el cliente ──────────
  async listarUbicaciones(rut: string, incluirInactivas = false) {
    const rutN = normalizarRut(rut);
    if (!rutN) return [];
    let q = this.supabase.getClient().from('stock_ubicaciones').select('*').eq('rut', rutN);
    if (!incluirInactivas) q = q.eq('activo', true);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) {
      // Si la tabla aún no existe (migración no aplicada), no rompemos el portal.
      if ((error.message || '').toLowerCase().includes('stock_ubicaciones')) return [];
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  async crearUbicacion(rut: string, body: { nombre?: string }) {
    const rutN = normalizarRut(rut);
    if (!rutN) throw new UnauthorizedException('Sesión inválida.');
    const nombre = String(body?.nombre || '').trim().slice(0, 120);
    if (!nombre) throw new BadRequestException('El nombre de la ubicación es obligatorio.');
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_ubicaciones')
      .insert({ rut: rutN, nombre })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizarUbicacion(rut: string, id: number, body: { nombre?: string }) {
    const rutN = normalizarRut(rut);
    const client = this.supabase.getClient();
    const { data: u } = await client.from('stock_ubicaciones').select('id, rut').eq('id', id).maybeSingle();
    if (!u) throw new NotFoundException('Ubicación no encontrada.');
    if (normalizarRut(u.rut) !== rutN) throw new ForbiddenException('No autorizado.');
    const nombre = String(body?.nombre || '').trim().slice(0, 120);
    if (!nombre) throw new BadRequestException('El nombre de la ubicación es obligatorio.');
    const { data, error } = await client
      .from('stock_ubicaciones')
      .update({ nombre })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminarUbicacion(rut: string, id: number) {
    const rutN = normalizarRut(rut);
    const client = this.supabase.getClient();
    const { data: u } = await client.from('stock_ubicaciones').select('id, rut').eq('id', id).maybeSingle();
    if (!u) throw new NotFoundException('Ubicación no encontrada.');
    if (normalizarRut(u.rut) !== rutN) throw new ForbiddenException('No autorizado.');
    const { error } = await client.from('stock_ubicaciones').update({ activo: false }).eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async listarProductos(rut: string, sucursalId?: number | null) {
    const rutN = normalizarRut(rut);
    let q = this.supabase
      .getClient()
      .from('stock_productos_cliente')
      .select('*')
      .eq('rut', rutN)
      .eq('activo', true);
    if (sucursalId) q = q.eq('sucursal_id', sucursalId);
    const { data, error } = await q.order('nombre', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    return (data || []).map((p: any) => ({
      ...p,
      marca: p.marca || null,
      stock_actual: Number(p.stock_actual) || 0,
      stock_minimo: Number(p.stock_minimo) || 0,
      stock_alerta:
        p.stock_alerta == null || p.stock_alerta === ''
          ? null
          : Number(p.stock_alerta),
      precio_unitario: precioEnteroPesos(p.precio_unitario),
      es_critico: !!p.es_critico,
      semaforo: calcularSemaforo(
        p.stock_actual,
        p.stock_minimo,
        p.stock_alerta,
      ),
    }));
  }

  // Guarda una declaración: actualiza la lista persistente del cliente
  // y crea un snapshot. Si hay items en amarillo o rojo, notifica.
  async crearDeclaracion(
    payload: StockTokenPayload,
    body: {
      sucursal_id?: number | string | null;
      items: Array<{
        nombre: string;
        sku?: string;
        marca?: string;
        unidad?: string;
        stock_actual: number | string;
        stock_minimo: number | string;
        stock_alerta?: number | string | null;
        precio_unitario?: number | string | null;
        es_critico?: boolean;
      }>;
    },
    meta: { ip?: string | null; user_agent?: string | null },
  ) {
    const rutN = normalizarRut(payload.rut);
    if (!rutN) throw new UnauthorizedException('Sesión inválida.');

    // Sucursal destino: la del body o, si no vino, la Casa Matriz por defecto.
    let sucursalId = body?.sucursal_id ? Number(body.sucursal_id) : null;
    if (!sucursalId) {
      const sucs = await this.listarSucursales(rutN);
      sucursalId = sucs?.[0]?.id ?? null;
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      throw new BadRequestException(
        'Debe agregar al menos un producto antes de guardar la declaración.',
      );
    }

    // Sanitiza y calcula semáforo de cada item
    const itemsLimpios: ItemDeclaracion[] = items
      .map((it) => {
        const nombre = String(it?.nombre || '').trim().slice(0, 200);
        const sku = String(it?.sku || '').trim().slice(0, 80) || null;
        const marca = String(it?.marca || '').trim().slice(0, 100) || null;
        const unidad = String(it?.unidad || '').trim().slice(0, 50) || null;
        const stock_actual = Number(it?.stock_actual) || 0;
        const stock_minimo = Number(it?.stock_minimo) || 0;
        const alertaRaw = it?.stock_alerta;
        const alertaNum =
          alertaRaw == null || alertaRaw === ''
            ? null
            : Number(alertaRaw);
        const stock_alerta =
          alertaNum != null && Number.isFinite(alertaNum) && alertaNum > 0
            ? alertaNum
            : null;
        const precio_unitario = precioEnteroPesos(it?.precio_unitario);
        const es_critico = it?.es_critico === true;
        const ubicacion_id =
          (it as any)?.ubicacion_id == null || (it as any)?.ubicacion_id === ''
            ? null
            : Number((it as any).ubicacion_id);
        const ubicacion = String((it as any)?.ubicacion || '').trim().slice(0, 120) || null;
        return {
          nombre,
          sku,
          marca,
          unidad,
          stock_actual,
          stock_minimo,
          stock_alerta,
          precio_unitario,
          es_critico,
          ubicacion_id: ubicacion_id != null && Number.isFinite(ubicacion_id) ? ubicacion_id : null,
          ubicacion,
          semaforo: calcularSemaforo(stock_actual, stock_minimo, stock_alerta),
        };
      })
      .filter((it) => it.nombre.length > 0);

    if (itemsLimpios.length === 0) {
      throw new BadRequestException(
        'Los productos deben tener un nombre válido.',
      );
    }

    const totales = itemsLimpios.reduce(
      (acc, it) => {
        if (it.semaforo === 'rojo') acc.rojos += 1;
        else if (it.semaforo === 'amarillo') acc.amarillos += 1;
        else acc.verdes += 1;
        return acc;
      },
      { verdes: 0, amarillos: 0, rojos: 0 },
    );

    const client = this.supabase.getClient();

    // 1) Inserta snapshot de la declaración
    const ahora = new Date().toISOString();
    const { data: declaracion, error: errIns } = await client
      .from('stock_declaraciones')
      .insert({
        rut: rutN,
        sucursal_id: sucursalId,
        razon_social: payload.razon_social || null,
        fecha: ahora,
        total_items: itemsLimpios.length,
        total_verdes: totales.verdes,
        total_amarillos: totales.amarillos,
        total_rojos: totales.rojos,
        items: itemsLimpios,
        ip_address: meta.ip || null,
        user_agent: meta.user_agent || null,
      })
      .select()
      .single();
    if (errIns) throw new BadRequestException(errIns.message);

    // 2) Sincroniza la lista persistente del cliente. Para no perder los
    //    productos previos si el insert falla (p. ej. por un cambio de
    //    esquema), insertamos primero los nuevos y recién después borramos
    //    los anteriores. El cliente puede renombrar libremente sus productos,
    //    por eso reemplazamos toda la lista en vez de hacer matching por nombre.
    // Scope al catálogo de ESTA sucursal para no tocar el de las demás.
    let previosQuery = client
      .from('stock_productos_cliente')
      .select('id')
      .eq('rut', rutN);
    previosQuery = sucursalId
      ? previosQuery.eq('sucursal_id', sucursalId)
      : previosQuery.is('sucursal_id', null);
    const { data: previos } = await previosQuery;
    const idsPrevios = (previos || []).map((p: any) => p.id);

    const productosRows = itemsLimpios.map((it) => ({
      rut: rutN,
      sucursal_id: sucursalId,
      nombre: it.nombre,
      sku: it.sku ?? null,
      marca: it.marca,
      unidad: it.unidad,
      stock_actual: it.stock_actual,
      stock_minimo: it.stock_minimo,
      stock_alerta: it.stock_alerta,
      precio_unitario: it.precio_unitario,
      es_critico: it.es_critico === true,
      ubicacion_id: (it as any).ubicacion_id ?? null,
      activo: true,
      actualizado_at: ahora,
    }));
    let { error: errInsProd } = await client
      .from('stock_productos_cliente')
      .insert(productosRows);
    // Si las columnas `sku`/`ubicacion_id` aún no existen (migración pendiente),
    // reintenta sin ellas para no bloquear la declaración.
    if (
      errInsProd &&
      (errInsProd.code === '42703' || /sku|ubicacion_id/i.test(errInsProd.message || ''))
    ) {
      const rowsSinExtras = productosRows.map(({ sku, ubicacion_id, ...resto }) => resto);
      ({ error: errInsProd } = await client
        .from('stock_productos_cliente')
        .insert(rowsSinExtras));
    }
    if (errInsProd) {
      // No borramos los previos: la lista persistente conserva su estado
      // anterior y avisamos del problema en vez de perder datos en silencio.
      this.logger.error(
        `No se pudieron persistir productos del cliente: ${errInsProd.message}`,
      );
      throw new BadRequestException(
        `No se pudo guardar la lista de productos: ${errInsProd.message}`,
      );
    }
    if (idsPrevios.length > 0) {
      const { error: errDel } = await client
        .from('stock_productos_cliente')
        .delete()
        .in('id', idsPrevios);
      if (errDel) {
        this.logger.warn(
          `No se pudieron limpiar productos previos del cliente: ${errDel.message}`,
        );
      }
    }

    // 3) Notificaciones si hay rojos o amarillos
    if (totales.rojos > 0 || totales.amarillos > 0) {
      await this.notificarDestinatarios({
        rut: rutN,
        razonSocial: payload.razon_social || '',
        declaracionId: Number(declaracion?.id),
        totales,
        items: itemsLimpios,
      });
    }

    return {
      ok: true,
      declaracion: {
        id: declaracion?.id,
        fecha: declaracion?.fecha,
        total_items: itemsLimpios.length,
        total_verdes: totales.verdes,
        total_amarillos: totales.amarillos,
        total_rojos: totales.rojos,
      },
    };
  }

  // ── Solicitud de cotización desde el portal ──────────────────────────

  async crearSolicitudCotizacion(
    payload: StockTokenPayload,
    body: {
      items: Array<{
        nombre: string;
        unidad?: string;
        cantidad: number | string;
      }>;
      nota?: string;
      contacto_nombre?: string;
      contacto_email?: string;
      contacto_telefono?: string;
      sucursal_id?: number | string | null;
    },
    meta: { ip?: string | null; user_agent?: string | null },
  ) {
    const rutN = normalizarRut(payload.rut);
    if (!rutN) throw new UnauthorizedException('Sesión inválida.');

    // Bloqueo por mora: el cliente del portal es particular (umbral 60 días).
    // Las licitaciones guardan el rut con formato (puntos/guión), así que
    // consultamos con el rut formateado para que calce con rut_entidad.
    const bloqueo = await this.licitaciones.estadoBloqueoCliente(formatearRut(rutN), 'Cliente Particular');
    if (bloqueo.bloqueado) {
      throw new BadRequestException(
        `No es posible enviar la solicitud: registras ${bloqueo.diasAtrasoMax} días de atraso en pagos (máximo ${bloqueo.umbral}). Regulariza tu cuenta para volver a cotizar.`,
      );
    }

    let sucursalId = body?.sucursal_id ? Number(body.sucursal_id) : null;
    if (!sucursalId) {
      const sucs = await this.listarSucursales(rutN);
      sucursalId = sucs?.[0]?.id ?? null;
    }

    const itemsRaw = Array.isArray(body?.items) ? body.items : [];
    const items = itemsRaw
      .map((it) => {
        const nombre = String(it?.nombre || '').trim().slice(0, 200);
        const unidad = String(it?.unidad || '').trim().slice(0, 50) || null;
        const cantidad = Number(it?.cantidad) || 0;
        return { nombre, unidad, cantidad };
      })
      .filter((it) => it.nombre.length > 0 && it.cantidad > 0);

    if (items.length === 0) {
      throw new BadRequestException(
        'Seleccione al menos un producto con cantidad mayor a cero para solicitar la cotización.',
      );
    }

    const razonSocial = payload.razon_social || '';
    const rutFmt = formatearRut(rutN);
    const contactoNombre = String(body?.contacto_nombre || '').trim().slice(0, 160) || null;
    const contactoEmail = String(body?.contacto_email || '').trim().toLowerCase() || null;
    const contactoTelefono = String(body?.contacto_telefono || '').trim() || null;
    const nota = String(body?.nota || '').trim().slice(0, 1000) || null;

    const client = this.supabase.getClient();
    const { data: solicitud, error } = await client
      .from('stock_solicitudes_cotizacion')
      .insert({
        rut: rutN,
        sucursal_id: sucursalId,
        razon_social: razonSocial,
        contacto_nombre: contactoNombre,
        contacto_email: contactoEmail,
        contacto_telefono: contactoTelefono,
        nota,
        items,
        ip_address: meta.ip || null,
        user_agent: meta.user_agent || null,
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);

    // Notificaciones (campana + correo) a los destinatarios configurados
    await this.notificarSolicitud({
      rut: rutN,
      razonSocial,
      rutFmt,
      solicitudId: Number(solicitud?.id),
      items,
      nota,
      contactoNombre,
      contactoEmail,
      contactoTelefono,
    });

    return {
      ok: true,
      solicitud: {
        id: solicitud?.id,
        items: items.length,
      },
    };
  }

  private async notificarSolicitud(args: {
    rut: string;
    razonSocial: string;
    rutFmt: string;
    solicitudId: number;
    items: Array<{ nombre: string; unidad: string | null; cantidad: number }>;
    nota: string | null;
    contactoNombre: string | null;
    contactoEmail: string | null;
    contactoTelefono: string | null;
  }) {
    const client = this.supabase.getClient();
    const { data: destinatarios } = await client
      .from('stock_destinatarios')
      .select('user_email, recibe_campana, recibe_correo, activo')
      .eq('activo', true);
    const lista = (destinatarios || []).filter((d: any) => d?.user_email);
    if (lista.length === 0) return;

    const cliente = args.razonSocial || args.rutFmt;
    const mensaje = `${cliente} solicita cotización por ${args.items.length} producto${args.items.length === 1 ? '' : 's'}.`;

    // Campana
    const rowsCampana = lista
      .filter((d: any) => d.recibe_campana !== false)
      .map((d: any) => ({
        user_email: String(d.user_email).toLowerCase(),
        tipo: 'stock_solicitud_cotizacion',
        mensaje,
        link: `/monitoreo-stock?solicitud=${args.solicitudId}`,
        metadata: {
          rut: args.rut,
          rut_formateado: args.rutFmt,
          razon_social: args.razonSocial,
          solicitud_id: args.solicitudId,
          total_items: args.items.length,
        },
      }));
    if (rowsCampana.length > 0) {
      const { error } = await client.from('notificaciones').insert(rowsCampana);
      if (error) this.logger.warn(`Notificación campana (solicitud) falló: ${error.message}`);
    }

    // Correo
    const destinatariosCorreo = lista
      .filter((d: any) => d.recibe_correo !== false)
      .map((d: any) => String(d.user_email).toLowerCase());
    if (destinatariosCorreo.length === 0) return;

    const enlaceBase = String(
      process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || '',
    ).trim();
    const enlace = enlaceBase
      ? `${enlaceBase.replace(/\/+$/, '')}/monitoreo-stock?solicitud=${args.solicitudId}`
      : undefined;

    const { asunto, html } = plantillaSolicitudCotizacion({
      razonSocial: args.razonSocial || args.rutFmt,
      rutFmt: args.rutFmt,
      contactoNombre: args.contactoNombre || undefined,
      contactoEmail: args.contactoEmail || undefined,
      contactoTelefono: args.contactoTelefono || undefined,
      nota: args.nota || undefined,
      items: args.items,
      enlace,
    });

    for (const para of destinatariosCorreo) {
      try {
        await this.mailings.enviarUno({ para, asunto, cuerpoHtml: html });
      } catch (e: any) {
        this.logger.warn(`Correo de solicitud falló para ${para}: ${e?.message || e}`);
      }
    }
  }

  // Para el detalle del cliente en el dashboard admin: solicitudes del RUT.
  // Cambia el estado de una solicitud (pendiente / respondida / cancelada).
  // Se llama desde el dashboard admin cuando el equipo atiende o descarta
  // una solicitud, o automáticamente al crear una cotización desde ella.
  async actualizarEstadoSolicitud(id: number, estado: string) {
    const estadosValidos = ['pendiente', 'respondida', 'cancelada'];
    const estadoNorm = String(estado || '').toLowerCase().trim();
    if (!estadosValidos.includes(estadoNorm)) {
      throw new BadRequestException(
        `Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}.`,
      );
    }
    const update: any = { estado: estadoNorm };
    if (estadoNorm === 'respondida') {
      update.respondida_at = new Date().toISOString();
    } else if (estadoNorm === 'pendiente') {
      update.respondida_at = null;
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_solicitudes_cotizacion')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Vincula una solicitud con la cotización (licitación) creada a partir de ella.
  async vincularLicitacion(solicitudId: number, licitacionId: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_solicitudes_cotizacion')
      .update({ licitacion_id: licitacionId, estado: 'respondida', respondida_at: new Date().toISOString() })
      .eq('id', solicitudId)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Datos de la cotización vinculada a una solicitud, listos para el PDF del
  // portal (generarPDFcotizacion). Si se pasa rutScope, valida pertenencia.
  async cotizacionDeSolicitud(solicitudId: number, rutScope?: string) {
    const client = this.supabase.getClient();
    const { data: sol } = await client
      .from('stock_solicitudes_cotizacion')
      .select('id, rut, licitacion_id')
      .eq('id', solicitudId)
      .maybeSingle();
    if (!sol) throw new NotFoundException('Solicitud no encontrada.');
    if (rutScope && normalizarRut(sol.rut) !== normalizarRut(rutScope)) {
      throw new ForbiddenException('No autorizado.');
    }
    if (!sol.licitacion_id) return { cotizacion: null, datos: null };
    const { data: lic } = await client.from('licitaciones').select('*').eq('id', sol.licitacion_id).maybeSingle();
    if (!lic) return { cotizacion: null, datos: null };
    const { data: items } = await client
      .from('items_licitacion')
      .select('*')
      .eq('licitacion_id', lic.id)
      .order('orden', { ascending: true });
    return {
      cotizacion: { id: lic.id, id_licitacion: lic.id_licitacion, estado: lic.estado },
      datos: this.construirDatosCotizacion(lic, items || []),
    };
  }

  // Detalle de una cotización del historial del cliente (productos + datos para
  // el PDF), validado por el RUT del token del portal.
  async cotizacionDeLicitacion(licId: number, rutScope?: string) {
    const client = this.supabase.getClient();
    const { data: lic } = await client
      .from('licitaciones')
      .select('*')
      .eq('id', licId)
      .maybeSingle();
    if (!lic) throw new NotFoundException('Cotización no encontrada.');
    if (rutScope && normalizarRut(lic.rut_entidad) !== normalizarRut(rutScope)) {
      throw new ForbiddenException('No autorizado.');
    }
    const { data: items } = await client
      .from('items_licitacion')
      .select('*')
      .eq('licitacion_id', lic.id)
      .order('orden', { ascending: true });
    return {
      cotizacion: { id: lic.id, id_licitacion: lic.id_licitacion, estado: lic.estado },
      datos: this.construirDatosCotizacion(lic, items || []),
    };
  }

  // Arma el objeto `datos` que consume el generador de PDF de cotización a
  // partir de una licitación y sus ítems.
  private construirDatosCotizacion(lic: any, items: any[]) {
    const fmt = (n: any) => Number(n || 0).toLocaleString('es-CL');
    return {
      numero_licitacion: lic.id,
      id_licitacion: lic.id_licitacion || '',
      fecha_creacion: String(lic.created_at || '').slice(0, 10),
      fecha_adjudicacion: lic.fecha_adjudicada || '',
      nombre_entidad: lic.nombre_entidad || '',
      rut_entidad: lic.rut_entidad || '',
      direccion: lic.direccion || '',
      comuna: lic.comuna || '',
      contacto: lic.contacto || '',
      email: lic.email || '',
      telefono: lic.telefono || '',
      condicion_venta: lic.condicion_venta || '',
      vendedor_nombre: lic.vendedor_nombre || '',
      vendedor_celular: lic.vendedor_celular || '',
      vendedor_correo: lic.vendedor_correo || '',
      observaciones: lic.observaciones || '',
      items: (items || []).map((it: any, i: number) => ({
        n: i + 1,
        sku: String(it.sku || '').trim(),
        producto: it.producto || '',
        formato: it.formato || '',
        cantidad: it.cantidad,
        precio_unitario: fmt(it.valor_unitario),
        total: fmt(it.total),
        observacion: it.observacion || '',
      })),
      afecto: fmt(lic.total_sin_iva),
      iva: fmt(lic.total_iva),
      total_con_iva: fmt(lic.total_con_iva),
    };
  }

  // ── Hilo de mensajes cliente ↔ equipo ────────────────────────────────
  async listarMensajes(solicitudId: number, opts: { rut?: string }) {
    const client = this.supabase.getClient();
    const { data: sol } = await client
      .from('stock_solicitudes_cotizacion')
      .select('id, rut')
      .eq('id', solicitudId)
      .maybeSingle();
    if (!sol) throw new NotFoundException('Solicitud no encontrada.');
    if (opts.rut && normalizarRut(sol.rut) !== normalizarRut(opts.rut)) {
      throw new ForbiddenException('No autorizado.');
    }
    const { data, error } = await client
      .from('stock_cotizacion_mensajes')
      .select('*')
      .eq('solicitud_id', solicitudId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    // Marca como leídos los mensajes del otro lado.
    const lado = opts.rut ? 'cliente' : 'equipo';
    const col = lado === 'cliente' ? 'leido_cliente' : 'leido_equipo';
    const otro = lado === 'cliente' ? 'equipo' : 'cliente';
    await client
      .from('stock_cotizacion_mensajes')
      .update({ [col]: true })
      .eq('solicitud_id', solicitudId)
      .eq('autor_tipo', otro)
      .eq(col, false);
    return data || [];
  }

  async crearMensaje(
    solicitudId: number,
    payload: { mensaje: string; autorTipo: 'cliente' | 'equipo'; autorEmail?: string; autorNombre?: string },
    opts: { rut?: string },
  ) {
    const client = this.supabase.getClient();
    const { data: sol } = await client
      .from('stock_solicitudes_cotizacion')
      .select('id, rut, razon_social, contacto_email, licitacion_id')
      .eq('id', solicitudId)
      .maybeSingle();
    if (!sol) throw new NotFoundException('Solicitud no encontrada.');
    if (opts.rut && normalizarRut(sol.rut) !== normalizarRut(opts.rut)) {
      throw new ForbiddenException('No autorizado.');
    }
    const texto = String(payload.mensaje || '').trim().slice(0, 2000);
    if (!texto) throw new BadRequestException('El mensaje no puede estar vacío.');
    const fila = {
      solicitud_id: solicitudId,
      autor_tipo: payload.autorTipo,
      autor_email: payload.autorEmail || null,
      autor_nombre: payload.autorNombre || null,
      mensaje: texto,
      leido_cliente: payload.autorTipo === 'cliente',
      leido_equipo: payload.autorTipo === 'equipo',
    };
    const { data, error } = await client
      .from('stock_cotizacion_mensajes')
      .insert(fila)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    try { await this.notificarMensaje(sol, payload.autorTipo, texto, payload.autorNombre); } catch (e: any) {
      this.logger.warn(`Notificación de mensaje falló: ${e?.message || e}`);
    }
    return data;
  }

  private async notificarMensaje(
    sol: any,
    autorTipo: 'cliente' | 'equipo',
    texto: string,
    autorNombre?: string,
  ) {
    const client = this.supabase.getClient();
    const cliente = sol.razon_social || formatearRut(normalizarRut(sol.rut));
    if (autorTipo === 'cliente') {
      // Cliente → equipo (destinatarios configurados).
      const { data: dest } = await client
        .from('stock_destinatarios')
        .select('user_email, recibe_campana, recibe_correo, activo')
        .eq('activo', true);
      const lista = (dest || []).filter((d: any) => d?.user_email);
      const mensaje = `${cliente} envió un mensaje sobre su cotización (solicitud #${sol.id}).`;
      const rowsCampana = lista
        .filter((d: any) => d.recibe_campana !== false)
        .map((d: any) => ({
          user_email: String(d.user_email).toLowerCase(),
          tipo: 'stock_cotizacion_mensaje',
          mensaje,
          link: `/monitoreo-stock?solicitud=${sol.id}`,
          metadata: { solicitud_id: sol.id },
        }));
      if (rowsCampana.length) await client.from('notificaciones').insert(rowsCampana);
      const correos = lista.filter((d: any) => d.recibe_correo !== false).map((d: any) => String(d.user_email).toLowerCase());
      for (const para of correos) {
        try {
          await this.mailings.enviarUno({
            para,
            asunto: `💬 ${cliente} respondió sobre su cotización`,
            cuerpoHtml: `<p><strong>${cliente}</strong> escribió respecto a su cotización (solicitud #${sol.id}):</p><blockquote>${texto}</blockquote><p>Ingresa al monitoreo de stock para responder.</p>`,
          });
        } catch { /* */ }
      }
    } else {
      // Equipo → cliente (correo al contacto de la solicitud).
      const para = String(sol.contacto_email || '').trim().toLowerCase();
      if (para) {
        try {
          await this.mailings.enviarUno({
            para,
            asunto: 'Amsodent · Actualización de su cotización',
            cuerpoHtml: `<p>${autorNombre || 'El equipo de Amsodent'} le escribió respecto a su cotización:</p><blockquote>${texto}</blockquote><p>Ingrese a su portal para ver el detalle y responder.</p>`,
          });
        } catch { /* */ }
      }
    }
  }

  async listarSolicitudesPorRut(rut: string, limit = 50) {
    const rutN = normalizarRut(rut);
    if (!rutN) return [];
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_solicitudes_cotizacion')
      .select(
        'id, items, nota, contacto_nombre, contacto_email, contacto_telefono, estado, respondida_at, created_at, licitacion_id',
      )
      .eq('rut', rutN)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new BadRequestException(error.message);
    return await this.enriquecerSolicitudes(data || [], 'equipo');
  }

  async listarMisSolicitudes(rut: string, limit = 50) {
    const rutN = normalizarRut(rut);
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_solicitudes_cotizacion')
      .select(
        'id, items, nota, contacto_nombre, contacto_email, contacto_telefono, estado, respondida_at, created_at, licitacion_id',
      )
      .eq('rut', rutN)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new BadRequestException(error.message);
    return await this.enriquecerSolicitudes(data || [], 'cliente');
  }

  // Historial de cotizaciones del sistema principal a nombre del cliente. Se
  // filtra por RUT normalizado porque en `licitaciones` el RUT puede venir con o
  // sin puntos/guion. Incluye las creadas directamente por el equipo (bitácora /
  // módulo de licitaciones), no solo las que nacen de una solicitud de stock.
  async listarMisCotizaciones(rut: string, limit = 100) {
    const rutN = normalizarRut(rut);
    if (!rutN) return [];
    const { data, error } = await this.supabase
      .getClient()
      .from('licitaciones')
      .select(
        'id, id_licitacion, nombre, nombre_entidad, rut_entidad, estado, fecha, fecha_adjudicada, total_con_iva, total_sin_iva',
      )
      .not('rut_entidad', 'is', null)
      .order('fecha', { ascending: false, nullsFirst: false });
    if (error) throw new BadRequestException(error.message);
    return (data || [])
      .filter((l: any) => normalizarRut(l.rut_entidad) === rutN)
      .slice(0, limit)
      .map((l: any) => ({
        id: l.id,
        id_licitacion: l.id_licitacion,
        nombre: l.nombre,
        nombre_entidad: l.nombre_entidad,
        estado: l.estado,
        fecha: l.fecha,
        fecha_adjudicada: l.fecha_adjudicada,
        total_con_iva: l.total_con_iva,
        total_sin_iva: l.total_sin_iva,
      }));
  }

  // Agrega a cada solicitud su cotización vinculada (id/estado) y la cantidad de
  // mensajes no leídos por el lado que consulta (cliente o equipo).
  private async enriquecerSolicitudes(rows: any[], lado: 'cliente' | 'equipo') {
    if (!rows.length) return rows;
    const client = this.supabase.getClient();
    const licIds = [...new Set(rows.map((r) => r.licitacion_id).filter(Boolean))];
    const licMap: Record<number, any> = {};
    if (licIds.length) {
      const { data: lics } = await client
        .from('licitaciones')
        .select('id, id_licitacion, estado')
        .in('id', licIds);
      (lics || []).forEach((l: any) => { licMap[l.id] = l; });
    }
    // Mensajes no leídos por el lado consultante (mensajes del otro lado sin leer).
    const solIds = rows.map((r) => r.id);
    const noLeidos: Record<number, number> = {};
    if (solIds.length) {
      const col = lado === 'cliente' ? 'leido_cliente' : 'leido_equipo';
      const otro = lado === 'cliente' ? 'equipo' : 'cliente';
      const { data: msgs } = await client
        .from('stock_cotizacion_mensajes')
        .select('solicitud_id')
        .in('solicitud_id', solIds)
        .eq('autor_tipo', otro)
        .eq(col, false);
      (msgs || []).forEach((m: any) => {
        noLeidos[m.solicitud_id] = (noLeidos[m.solicitud_id] || 0) + 1;
      });
    }
    return rows.map((r) => ({
      ...r,
      cotizacion: r.licitacion_id && licMap[r.licitacion_id]
        ? { id: licMap[r.licitacion_id].id, id_licitacion: licMap[r.licitacion_id].id_licitacion, estado: licMap[r.licitacion_id].estado }
        : null,
      mensajes_no_leidos: noLeidos[r.id] || 0,
    }));
  }

  async listarMisDeclaraciones(rut: string, sucursalId?: number | null, limit = 30) {
    const rutN = normalizarRut(rut);
    let q = this.supabase
      .getClient()
      .from('stock_declaraciones')
      .select('id, fecha, total_items, total_verdes, total_amarillos, total_rojos, items, sucursal_id')
      .eq('rut', rutN);
    if (sucursalId) q = q.eq('sucursal_id', sucursalId);
    const { data, error } = await q.order('fecha', { ascending: false }).limit(limit);
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // ── Admin: dashboard y destinatarios ──────────────────────────────────

  async listarDeclaraciones(filtros: {
    rut?: string;
    razonSocial?: string;
    desde?: string;
    hasta?: string;
    soloAlertas?: boolean;
    limit?: number;
  }) {
    const client = this.supabase.getClient();
    let q = client
      .from('stock_declaraciones')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(Math.min(Math.max(Number(filtros.limit) || 200, 1), 1000));

    if (filtros.rut) {
      const rutN = normalizarRut(filtros.rut);
      q = q.eq('rut', rutN);
    }
    if (filtros.razonSocial) {
      // Substring case-insensitive sobre razon_social
      q = q.ilike('razon_social', `%${filtros.razonSocial.trim()}%`);
    }
    if (filtros.desde) q = q.gte('fecha', filtros.desde);
    if (filtros.hasta) q = q.lte('fecha', filtros.hasta);
    if (filtros.soloAlertas) {
      q = q.or('total_rojos.gt.0,total_amarillos.gt.0');
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // Lista de clientes únicos que tienen al menos una declaración. Sirve para
  // alimentar el autocompletado de los filtros del dashboard.
  async listarClientesConDeclaraciones() {
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_declaraciones')
      .select('rut, razon_social, fecha')
      .order('fecha', { ascending: false })
      .limit(5000);
    if (error) throw new BadRequestException(error.message);

    const mapa = new Map<string, { rut: string; razon_social: string; ultima_fecha: string }>();
    (data || []).forEach((d: any) => {
      const rut = String(d?.rut || '').trim();
      if (!rut) return;
      if (!mapa.has(rut)) {
        mapa.set(rut, {
          rut,
          razon_social: String(d?.razon_social || '').trim(),
          ultima_fecha: d?.fecha || '',
        });
      }
    });
    return Array.from(mapa.values()).map((c) => ({
      ...c,
      rut_formateado: formatearRut(c.rut),
    }));
  }

  async listarClientesPortal() {
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_clientes_portal')
      .select('rut, razon_social, email, telefono, ultimo_acceso, acepto_acuerdo_en')
      .order('ultimo_acceso', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((c: any) => ({
      ...c,
      rut_formateado: formatearRut(c.rut),
    }));
  }

  async listarDestinatarios() {
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_destinatarios')
      .select('*')
      .order('user_email', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async upsertDestinatario(body: {
    user_email: string;
    recibe_campana?: boolean;
    recibe_correo?: boolean;
    activo?: boolean;
  }) {
    const email = String(body?.user_email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('El correo del destinatario no es válido.');
    }
    const row = {
      user_email: email,
      recibe_campana: body.recibe_campana ?? true,
      recibe_correo: body.recibe_correo ?? true,
      activo: body.activo ?? true,
    };
    const { data, error } = await this.supabase
      .getClient()
      .from('stock_destinatarios')
      .upsert(row, { onConflict: 'user_email' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminarDestinatario(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('stock_destinatarios')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── Catálogo Amsodent (ayuda de búsqueda en solicitud de cotización) ──

  // Busca productos del catálogo maestro por nombre, SKU o marca. Lo usa el
  // cliente desde el portal para agregar productos a una solicitud de
  // cotización aunque no los tenga en su declaración de stock.
  async buscarCatalogo(query: string, limit = 20) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const patron = `%${q.replace(/[%_,]/g, ' ')}%`;
    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .select('sku, nombre, marca, categoria')
      .or(`nombre.ilike.${patron},sku.ilike.${patron},marca.ilike.${patron}`)
      .limit(Math.min(Math.max(Number(limit) || 20, 1), 50));
    if (error) throw new BadRequestException(error.message);
    return (data || [])
      .map((p: any) => ({
        sku: p.sku || null,
        nombre: String(p.nombre || '').trim(),
        marca: p.marca || null,
        categoria: p.categoria || null,
      }))
      .filter((p) => p.nombre.length > 0);
  }

  // ── Comunicación admin → cliente (correo) ─────────────────────────────

  // Datos de contacto del cliente desde el maestro `clientes`, con respaldo en
  // el registro del portal. Lo usa el dashboard admin para prellenar correo y
  // teléfono al comunicarse con el cliente.
  async obtenerContactoCliente(rut: string) {
    const rutN = normalizarRut(rut);
    if (!rutN) throw new BadRequestException('RUT inválido.');
    const cliente = await this.buscarClientePorRut(rutN);
    const { data: portal } = await this.supabase
      .getClient()
      .from('stock_clientes_portal')
      .select('email, telefono, razon_social')
      .eq('rut', rutN)
      .maybeSingle();
    return {
      id: cliente?.id ?? null,
      rut: rutN,
      rut_formateado: formatearRut(rutN),
      razon_social: cliente?.nombre || portal?.razon_social || '',
      email: cliente?.email || portal?.email || null,
      telefono: cliente?.telefono || portal?.telefono || null,
    };
  }

  // Envía un correo de redacción libre al cliente. Sale desde la cuenta de
  // correo conectada del usuario (su casilla queda en Enviados) y se anexa su
  // firma. El destino se resuelve desde el maestro de clientes si no se
  // entrega explícitamente.
  async enviarComunicacionCliente(opts: {
    userId?: string;
    rut?: string;
    para?: string;
    cc?: string[];
    asunto: string;
    mensaje: string;
  }) {
    const asunto = String(opts?.asunto || '').trim();
    const mensaje = String(opts?.mensaje || '').trim();
    if (!asunto) throw new BadRequestException('Falta el asunto del correo.');
    if (!mensaje) throw new BadRequestException('Falta el mensaje del correo.');

    let para = String(opts?.para || '').trim().toLowerCase();
    if (opts?.rut && !para) {
      const contacto = await this.obtenerContactoCliente(opts.rut);
      if (contacto.email) para = String(contacto.email).toLowerCase();
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
      throw new BadRequestException(
        'No hay un correo de destino válido para este cliente. Indique uno manualmente.',
      );
    }

    const res = await this.correos.enviarCorreoCliente(opts?.userId || '', {
      para,
      cc: Array.isArray(opts?.cc) ? opts.cc : [],
      asunto,
      mensaje,
    });
    return { ok: true, para, de: res?.de, modo: res?.modo };
  }

  // ── Notificaciones internas (campana + correo) ────────────────────────

  private async notificarDestinatarios(args: {
    rut: string;
    razonSocial: string;
    declaracionId: number;
    totales: { verdes: number; amarillos: number; rojos: number };
    items: ItemDeclaracion[];
  }) {
    const client = this.supabase.getClient();
    const { data: destinatarios } = await client
      .from('stock_destinatarios')
      .select('user_email, recibe_campana, recibe_correo, activo')
      .eq('activo', true);

    const lista = (destinatarios || []).filter((d: any) => d?.user_email);
    if (lista.length === 0) return;

    const rutFmt = formatearRut(args.rut);
    const cliente = args.razonSocial || rutFmt;
    const esCritico = args.totales.rojos > 0;

    // Mensaje natural para la campana — el frontend lo muestra como un solo
    // bloque, así que armamos algo legible y accionable.
    const partesAlerta: string[] = [];
    if (args.totales.rojos > 0) {
      partesAlerta.push(
        `${args.totales.rojos} ${args.totales.rojos === 1 ? 'producto en nivel crítico' : 'productos en nivel crítico'}`,
      );
    }
    if (args.totales.amarillos > 0) {
      partesAlerta.push(
        `${args.totales.amarillos} ${args.totales.amarillos === 1 ? 'producto cercano al mínimo' : 'productos cercanos al mínimo'}`,
      );
    }
    const detalleAlerta = partesAlerta.join(' y ');

    const mensajeCampana = esCritico
      ? `${cliente} reportó ${detalleAlerta}. Coordinar reposición.`
      : `${cliente} reportó ${detalleAlerta}.`;

    // 1) Campana — fila en notificaciones para cada destinatario opt-in
    const rowsCampana = lista
      .filter((d: any) => d.recibe_campana !== false)
      .map((d: any) => ({
        user_email: String(d.user_email).toLowerCase(),
        tipo: esCritico ? 'stock_critico' : 'stock_bajo',
        mensaje: mensajeCampana,
        link: `/monitoreo-stock?declaracion=${args.declaracionId}`,
        metadata: {
          rut: args.rut,
          rut_formateado: rutFmt,
          razon_social: args.razonSocial,
          declaracion_id: args.declaracionId,
          total_rojos: args.totales.rojos,
          total_amarillos: args.totales.amarillos,
          total_verdes: args.totales.verdes,
          severidad: esCritico ? 'critico' : 'bajo',
        },
      }));

    if (rowsCampana.length > 0) {
      const { error } = await client.from('notificaciones').insert(rowsCampana);
      if (error) this.logger.warn(`Notificación campana falló: ${error.message}`);
    }

    // 2) Correo a destinatarios opt-in
    const destinatariosCorreo = lista
      .filter((d: any) => d.recibe_correo !== false)
      .map((d: any) => String(d.user_email).toLowerCase());

    if (destinatariosCorreo.length === 0) return;

    const enlaceMonitoreo = String(
      process.env.APP_PUBLIC_URL || process.env.PUBLIC_APP_URL || '',
    ).trim();
    const enlace = enlaceMonitoreo
      ? `${enlaceMonitoreo.replace(/\/+$/, '')}/monitoreo-stock?declaracion=${args.declaracionId}`
      : undefined;

    const { asunto, html } = plantillaAlertaStock({
      razonSocial: args.razonSocial || rutFmt,
      rutFmt,
      totales: args.totales,
      items: args.items,
      enlace,
    });

    for (const para of destinatariosCorreo) {
      try {
        await this.mailings.enviarUno({
          para,
          asunto,
          cuerpoHtml: html,
        });
      } catch (e: any) {
        this.logger.warn(`Correo de alerta de stock falló para ${para}: ${e?.message || e}`);
      }
    }
  }
}
