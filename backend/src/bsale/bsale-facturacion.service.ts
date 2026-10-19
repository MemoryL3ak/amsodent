import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { CorreosService } from '../correos/correos.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';

/* ── Emisión de facturas en Bsale desde el sistema (2026-10-02) ──────────────
   La factura se arma A PARTIR DE LA GUÍA DE DESPACHO que ya existe en Bsale,
   igual que la hacen hoy a mano: mismas líneas (por `detailId`, que es lo que
   deja la factura amarrada a la guía y evita descontar el stock dos veces),
   mismo cliente, y con referencia a la orden de compra (801) y a la guía (52).

   Emitir es un documento tributario real: una vez enviado al SII solo se
   deshace con una nota de crédito. Por eso:
   · `preparar` no escribe nada: arma el borrador y dice qué lo bloquea.
   · `emitir` vuelve a armar el borrador en el servidor (nunca confía en las
     líneas que mande el navegador) y exige que no haya cambiado.
   · La ventana ofrece dos botones: SIMULAR (devuelve lo que se enviaría y
     no llama a Bsale ni escribe nada) y EMITIR. `BSALE_EMISION=off` apaga la
     emisión real en el servidor y deja solo la simulación.
   · Cada emisión lleva un `salesId` propio; Bsale lo usa para no duplicar: si
     la respuesta se pierde y se reintenta, devuelve la misma factura.
   · Todo queda en `bsale_emisiones` (quién, cuándo, qué se envió, qué volvió). */

const IVA = 0.19;
const DTE_OC = 801; // código SII de "orden de compra" en una referencia
const DTE_GUIA = 52; // guía de despacho electrónica
const DTE_FACTURA = 33; // factura electrónica

type Problema = { codigo: string; mensaje: string };

function hoyEnChile(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

// Bsale maneja las fechas como el instante 00:00 UTC del día ("no se debe
// aplicar zona horaria, solo considerar la fecha").
export function fechaAEpoch(iso: string): number {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

export function epochAFecha(seg: any): string | null {
  const n = Number(seg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

export function sumarDias(iso: string, dias: number): string {
  const e = fechaAEpoch(iso);
  if (!Number.isFinite(e)) return '';
  return epochAFecha(e + Math.round(Number(dias) || 0) * 86400) || '';
}

// "30 días" → 30 · "Contado" → 0 · sin dato → 30 (igual que Seguimiento de Pagos).
export function plazoDias(condicionVenta: any): number {
  const c = String(condicionVenta || '').toLowerCase();
  const m = c.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (c.includes('contado')) return 0;
  return 30;
}

export const soloDigitos = (v: any) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
/* Folio de una guía a partir de lo que se digitó en el sistema. El campo trae
   texto libre ("709 - 2da entrega", "GD-810", "838 - ENTREGADA, FACTURAR"):
   juntar todos los dígitos daría OTRA guía ("7092"). Vale solo el número con
   que parte el texto (con prefijo GD / G / N° opcional); si parte con otra
   cosa ("FACTURA 263", "Enviado por Factura 175") no es una guía. */
export function folioGuia(v: any): string {
  const m = String(v ?? '').match(/^\s*(?:GD|G|N[°º.]?)?\s*[-.]?\s*0*(\d{1,9})(?=$|[\s\-–—.,;:(/])/i);
  return m ? m[1] : '';
}
// Folio de una orden de compra, como se escribe en una referencia: sin
// espacios y en mayúsculas ("1057448-254-ag26" → "1057448-254-AG26").
export const normOc = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
// El SII admite hasta 18 caracteres en el folio de una referencia.
const MAX_FOLIO_REF = 18;

/* El emisor tal como Bsale lo imprime en los documentos (leído de la guía
   N° 881, 2026-10-03). Solo se usa para la vista previa: el documento real
   lo arma Bsale con los datos de la cuenta. */
export const EMISOR = {
  razon_social: 'AMSODENT MEDICAL SPA',
  rut: '78.087.954-8',
  giro: 'VENTA DE PRODUCTOS DENTALES, MEDICOS E INSUMOS',
  direccion: '1 MAYO 45',
  comuna: 'SAN BERNARDO',
  ciudad: 'SAN BERNARDO',
  ciudad_sii: 'SAN BERNARDO',
};

/* Cómo van las referencias a Bsale (regla de Ariel, 2026-10-03, tras la
   primera guía real, y lo que muestran los documentos hechos a mano):
   - GUÍA (desde 2026-10-16, pedido de Ariel): en la referencia a la ORDEN DE
     COMPRA el FOLIO es el número de la orden de compra y la RAZÓN el ID de la
     licitación (su código de Mercado Público o, si no tiene, el número interno
     de la cotización). Hasta esa fecha iba al revés: `ocDeReferencia` lee las dos.
     (2026-10-19) ENTIDAD PÚBLICA: FOLIO y RAZÓN llevan los dos el N° de la OC
     (pedido de Ariel con la foto de una guía con el COT en el folio); la regla
     de arriba queda para el cliente particular.
   - NOTA DE VENTA (orden en Bsale): sigue con la regla anterior — FOLIO la
     cotización y RAZÓN el número de la orden de compra.
   - FACTURA: el número de la orden de compra va en el FOLIO (Mercado Público
     cruza la factura con la OC por ese campo; así están las 76 facturas reales
     con OC) y también en la razón.
   - Referencia a una GUÍA (52) en una factura: el folio es el N° de la guía
     y la razón el N° de la orden de compra (regla de Ariel, 2026-10-03).
   `numero` es siempre el N° de la OC (o de la guía), para comparar y avisar. */
export type Referencia = { codigo_sii: number; folio: string; numero: string; razon: string; fecha: string | null };

export function referenciaOcGuia(folioCotizacion: string, numeroOc: string, fecha: string | null, publica = false): Referencia {
  const oc = normOc(numeroOc);
  return { codigo_sii: 801, folio: oc, numero: oc, razon: publica ? oc : normOc(folioCotizacion) || oc, fecha };
}

// ¿La cotización es de una entidad pública? (todo lo que no es cliente particular)
export const esCotizacionPublica = (lic: any) => !!lic && !/particular/i.test(String(lic?.tipo_cliente || ''));

export function referenciaOcOrden(folioCotizacion: string, numeroOc: string, fecha: string | null): Referencia {
  return { codigo_sii: 801, folio: normOc(folioCotizacion) || normOc(numeroOc), numero: normOc(numeroOc), razon: normOc(numeroOc), fecha };
}

export function referenciaOcFactura(numeroOc: string, fecha: string | null): Referencia {
  return { codigo_sii: 801, folio: normOc(numeroOc), numero: normOc(numeroOc), razon: normOc(numeroOc), fecha };
}

export function referenciaGuia(numeroGuia: string, fecha: string | null, numeroOc?: string | null): Referencia {
  return { codigo_sii: 52, folio: String(numeroGuia).trim(), numero: String(numeroGuia).trim(), razon: normOc(numeroOc) || 'Guía de despacho', fecha };
}

export function referenciaParaBsale(r: Referencia, emision: number) {
  return { number: r.folio, referenceDate: r.fecha ? fechaAEpoch(r.fecha) : emision, reason: r.razon, codeSii: r.codigo_sii };
}

// Folio con que se identifica una cotización en una referencia.
export const folioCotizacion = (lic: any) => normOc(lic?.id_licitacion) || String(lic?.id || '').trim();

/* La orden de compra que trae una referencia leída de Bsale. En las guías del
   sistema hasta 2026-10-16 va en la razón (el folio es la cotización) y desde
   entonces en el folio (la razón es el ID de la licitación); en las hechas a
   mano va en los dos campos, o en el folio con una razón libre ("HES
   1026670275", "DISPOSITO MEDICO") o un rótulo ("Orden de compra").
   Primero se descarta el lado que tiene forma de ID de licitación de Mercado
   Público (…-COT26, …-LE26, …-LR26, …-L126: compra ágil y licitaciones;
   las OC terminan en AG, SE, CM…). Después se prefiere lo que tenga forma de
   OC (1234-56-AG26); si nada la tiene, la razón solo vale cuando trae dígitos. */
const ES_OC_MP = /^\d+-\d+-[A-Z]{2}\d{2}$/;
const ES_LICITACION_MP = /^\d+-\d+-(COT|LE|LP|LR|LQ|LS|L1|E2|CO|B2|H2|I2)\d{2}(-\d+)?$/;
export function ocDeReferencia(r: any, folioCot?: string | null): string {
  const folio = normOc(r?.number);
  const razon = normOc(r?.reason);
  if (!razon || razon === folio) return folio;
  // Si se sabe el folio de la cotización (ID de la licitación), la OC es el otro lado.
  const cot = normOc(folioCot);
  if (cot && folio === cot) return razon;
  if (cot && razon === cot) return folio;
  const licFolio = ES_LICITACION_MP.test(folio);
  const licRazon = ES_LICITACION_MP.test(razon);
  if (licFolio && !licRazon) return razon;
  if (licRazon && !licFolio) return folio;
  if (ES_OC_MP.test(razon)) return razon;
  if (ES_OC_MP.test(folio)) return folio;
  return /\d/.test(razon) ? razon : folio;
}

export const referenciaVista = (r: Referencia) => ({ tipo: r.codigo_sii === 801 ? 'Orden de compra' : 'Guía de despacho electrónica', folio: r.folio, razon: r.razon, fecha: r.fecha });
export const normRut = (v: any) => String(v ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

/* Totales como los calcula el SII para una factura afecta: el IVA es el 19 %
   del neto TOTAL redondeado, no la suma de los IVA de cada línea. */
export function totalesDe(lineas: { neto: number }[]) {
  const neto = Math.round(lineas.reduce((a, l) => a + (Number(l.neto) || 0), 0));
  const iva = Math.round(neto * IVA);
  return { neto, iva, total: neto + iva };
}

/* Lo que se le manda a Bsale. Función pura: recibe el borrador ya validado y
   las tres decisiones del usuario (fecha, plazo, forma de pago). */
export function armarSolicitud(
  b: {
    tipo_documento_id: number;
    sucursal_id: number | null;
    cliente: { id: number };
    lineas: { detalle_id: number; cantidad: number }[];
    referencias: Referencia[];
    totales: { total: number };
  },
  o: { fecha_emision: string; dias_vencimiento: number; forma_pago_id: number; sales_id: string },
) {
  const emision = fechaAEpoch(o.fecha_emision);
  const solicitud: Record<string, any> = {
    documentTypeId: b.tipo_documento_id,
    emissionDate: emision,
    expirationDate: fechaAEpoch(sumarDias(o.fecha_emision, o.dias_vencimiento)),
    declareSii: 1,
    clientId: b.cliente.id,
    // Sin `dispatch`: la guía ya despachó y rebajó el stock.
    details: b.lineas.map((l) => ({ detailId: l.detalle_id, quantity: l.cantidad })),
    payments: [{ paymentTypeId: o.forma_pago_id, amount: b.totales.total, recordDate: emision }],
    references: b.referencias.map((r) => referenciaParaBsale(r, emision)),
    salesId: o.sales_id,
  };
  if (b.sucursal_id) solicitud.officeId = b.sucursal_id;
  return solicitud;
}

@Injectable()
export class BsaleFacturacionService {
  private readonly logger = new Logger(BsaleFacturacionService.name);

  constructor(
    private supabase: SupabaseService,
    // (2026-10-08) Al registrar la factura queda el aviso que abre la ventana de correo. Opcionales para las pruebas.
    @Optional() private correos?: CorreosService,
    @Optional() private licitaciones?: LicitacionesService,
  ) {}

  // ── Configuración ───────────────────────────────────────────────────────

  private get token(): string {
    return (process.env.BSALE_ACCESS_TOKEN || '').trim();
  }

  private get base(): string {
    return (process.env.BSALE_URL || 'https://api.bsale.io').replace(/\/+$/, '');
  }

  // La emisión real está activa salvo que se apague con BSALE_EMISION=off
  // (interruptor de emergencia: deja solo la simulación).
  // ¿Hay token de Bsale? (para lecturas que no exigen rol, como los estados)
  get configurado(): boolean {
    return !!this.token;
  }

  get emisionActiva(): boolean {
    return (process.env.BSALE_EMISION || '').trim().toLowerCase() !== 'off';
  }

  // Roles que pueden emitir (BSALE_EMISION_ROLES, separados por coma).
  get rolesPermitidos(): string[] {
    const crudo = (process.env.BSALE_EMISION_ROLES || 'admin,contabilidad,jefe_ventas_especial').toLowerCase();
    return crudo.split(',').map((r) => r.trim()).filter(Boolean);
  }

  async rolDe(userId: string): Promise<string> {
    const { data } = await this.supabase.getClient().from('profiles').select('rol').eq('id', userId).maybeSingle();
    const rol = String((data as any)?.rol || '').trim().toLowerCase();
    return rol === 'administrador' ? 'admin' : rol;
  }

  async exigirRol(userId: string) {
    if (!(await this.puedeEmitir(userId))) {
      throw new ForbiddenException('Tu perfil no puede emitir facturas en Bsale.');
    }
  }

  /* (2026-10-15) Guía de despacho desde la cotización: la emite CUALQUIER
     usuario autenticado (pedido de Ariel: "todos pueden emitir guía de
     despacho desde la cotización"). Facturas, boletas, venta directa y
     registrar la orden siguen con exigirRol. Queda como método (y no como
     ausencia de chequeo) para poder acotarlo en un solo lugar más adelante. */
  async exigirRolGuia(_userId: string): Promise<void> {
    return;
  }

  /* (2026-10-14) Emite quien tiene un rol de la lista (BSALE_EMISION_ROLES) o
     quien tiene «Venta directa» o «Facturación» en su perfil de permisos
     (pedido de Ariel: Laura y Sandy con venta directa sin cambiarles el rol). */
  async puedeEmitir(userId: string): Promise<boolean> {
    const rol = await this.rolDe(userId);
    if (this.rolesPermitidos.includes(rol)) return true;
    try {
      const db = this.supabase.getClient();
      const { data: p } = await db.from('profiles').select('permission_profile_id').eq('id', userId).maybeSingle();
      const pid = (p as any)?.permission_profile_id;
      if (!pid) return false;
      const { data: perfil } = await db.from('permission_profiles').select('permisos').eq('id', pid).maybeSingle();
      const permisos: string[] = Array.isArray((perfil as any)?.permisos) ? (perfil as any).permisos : [];
      return permisos.includes('venta_directa') || permisos.includes('facturacion');
    } catch {
      return false;
    }
  }

  private async tablaLista(): Promise<boolean> {
    const { error } = await this.supabase.getClient().from('bsale_emisiones').select('id').limit(1);
    return !error;
  }

  async estado(userId: string) {
    const configurada = !!this.token;
    const tabla = await this.tablaLista();
    return {
      configurada,
      // La pantalla solo ofrece el botón a quien puede usarlo (rol o perfil de permisos).
      puede: configurada && (await this.puedeEmitir(userId)),
      // (2026-10-15) La guía de despacho desde la cotización: todos.
      puede_guia: configurada,
      modo: this.emisionActiva ? 'activa' : 'simulacion',
      // Sin la tabla de registro no se emite: no habría cómo evitar duplicados.
      registro_listo: tabla,
    };
  }

  // ── Llamadas a Bsale ────────────────────────────────────────────────────

  async apiGet(path: string, reintentos = 3): Promise<any> {
    for (let intento = 0; ; intento++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      let res: Response;
      try {
        res = await fetch(`${this.base}/v1${path}`, {
          headers: { access_token: this.token, Accept: 'application/json' },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && intento < reintentos) {
        const retry = Number(res.headers.get('retry-after')) || 0;
        await new Promise((r) => setTimeout(r, Math.min(Math.max(retry * 1000, 1500 * 2 ** intento), 20000)));
        continue;
      }
      const cuerpo = (await res.text().catch(() => '')).slice(0, 300);
      throw new BadGatewayException(`Bsale respondió ${res.status}: ${cuerpo || res.statusText}`);
    }
  }

  async todos(recurso: string, extra = ''): Promise<any[]> {
    const out: any[] = [];
    for (let offset = 0; offset < 5000; offset += 50) {
      const r = await this.apiGet(`${recurso}?limit=50&offset=${offset}${extra}`);
      const items: any[] = r?.items || [];
      out.push(...items);
      if (!r?.next || items.length === 0) break;
    }
    return out;
  }

  /* ── Vendedor del documento en Bsale (2026-10-16) ─────────────────────────
     Sin `sellerId`, Bsale pone como vendedor al dueño del token (BENJAMIN
     ALARCON) en todo lo que emite el sistema, aunque la cotización sea de
     Eva o la emita Ruth. En factura, boleta, nota de débito y orden el
     vendedor es el de la cotización (sin cotización, quien emite); en la guía,
     quien la emite en la plataforma (pedido de Ariel: así sale cuando se emite
     desde Bsale web). Su usuario de Bsale se busca por correo (también el
     alterno) y, si no calza, por nombre (Camila y Jonathan tienen otro correo
     en Bsale). POST /documents.json documenta sellerId; /shippings.json no,
     pero acepta campos no documentados (references, salesId) y los procesa:
     se manda igual y `avisoVendedor` confirma después si Bsale lo tomó. Las
     notas de crédito (/returns.json) no lo llevan. Nunca lanza: sin vendedor,
     el documento sale igual con el de siempre y se avisa. */
  private cacheUsuariosBsale: { ts: number; items: any[] } | null = null;

  private async usuariosBsale(): Promise<any[]> {
    if (this.cacheUsuariosBsale && Date.now() - this.cacheUsuariosBsale.ts < 30 * 60 * 1000) return this.cacheUsuariosBsale.items;
    const items = await this.todos('/users.json');
    this.cacheUsuariosBsale = { ts: Date.now(), items };
    return items;
  }

  async vendedorBsale(licitacionId: number | null, emailEmisor: string): Promise<{ id: number | null; nombre: string | null; aviso: string | null }> {
    const db = this.supabase.getClient();
    let email = String(emailEmisor || '').trim().toLowerCase();
    let nombre = '';
    try {
      if (licitacionId) {
        const { data: lic } = await db.from('licitaciones').select('vendedor_correo, vendedor_nombre, creado_por').eq('id', licitacionId).maybeSingle();
        const correo = String((lic as any)?.vendedor_correo || (lic as any)?.creado_por || '').trim().toLowerCase();
        if (correo) {
          email = correo;
          nombre = String((lic as any)?.vendedor_nombre || '').trim();
        }
      }
      const correos = new Set([email].filter(Boolean));
      if (email) {
        let r: any = await db.from('profiles').select('email, nombre, email_alterno').ilike('email', email).limit(1);
        if (r.error) r = await db.from('profiles').select('email, nombre').ilike('email', email).limit(1); // email_alterno sin migrar
        else if (!(r.data || []).length) r = await db.from('profiles').select('email, nombre, email_alterno').ilike('email_alterno', email).limit(1);
        const p = (r.data || [])[0];
        if (p) {
          if (p.nombre) nombre = String(p.nombre).trim();
          for (const e of [p.email, p.email_alterno]) if (e) correos.add(String(e).trim().toLowerCase());
        }
      }
      const nombreDe = (u: any) => `${u?.firstName || ''} ${u?.lastName || ''}`.replace(/\s+/g, ' ').trim();
      const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const activos = (await this.usuariosBsale()).filter((u) => Number(u?.state) === 0);
      let u = activos.find((x) => correos.has(String(x?.email || '').trim().toLowerCase()));
      if (!u && nombre) {
        const mismos = activos.filter((x) => norm(nombreDe(x)) === norm(nombre));
        if (mismos.length === 1) u = mismos[0];
      }
      if (u) return { id: Number(u.id), nombre: nombreDe(u), aviso: null };
      return { id: null, nombre: null, aviso: `${nombre || email || 'El vendedor'} no tiene usuario activo en Bsale: el documento queda con el vendedor por defecto de Bsale (el dueño del token).` };
    } catch (e: any) {
      this.logger.warn(`Vendedor en Bsale para ${email || 'sin correo'}: ${e?.message || e}`);
      return { id: null, nombre: null, aviso: 'No se pudo consultar el vendedor en Bsale: el documento queda con el vendedor por defecto de Bsale.' };
    }
  }

  // Después de emitir: ¿quedó el vendedor pedido? null = sí (o no se pudo leer: no frena nada).
  async avisoVendedor(docId: number, numero: any, sellerId: number): Promise<string | null> {
    try {
      const r = await this.apiGet(`/documents/${Number(docId)}/sellers.json`);
      const items: any[] = r?.items || [];
      if (!items.length || items.some((s) => Number(s?.id) === Number(sellerId))) return null;
      const quien = items.map((s) => `${s?.firstName || ''} ${s?.lastName || ''}`.replace(/\s+/g, ' ').trim()).join(', ');
      return `El documento ${numero} quedó en Bsale con el vendedor ${quien}: Bsale no tomó el vendedor elegido.`;
    } catch {
      return null;
    }
  }

  // Deja el vendedor en la solicitud (sellerId) y en la vista previa.
  async ponerVendedor(solicitud: Record<string, any>, vista: any, licitacionId: number | null, emailEmisor: string) {
    const v = await this.vendedorBsale(licitacionId, emailEmisor);
    if (v.id) solicitud.sellerId = v.id;
    if (vista) {
      if (v.nombre) vista.vendedor = v.nombre;
      if (v.aviso) vista.notas = [...(vista.notas || []), v.aviso];
    }
    return v;
  }

  private cacheListas: { ts: number; tipoFactura: any; formas: any[]; dte: Map<number, number> } | null = null;

  /* Tipo de documento "factura electrónica", formas de pago activas y la tabla
     de códigos tributarios (una referencia trae el id interno de Bsale, no el
     código SII: p. ej. id 20 = 801 orden de compra, id 16 = 52 guía). */
  async listas() {
    if (this.cacheListas && Date.now() - this.cacheListas.ts < 10 * 60 * 1000) return this.cacheListas;
    const [tipos, formas, codigos] = await Promise.all([
      this.todos('/document_types.json', '&state=0'),
      this.todos('/payment_types.json', '&state=0'),
      this.todos('/dte_codes.json'),
    ]);
    const dte = new Map<number, number>(codigos.map((c) => [Number(c.id), Number(c.codeSii)] as [number, number]));
    const tipoFactura =
      tipos.find((t) => String(t.codeSii) === String(DTE_FACTURA) && Number(t.isElectronicDocument) === 1) || null;
    this.cacheListas = {
      ts: Date.now(),
      dte,
      tipoFactura,
      // Una nota de crédito no es una forma de pagar una factura nueva.
      formas: formas
        .filter((f) => !Number(f.isCreditNote))
        .map((f) => ({ id: Number(f.id), nombre: String(f.name || '').trim() }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    };
    return this.cacheListas;
  }

  // Guía electrónica por número, con TODAS sus líneas (el expand trae 25).
  private async guiaEnBsale(numero: string) {
    const num = folioGuia(numero);
    if (!num) return null;
    const r = await this.apiGet(
      `/documents.json?codesii=${DTE_GUIA}&number=${num}&expand=[details,references,client,office]&limit=10`,
    );
    const candidatos: any[] = r?.items || [];
    const doc = candidatos.find((d) => Number(d?.state) !== 1) || candidatos[0];
    if (!doc) return null;
    let detalles: any[] = doc?.details?.items || [];
    if (Number(doc?.details?.count || 0) > detalles.length) {
      detalles = await this.todos(`/documents/${doc.id}/details.json`);
    }
    const { dte } = await this.listas();
    const referencias = ((doc?.references?.items || []) as any[]).map((r) => ({
      ...r,
      codigo_sii: dte.get(Number(r?.dte_code?.id)) || 0,
    }));
    return { doc, detalles, referencias };
  }

  /* ¿Ya hay en Bsale una factura que referencie esta guía? La guía no lo dice;
     se buscan las facturas emitidas desde la fecha de la guía. */
  async facturasQueReferencian(numerosGuia: string[], desdeEpoch: number) {
    const hasta = Math.floor(Date.now() / 1000) + 86400;
    const facturas = await this.todos(
      '/documents.json',
      `&codesii=${DTE_FACTURA}&emissiondaterange=[${desdeEpoch},${hasta}]&expand=[references]`,
    );
    const { dte } = await this.listas();
    const buscadas = new Set(numerosGuia.map(soloDigitos));
    const halladas = new Map<string, { numero: string; fecha: string | null }>();
    /* (2026-10-16) Una factura anulada con nota de crédito sigue en Bsale con
       state 0 (solo cambia a 1 si se anula sin NC): hay que mirar las
       devoluciones. Caso real, guía 804: facturada tres veces a mano en Bsale
       (749, 867, 868) y las tres anuladas (NC 141, 165, 179); el sistema veía
       la 749 "vigente" y no dejaba facturarla. Las anuladas se devuelven
       aparte para avisar el historial sin bloquear. */
    const anuladas = new Map<string, Array<{ numero: string; fecha: string | null; notas: string[] }>>();
    const anuladasPorNc = await this.facturasAnuladasPorNc(facturas);
    for (const f of facturas) {
      if (Number(f?.state) === 1) continue;
      const nc = anuladasPorNc.get(Number(f?.id));
      for (const ref of f?.references?.items || []) {
        // Solo referencias a una GUÍA: el folio de una orden de compra puede
        // coincidir con el de una guía y no significa que esté facturada.
        if (dte.get(Number(ref?.dte_code?.id)) !== DTE_GUIA) continue;
        const n = soloDigitos(ref?.number);
        if (!buscadas.has(n)) continue;
        if (nc) {
          if (!anuladas.has(n)) anuladas.set(n, []);
          anuladas.get(n)!.push({ numero: String(f.number), fecha: epochAFecha(f.emissionDate), notas: nc.notas });
          continue;
        }
        if (!halladas.has(n)) halladas.set(n, { numero: String(f.number), fecha: epochAFecha(f.emissionDate) });
      }
    }
    return { halladas, anuladas };
  }

  /* (2026-10-16) Lo mismo con lo registrado en el SISTEMA: una factura cuyas
     notas de crédito (hijas por deriva_de_id, en BRUTO) suman al menos su total
     (neto × 1,19) está anulada y no cuenta como factura de la guía. Sin monto
     en la factura no se puede saber: se sigue contando (bloquea). */
  private facturasAnuladasEnSistema(docs: any[]): Map<number, { notas: string[] }> {
    const out = new Map<number, { notas: string[] }>();
    const ncPorFactura = new Map<number, { total: number; notas: string[] }>();
    for (const d of docs) {
      if (d?.tipo !== 'nota_credito' || !d?.deriva_de_id) continue;
      const e = ncPorFactura.get(Number(d.deriva_de_id)) || { total: 0, notas: [] };
      e.total += Number(d.monto) || 0;
      e.notas.push(String(d.numero || 's/n'));
      ncPorFactura.set(Number(d.deriva_de_id), e);
    }
    for (const f of docs) {
      if (f?.tipo !== 'factura' && f?.tipo !== 'factura_boleta') continue;
      const neto = Number(f?.monto) || 0;
      const e = ncPorFactura.get(Number(f.id));
      if (neto > 0 && e && e.total >= Math.round(neto * 1.19) - 2) out.set(Number(f.id), { notas: e.notas });
    }
    return out;
  }

  /* Facturas anuladas por completo con nota(s) de crédito: las devoluciones de
     Bsale cuyo documento de referencia es la factura suman al menos su total. */
  private async facturasAnuladasPorNc(facturas: any[]): Promise<Map<number, { notas: string[]; monto: number }>> {
    const out = new Map<number, { notas: string[]; monto: number }>();
    if (!facturas.length) return out;
    let devoluciones: any[] = [];
    try {
      devoluciones = await this.todos('/returns.json', '&expand=[reference_document,credit_note]');
    } catch (e: any) {
      // Sin las devoluciones se sigue con el criterio de siempre (bloquear): mejor un bloqueo de más que una factura duplicada.
      this.logger.warn(`No se pudieron leer las devoluciones de Bsale: ${String(e?.message || e).slice(0, 120)}`);
      return out;
    }
    const porFactura = new Map<number, { notas: string[]; monto: number }>();
    for (const r of devoluciones) {
      const id = Number(r?.reference_document?.id);
      if (!Number.isFinite(id)) continue;
      const e = porFactura.get(id) || { notas: [], monto: 0 };
      e.monto += Number(r?.amount ?? r?.credit_note?.totalAmount ?? 0) || 0;
      if (r?.credit_note?.number != null) e.notas.push(String(r.credit_note.number));
      porFactura.set(id, e);
    }
    for (const f of facturas) {
      const e = porFactura.get(Number(f?.id));
      if (e && e.monto >= (Number(f?.totalAmount) || 0) - 1) out.set(Number(f.id), e);
    }
    return out;
  }

  // ── Listas del módulo Facturación ───────────────────────────────────────

  /* Guías de despacho que todavía no tienen factura, de cotizaciones
     adjudicadas. Sale solo de la base (no consulta Bsale): la revisión contra
     Bsale se hace al abrir el borrador de cada una. */
  async pendientes(userId: string) {
    await this.exigirRol(userId);
    const db = this.supabase.getClient();
    const docs: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db
        .from('licitacion_documentos')
        .select('id, licitacion_id, tipo, numero, monto, fecha_oc, deriva_de_id, guias_ids, created_at')
        .in('tipo', ['orden_compra', 'guia_despacho', 'factura', 'factura_boleta', 'nota_credito'])
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      docs.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    // (2026-10-16) Una factura anulada con nota de crédito deja la guía otra vez por facturar.
    const anuladasSistema = this.facturasAnuladasEnSistema(docs);
    const facturadas = new Set<number>();
    for (const f of docs) {
      if (f.tipo !== 'factura' && f.tipo !== 'factura_boleta') continue;
      if (anuladasSistema.has(Number(f.id))) continue;
      if (f.deriva_de_id) facturadas.add(Number(f.deriva_de_id));
      if (Array.isArray(f.guias_ids)) for (const g of f.guias_ids) facturadas.add(Number(g));
    }
    const ocPorId = new Map<number, any>(docs.filter((d) => d.tipo === 'orden_compra').map((d) => [d.id, d] as [number, any]));
    const sinFactura = docs.filter((d) => d.tipo === 'guia_despacho' && !facturadas.has(d.id));

    const licIds = [...new Set(sinFactura.map((g) => Number(g.licitacion_id)))];
    const lics = new Map<number, any>();
    for (let i = 0; i < licIds.length; i += 200) {
      const { data, error } = await db
        .from('licitaciones')
        .select('id, id_licitacion, nombre_entidad, rut_entidad, condicion_venta, estado')
        .in('id', licIds.slice(i, i + 200));
      if (error) throw new BadRequestException(error.message);
      for (const l of data || []) lics.set(Number((l as any).id), l);
    }

    const hoy = fechaAEpoch(hoyEnChile());
    const filas = sinFactura
      .map((g) => {
        const lic = lics.get(Number(g.licitacion_id));
        if (!lic || lic.estado !== 'Adjudicada') return null;
        const fecha = String(g.fecha_oc || g.created_at || '').slice(0, 10) || null;
        const oc = ocPorId.get(Number(g.deriva_de_id));
        return {
          guia_id: g.id,
          guia_numero: String(g.numero || '').trim() || null,
          guia_fecha: fecha,
          dias: fecha && Number.isFinite(fechaAEpoch(fecha)) ? Math.max(0, Math.round((hoy - fechaAEpoch(fecha)) / 86400)) : null,
          licitacion_id: lic.id,
          codigo: lic.id_licitacion || null,
          cliente: lic.nombre_entidad || '',
          rut: lic.rut_entidad || '',
          oc_numero: oc?.numero ? String(oc.numero) : null,
          oc_neto: Number(oc?.monto) || null,
          guia_neto: Number(g.monto) || null,
          guia_folio: folioGuia(g.numero) || null,
          // Sin un folio reconocible no se puede buscar la guía en Bsale.
          emitible: !!folioGuia(g.numero),
        };
      })
      .filter(Boolean) as any[];
    // Las más antiguas primero: son las que urge facturar.
    filas.sort((a, b) => String(a.guia_fecha || '9999').localeCompare(String(b.guia_fecha || '9999')) || a.guia_id - b.guia_id);
    return { filas };
  }

  /* Historial de lo emitido (y de los intentos que no resultaron) desde el
     sistema. Si la migración no está aplicada, devuelve la lista vacía. */
  async emitidas(userId: string, limite = 300) {
    await this.exigirRol(userId);
    const db = this.supabase.getClient();
    const tope = Math.min(Math.max(Number(limite) || 300, 1), 1000);
    let r: any = await db
      .from('bsale_emisiones')
      .select('id, clave, tipo, origen_doc_id, estado, numero, neto, total, fecha_emision, url_pdf, bsale_id, licitacion_id, documento_id, guias_doc_ids, usuario, error, created_at, updated_at')
      .order('id', { ascending: false })
      .limit(tope);
    if (r.error && /tipo|origen_doc_id/.test(String(r.error.message)) && /column|schema cache/i.test(String(r.error.message))) {
      r = await db
        .from('bsale_emisiones')
        .select('id, estado, numero, neto, total, fecha_emision, url_pdf, licitacion_id, guias_doc_ids, usuario, error, created_at, updated_at')
        .order('id', { ascending: false })
        .limit(tope);
    }
    if (r.error) return { registro_listo: false, filas: [] };
    const emisiones: any[] = r.data || [];

    /* Emisiones sin cotización pero con su documento registrado (las ventas
       directas anteriores al 2026-10-07 quedaron así): la cotización sale del
       documento, para que aparezcan asociadas en «Venta directa». */
    const sinLic = emisiones.filter((e) => !e.licitacion_id && e.documento_id).map((e) => Number(e.documento_id));
    if (sinLic.length) {
      const { data: ds } = await db.from('licitacion_documentos').select('id, licitacion_id').in('id', sinLic);
      const licDe = new Map((ds || []).map((d: any) => [Number(d.id), Number(d.licitacion_id) || null]));
      for (const e of emisiones) if (!e.licitacion_id && e.documento_id) e.licitacion_id = licDe.get(Number(e.documento_id)) || null;
    }

    // Notas de crédito hechas desde el sistema: la clave es AMS-NC-<id en Bsale
    // del documento>. Desde 2026-10-07 hay NC parciales: el documento queda
    // «anulado» solo si sus NC suman el total; si no, «NC parcial». (Una NC sin
    // total registrado es de antes de las parciales: anulaba completo.)
    const ncPor = new Map<number, { total: number; numeros: string[]; sinTotal: boolean }>();
    for (const e of emisiones) {
      const m = String(e.clave || '').match(/^AMS-NC-(\d+)$/);
      if (e.tipo !== 'nota_credito' || e.estado !== 'emitida' || !m) continue;
      const x = ncPor.get(Number(m[1])) || { total: 0, numeros: [], sinTotal: false };
      x.total += Number(e.total) || 0;
      if (!(Number(e.total) > 0)) x.sinTotal = true;
      if (e.numero) x.numeros.push(String(e.numero));
      ncPor.set(Number(m[1]), x);
    }
    const ncDe = (e: any) => {
      const nc = e.bsale_id ? ncPor.get(Number(e.bsale_id)) : null;
      if (!nc) return { anulada_por: null, nc_parcial: null };
      const completa = nc.sinTotal || !(Number(e.total) > 0) || nc.total >= Number(e.total) - 2;
      return completa
        ? { anulada_por: nc.numeros.join(', ') || 'NC', nc_parcial: null }
        : { anulada_por: null, nc_parcial: { total: nc.total, numeros: nc.numeros } };
    };

    const licIds = [...new Set(emisiones.map((e) => Number(e.licitacion_id)).filter((id) => id > 0))];
    const guiaIds = [...new Set(emisiones.flatMap((e) => (e.guias_doc_ids || []).map(Number)))];
    const lics = new Map<number, any>();
    const guias = new Map<number, string>();
    if (licIds.length) {
      const { data: l } = await db.from('licitaciones').select('id, id_licitacion, nombre_entidad').in('id', licIds);
      for (const x of l || []) lics.set(Number((x as any).id), x);
    }
    if (guiaIds.length) {
      const { data: g } = await db.from('licitacion_documentos').select('id, numero').in('id', guiaIds);
      for (const x of g || []) guias.set(Number((x as any).id), String((x as any).numero || ''));
    }
    return {
      registro_listo: true,
      filas: emisiones.map((e) => ({
        id: e.id,
        tipo: e.tipo || 'factura',
        // Venta directa (boleta o factura que crea su propia cotización).
        venta_directa: String(e.clave || '').startsWith('AMS-V-'),
        bsale_id: Number(e.bsale_id) || null,
        ...ncDe(e),
        documento_id: e.documento_id || null,
        origen_doc_id: e.origen_doc_id || null,
        estado: e.estado,
        numero: e.numero || null,
        neto: Number(e.neto) || null,
        total: Number(e.total) || null,
        fecha: e.fecha_emision || String(e.updated_at || e.created_at || '').slice(0, 10) || null,
        url_pdf: e.url_pdf || null,
        licitacion_id: e.licitacion_id,
        codigo: lics.get(Number(e.licitacion_id))?.id_licitacion || null,
        cliente: lics.get(Number(e.licitacion_id))?.nombre_entidad || '',
        guias: (e.guias_doc_ids || []).map((id: any) => guias.get(Number(id)) || '').filter(Boolean),
        guia_ids: (e.guias_doc_ids || []).map(Number),
        usuario: e.usuario || null,
        error: e.estado === 'emitida' ? null : e.error || null,
      })),
    };
  }

  /* ── Módulo Venta directa (2026-10-07) ─────────────────────────────────
     Pedido de Ariel: "crear el módulo comercial de Venta directa. Acá se debe
     visualizar el listado de venta directa y creación de documentos
     correspondientes". TODAS las ventas directas (clave AMS-V-…, no solo las
     últimas 300 emisiones de Facturación), cada una con su cotización, si está
     pagada, y lo que tiene registrado: notas de crédito y débito (en BRUTO),
     guías y comprobantes de pago. Las NC hechas a mano en Bsale las suma el
     front con el estado en Bsale. */
  async ventasDirectas(userId: string) {
    await this.exigirRol(userId);
    const db = this.supabase.getClient();
    // (2026-10-09) Cada vendedor ve solo sus ventas; administración ve todas.
    const { data: perfil } = await db.from('profiles').select('rol, email').eq('id', userId).maybeSingle();
    const rol = String((perfil as any)?.rol || '').trim().toLowerCase();
    const soloMias = !(rol === 'admin' || rol === 'administrador');
    const miEmail = String((perfil as any)?.email || '').trim().toLowerCase();
    const ventas: any[] = [];
    for (let desde = 0; desde < 20000; desde += 1000) {
      const r: any = await db
        .from('bsale_emisiones')
        .select('id, clave, tipo, estado, numero, neto, total, fecha_emision, url_pdf, bsale_id, licitacion_id, documento_id, usuario, error, created_at, updated_at')
        .like('clave', 'AMS-V-%')
        .order('id', { ascending: false })
        .range(desde, desde + 999);
      if (r.error) return { registro_listo: false, solo_mias: soloMias, filas: [] };
      ventas.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    // (2026-10-09) La guía que la venta directa emite después de la boleta/factura
    // (clave …-G, tipo guia) no es otra venta: salía listada como una boleta
    // más. Queda solo como guía de su venta (`guias`).
    let lista = ventas.filter((e) => e.tipo === 'boleta' || e.tipo === 'factura');
    if (soloMias) lista = lista.filter((e) => String(e.usuario || '').trim().toLowerCase() === miEmail);
    ventas.length = 0;
    ventas.push(...lista);

    // Documentos y cotizaciones de esas ventas (de a 300 ids por consulta).
    const porLotes = async (ids: number[], fn: (lote: number[]) => Promise<any[]>) => {
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += 300) out.push(...(await fn(ids.slice(i, i + 300))));
      return out;
    };
    const sinLic = [...new Set(ventas.filter((e) => !e.licitacion_id && e.documento_id).map((e) => Number(e.documento_id)))];
    if (sinLic.length) {
      const ds = await porLotes(sinLic, async (l) => (await db.from('licitacion_documentos').select('id, licitacion_id').in('id', l)).data || []);
      const licDe = new Map(ds.map((d: any) => [Number(d.id), Number(d.licitacion_id) || null]));
      for (const e of ventas) if (!e.licitacion_id && e.documento_id) e.licitacion_id = licDe.get(Number(e.documento_id)) || null;
    }
    const licIds = [...new Set(ventas.map((e) => Number(e.licitacion_id)).filter((id) => id > 0))];
    const lics = new Map<number, any>();
    for (const l of await porLotes(licIds, async (lote) => (await db.from('licitaciones').select('id, id_licitacion, nombre_entidad, rut_entidad, condicion_venta').in('id', lote)).data || [])) {
      lics.set(Number(l.id), l);
    }
    const docs = await porLotes(licIds, async (lote) =>
      (await db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero, monto, pagada, fecha_pago, forma_pago, deriva_de_id, fecha_oc, created_at').in('licitacion_id', lote)).data || []);
    const docsDe = new Map<number, any[]>();
    for (const d of docs) {
      const k = Number(d.licitacion_id);
      if (!docsDe.has(k)) docsDe.set(k, []);
      (docsDe.get(k) as any[]).push(d);
    }

    const sumar = (lista: any[]) => (lista.length ? { total: lista.reduce((a, d) => a + (Number(d.monto) || 0), 0), numeros: lista.map((d) => String(d.numero || '')).filter(Boolean) } : null);
    return {
      registro_listo: true,
      solo_mias: soloMias,
      filas: ventas.map((e) => {
        const lic = lics.get(Number(e.licitacion_id)) || null;
        const dl = docsDe.get(Number(e.licitacion_id)) || [];
        const doc = dl.find((d) => Number(d.id) === Number(e.documento_id))
          || dl.find((d) => d.tipo === 'factura_boleta' && String(d.numero) === String(e.numero)) || null;
        const hijos = (tipo: string) => (doc ? dl.filter((d) => d.tipo === tipo && Number(d.deriva_de_id) === Number(doc.id)) : []);
        const nc = sumar(hijos('nota_credito'));
        const total = Number(e.total) || null;
        return {
          id: e.id,
          tipo: e.tipo === 'factura' ? 'factura' : 'boleta',
          estado: e.estado,
          error: e.estado === 'emitida' ? null : e.error || null,
          numero: e.numero || null,
          fecha: e.fecha_emision || String(e.updated_at || e.created_at || '').slice(0, 10) || null,
          neto: Number(e.neto) || null,
          total,
          url_pdf: e.url_pdf || null,
          bsale_id: Number(e.bsale_id) || null,
          documento_id: doc ? Number(doc.id) : Number(e.documento_id) || null,
          licitacion_id: Number(e.licitacion_id) || null,
          codigo: lic?.id_licitacion || null,
          cliente: lic?.nombre_entidad || '',
          rut: lic?.rut_entidad || null,
          credito: /cr[eé]dito/i.test(String(lic?.condicion_venta || '')),
          condicion: lic?.condicion_venta || null,
          pagada: !!doc?.pagada,
          fecha_pago: doc?.fecha_pago || null,
          forma_pago: doc?.forma_pago || null,
          nc,
          nd: sumar(hijos('nota_debito')),
          anulada: !!nc && !!total && nc.total >= total - 2,
          guias: dl.filter((d) => d.tipo === 'guia_despacho').map((d) => ({ id: Number(d.id), numero: String(d.numero || '') })),
          comprobantes: hijos('comprobante_pago').map((d) => ({ numero: String(d.numero || ''), monto: Number(d.monto) || null, forma_pago: d.forma_pago || null })),
          usuario: e.usuario || null,
        };
      }),
    };
  }

  // ── Borrador ────────────────────────────────────────────────────────────

  async preparar(userId: string, licitacionId: number, guiaDocIdsIn: number[]) {
    await this.exigirRol(userId);
    if (!this.token) throw new BadRequestException('La integración con Bsale no está configurada (falta el token).');
    const { _recuperar, ...borrador } = await this.armarBorrador(licitacionId, guiaDocIdsIn);
    return borrador;
  }

  private async armarBorrador(licitacionId: number, guiaDocIdsIn: number[]) {
    const licId = Number(licitacionId);
    const guiaDocIds = [...new Set((guiaDocIdsIn || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort(
      (a, b) => a - b,
    );
    if (!licId) throw new BadRequestException('Falta la cotización.');
    if (!guiaDocIds.length) throw new BadRequestException('Selecciona al menos una guía de despacho.');

    const db = this.supabase.getClient();
    const { data: lic, error: errLic } = await db
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, rut_entidad, condicion_venta, estado')
      .eq('id', licId)
      .maybeSingle();
    if (errLic || !lic) throw new BadRequestException('No se encontró la cotización.');
    const folioCot = folioCotizacion(lic); // para leer la OC de las referencias de la guía

    const { data: docsData, error: errDocs } = await db
      .from('licitacion_documentos')
      .select('id, tipo, numero, monto, fecha_oc, fecha_factura, deriva_de_id, guias_ids, created_at')
      .eq('licitacion_id', licId)
      .in('tipo', ['orden_compra', 'guia_despacho', 'factura', 'factura_boleta', 'nota_credito']);
    if (errDocs) throw new BadRequestException(errDocs.message);
    const docs: any[] = docsData || [];
    const ocs = docs.filter((d) => d.tipo === 'orden_compra');
    const guiasSistema = docs.filter((d) => d.tipo === 'guia_despacho');
    // (2026-10-16) Una factura anulada con nota de crédito en el sistema no cuenta: la guía se puede volver a facturar.
    const anuladasSistema = this.facturasAnuladasEnSistema(docs);
    const todasFacturas = docs.filter((d) => d.tipo === 'factura' || d.tipo === 'factura_boleta');
    const facturas = todasFacturas.filter((f) => !anuladasSistema.has(Number(f.id)));
    const esDeGuia = (f: any, g: any) => f.deriva_de_id === g.id || (Array.isArray(f.guias_ids) && f.guias_ids.map(Number).includes(g.id));
    const facturaDe = (g: any) => facturas.find((f) => esDeGuia(f, g));
    const anuladasDe = (g: any) => todasFacturas.filter((f) => anuladasSistema.has(Number(f.id)) && esDeGuia(f, g));

    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    const elegidas: any[] = [];
    for (const id of guiaDocIds) {
      const g = guiasSistema.find((d) => d.id === id);
      if (!g) throw new BadRequestException('Una de las guías no pertenece a esta cotización.');
      elegidas.push(g);
      const f = facturaDe(g);
      if (f) problemas.push({ codigo: 'ya_facturada_sistema', mensaje: `La guía ${g.numero || 's/n'} ya tiene la factura ${f.numero || 's/n'} registrada en el sistema.` });
      const previas = anuladasDe(g);
      if (previas.length) {
        avisos.push({
          codigo: 'facturas_anuladas_sistema',
          mensaje: `La guía ${g.numero || 's/n'} ya tuvo en el sistema ${previas.length === 1 ? 'una factura anulada' : `${previas.length} facturas anuladas`} con nota de crédito: ${previas.map((p) => `factura ${p.numero || 's/n'} → NC ${anuladasSistema.get(Number(p.id))!.notas.join(', ')}`).join('; ')}. Se puede emitir de nuevo.`,
        });
      }
      if (!folioGuia(g.numero)) problemas.push({ codigo: 'guia_sin_numero', mensaje: `La guía «${g.numero || 'sin número'}» no tiene un número de guía reconocible: no se puede buscar en Bsale. Corrige el número en Trazabilidad.` });
    }

    // Las guías en Bsale
    const { tipoFactura, formas } = await this.listas();
    if (!tipoFactura) problemas.push({ codigo: 'sin_tipo_factura', mensaje: 'La cuenta de Bsale no tiene activa la factura electrónica.' });

    const guias: any[] = [];
    const lineas: any[] = [];
    const referencias: Referencia[] = [];
    const clientes = new Map<number, any>();
    const sucursales = new Set<number>();
    const ocsSistema: string[] = []; // OC del sistema que no coinciden con la de la guía
    let primeraEmision = Infinity;
    for (const g of elegidas) {
      if (!folioGuia(g.numero)) continue;
      const enBsale = await this.guiaEnBsale(g.numero);
      if (!enBsale) {
        problemas.push({ codigo: 'guia_no_esta', mensaje: `Bsale no tiene una guía de despacho electrónica con el N° ${folioGuia(g.numero)}. Solo se puede facturar desde una guía emitida en Bsale.` });
        continue;
      }
      const { doc, detalles } = enBsale;
      if (Number(doc.state) === 1) {
        problemas.push({ codigo: 'guia_anulada', mensaje: `La guía ${doc.number} está anulada en Bsale.` });
      }
      if (doc.client?.id) clientes.set(Number(doc.client.id), doc.client);
      else problemas.push({ codigo: 'guia_sin_cliente', mensaje: `La guía ${doc.number} no tiene cliente en Bsale.` });
      if (doc.office?.id) sucursales.add(Number(doc.office.id));
      const emision = Number(doc.emissionDate) || 0;
      if (emision) primeraEmision = Math.min(primeraEmision, emision);

      const lineasGuia = detalles.map((d: any) => ({
        detalle_id: Number(d.id),
        guia: String(doc.number),
        sku: String(d?.variant?.code || '').trim(),
        producto: [d?.product?.name, d?.variant?.description].map((x) => String(x || '').trim()).filter(Boolean).join(' · '),
        nota: String(d?.note || '').trim(),
        cantidad: Number(d.quantity || 0),
        neto_unitario: Number(d.netUnitValue || 0),
        neto: Number(d.netAmount ?? Number(d.quantity || 0) * Number(d.netUnitValue || 0)) || 0,
      }));
      if (!lineasGuia.length) problemas.push({ codigo: 'guia_sin_lineas', mensaje: `La guía ${doc.number} no tiene productos en Bsale.` });
      if (lineasGuia.some((l) => !(l.cantidad > 0) || !l.detalle_id)) {
        problemas.push({ codigo: 'linea_invalida', mensaje: `La guía ${doc.number} tiene una línea sin cantidad.` });
      }
      lineas.push(...lineasGuia);

      guias.push({
        doc_id: g.id,
        // Lo digitado en el sistema puede traer una nota ("767 - NO FACTURAR
        // HASTA…"): se muestra tal cual junto al folio.
        nota: String(g.numero || '').trim() !== String(doc.number) ? String(g.numero || '').trim() : null,
        numero: String(doc.number),
        fecha: epochAFecha(doc.emissionDate),
        neto: Number(doc.netAmount || 0),
        total: Number(doc.totalAmount || 0),
        lineas: lineasGuia.length,
        url: doc.urlPublicView || doc.urlPdf || null,
      });

      // Referencia a la orden de compra: la que trae la guía en Bsale; si no
      // trae, la OC del sistema de la que deriva la guía.
      const refsOc = (enBsale.referencias || []).filter((r: any) => r.codigo_sii === DTE_OC);
      const ocSistema = ocs.find((o) => o.id === g.deriva_de_id);
      if (refsOc.length) {
        for (const r of refsOc) {
          const numero = ocDeReferencia(r, folioCot);
          if (numero && !referencias.some((x) => x.codigo_sii === DTE_OC && x.numero === numero)) {
            referencias.push(referenciaOcFactura(numero, epochAFecha(r.referenceDate)));
          }
        }
        // La guía se digitó en Bsale y la OC en el sistema: si no dicen lo
        // mismo, una de las dos tiene un error de tipeo y hay que mirarlo.
        const delSistema = normOc(ocSistema?.numero);
        if (delSistema && !refsOc.some((r: any) => ocDeReferencia(r, folioCot) === delSistema)) {
          avisos.push({
            codigo: 'oc_distinta',
            mensaje: `La guía ${doc.number} referencia en Bsale la orden de compra ${ocDeReferencia(refsOc[0], folioCot)}, pero en el sistema está cargada como ${delSistema}. Revisa cuál es la correcta: puedes corregirla antes de emitir.`,
          });
          if (!ocsSistema.includes(delSistema)) ocsSistema.push(delSistema);
        }
      } else if (ocSistema?.numero) {
        const numero = normOc(ocSistema.numero);
        if (!referencias.some((x) => x.codigo_sii === DTE_OC && x.numero === numero)) {
          referencias.push(referenciaOcFactura(numero, String(ocSistema.fecha_oc || '').slice(0, 10) || null));
        }
      }
      // La fila de la guía lleva su folio y, como razón, el N° de la orden de compra.
      const ocDeLaGuia = refsOc.length ? ocDeReferencia(refsOc[0], folioCot) : normOc(ocSistema?.numero);
      referencias.push(referenciaGuia(String(doc.number), epochAFecha(doc.emissionDate), ocDeLaGuia));

      // Cuadre con la orden de compra del sistema (aviso, no bloquea: una OC
      // puede despacharse en varias guías).
      if (ocSistema && Number(ocSistema.monto) > 0 && Math.abs(Number(ocSistema.monto) - Number(doc.netAmount || 0)) > 2) {
        avisos.push({
          codigo: 'neto_distinto_oc',
          mensaje: `La guía ${doc.number} suma $${Number(doc.netAmount || 0).toLocaleString('es-CL')} neto y su orden de compra $${Number(ocSistema.monto).toLocaleString('es-CL')}. Es normal si la orden se despacha en varias guías.`,
        });
      }
    }
    // OC primero y guías después, como las facturas hechas a mano.
    referencias.sort((a, b) => (a.codigo_sii === b.codigo_sii ? 0 : a.codigo_sii === DTE_OC ? -1 : 1));
    if (!referencias.some((r) => r.codigo_sii === DTE_OC) && guias.length) {
      avisos.push({ codigo: 'sin_oc', mensaje: 'No se encontró la orden de compra: la factura saldría sin esa referencia.' });
    }
    for (const r of referencias) {
      if (r.folio.length > MAX_FOLIO_REF) {
        avisos.push({ codigo: 'folio_largo', mensaje: `El folio de referencia ${r.folio} tiene más de ${MAX_FOLIO_REF} caracteres, que es el máximo que acepta el SII.` });
      }
    }

    if (clientes.size > 1) problemas.push({ codigo: 'clientes_distintos', mensaje: 'Las guías elegidas son de clientes distintos en Bsale: no pueden ir en una misma factura.' });
    const cliente = [...clientes.values()][0] || null;
    if (cliente && Number(cliente.state) === 1) problemas.push({ codigo: 'cliente_inactivo', mensaje: 'El cliente está inactivo en Bsale.' });
    /* La guía se busca en Bsale solo por su número. Si su cliente no es el de
       la cotización, el número digitado apunta a OTRA guía: facturarla sería
       facturar los productos de otro cliente. (En las guías reales revisadas
       el RUT coincide siempre.) */
    if (cliente && normRut(lic.rut_entidad) && normRut(lic.rut_entidad) !== normRut(cliente.code)) {
      problemas.push({
        codigo: 'cliente_distinto',
        mensaje: `La guía ${guias.map((g) => g.numero).join(', ')} en Bsale es de ${String(cliente.company || '').trim() || 'otro cliente'} (RUT ${cliente.code || 'sin RUT'}), y esta cotización es de ${lic.nombre_entidad || 'otro cliente'} (RUT ${lic.rut_entidad}). Revisa el número de la guía en Trazabilidad.`,
      });
    } else if (cliente && !normRut(lic.rut_entidad)) {
      avisos.push({ codigo: 'cotizacion_sin_rut', mensaje: `La cotización no tiene RUT cargado: no se pudo comprobar que la guía sea de este cliente (${cliente.code}).` });
    }

    // ¿Alguna ya está facturada en Bsale?
    let recuperar: { emision_id: number; numero: string; doc: any } | null = null;
    if (guias.length && Number.isFinite(primeraEmision)) {
      const { halladas: ya, anuladas } = await this.facturasQueReferencian(guias.map((g) => g.numero), primeraEmision);
      // Historial: facturas de esta guía que ya se anularon con nota de crédito (no bloquean).
      for (const g of guias) {
        const previas = anuladas.get(soloDigitos(g.numero)) || [];
        if (previas.length) {
          avisos.push({
            codigo: 'facturas_anuladas',
            mensaje: `La guía ${g.numero} ya se facturó en Bsale ${previas.length === 1 ? 'una vez' : `${previas.length} veces`} y se anuló con nota de crédito: ${previas.map((p) => `factura ${p.numero}${p.fecha ? ` (${p.fecha})` : ''} → NC ${p.notas.join(', ') || 's/n'}`).join('; ')}. Se puede emitir de nuevo.`,
          });
        }
      }
      /* Si la respuesta de una emisión se perdió, la factura existe en Bsale
         pero no en el sistema. Se reconoce como propia por su `salesId` y, en
         vez de bloquear, se ofrece terminar de registrarla. */
      if (ya.size) {
        const pendiente = await this.emisionSinConfirmar(`AMS-${licId}-${guiaDocIds.join('.')}`);
        if (pendiente) {
          for (const f of new Set([...ya.values()].map((x) => x.numero))) {
            const doc = await this.facturaPorNumero(f);
            if (doc && String(doc.salesId || '') === String(pendiente.sales_id)) {
              recuperar = { emision_id: Number(pendiente.id), numero: String(doc.number), doc };
            }
          }
        }
      }
      if (!recuperar) {
        for (const g of guias) {
          const f = ya.get(soloDigitos(g.numero));
          if (f) problemas.push({ codigo: 'ya_facturada_bsale', mensaje: `La guía ${g.numero} ya está facturada en Bsale: factura ${f.numero}${f.fecha ? ` del ${f.fecha}` : ''}. Súbela al sistema en vez de emitir otra.` });
        }
      }
    }

    const totales = totalesDe(lineas);
    if (guias.length === 1 && guias[0].total > 0 && Math.abs(guias[0].total - totales.total) > 1) {
      avisos.push({ codigo: 'total_distinto', mensaje: `El total calculado ($${totales.total.toLocaleString('es-CL')}) difiere del de la guía ($${guias[0].total.toLocaleString('es-CL')}).` });
    }
    if (lineas.length && !(totales.neto > 0)) problemas.push({ codigo: 'sin_monto', mensaje: 'La guía no tiene montos: no se puede facturar.' });

    const hoy = hoyEnChile();
    const fechaMinima = guias.map((g) => g.fecha).filter(Boolean).sort().pop() || hoy; // la guía más nueva
    const formaCliente = Number(cliente?.payment_type?.id) || 0;
    const formaPorDefecto = formas.find((f) => f.id === formaCliente)?.id || formas.find((f) => /^cr[eé]dito$/i.test(f.nombre))?.id || formas[0]?.id || null;
    if (!formaPorDefecto) problemas.push({ codigo: 'sin_forma_pago', mensaje: 'La cuenta de Bsale no tiene formas de pago activas.' });

    // Otras guías de la cotización que aún no tienen factura (para sumarlas).
    const disponibles = guiasSistema
      .filter((g) => !facturaDe(g) && folioGuia(g.numero))
      .map((g) => ({
        doc_id: g.id,
        numero: folioGuia(g.numero),
        nota: String(g.numero || '').trim() !== folioGuia(g.numero) ? String(g.numero || '').trim() : null,
        fecha: String(g.fecha_oc || g.created_at || '').slice(0, 10) || null,
      }))
      .sort((a, b) => a.doc_id - b.doc_id);

    const borrador = {
      modo: this.emisionActiva ? 'activa' : 'simulacion',
      cotizacion: { id: lic.id, codigo: lic.id_licitacion || null, cliente: lic.nombre_entidad || '', condicion_venta: lic.condicion_venta || '' },
      tipo_documento_id: Number(tipoFactura?.id) || 0,
      tipo_documento: String(tipoFactura?.name || 'Factura electrónica'),
      sucursal_id: sucursales.size === 1 ? [...sucursales][0] : null,
      cliente: cliente
        ? {
            id: Number(cliente.id),
            razon_social: String(cliente.company || `${cliente.firstName || ''} ${cliente.lastName || ''}`).trim(),
            rut: String(cliente.code || ''),
            giro: String(cliente.activity || ''),
            direccion: String(cliente.address || ''),
            comuna: String(cliente.municipality || ''),
            ciudad: String(cliente.city || ''),
          }
        : null,
      guias,
      guias_disponibles: disponibles,
      lineas,
      totales,
      referencias,
      // Solo se puede corregir el folio de la OC cuando la factura lleva una.
      oc_editable: referencias.filter((r) => r.codigo_sii === DTE_OC).length === 1,
      oc_del_sistema: ocsSistema[0] || null,
      formas_pago: formas,
      forma_pago_id: formaPorDefecto,
      fecha_emision: hoy,
      fecha_minima: fechaMinima,
      fecha_maxima: hoy,
      dias_vencimiento: plazoDias(lic.condicion_venta),
      // Factura que este sistema ya emitió y falta registrar en la cotización.
      recuperar: recuperar ? { numero: recuperar.numero } : null,
      problemas,
      avisos,
    };
    return { ...borrador, huella: this.huellaDe(borrador), _recuperar: recuperar };
  }

  // Emisión de la misma combinación de guías que quedó sin confirmar.
  private async emisionSinConfirmar(clave: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('bsale_emisiones')
      .select('*')
      .eq('clave', clave)
      .in('estado', ['incierta', 'enviando'])
      .order('id', { ascending: false })
      .limit(1);
    if (error) return null;
    return (data as any[])?.[0] || null;
  }

  private async facturaPorNumero(numero: string) {
    const r = await this.apiGet(`/documents.json?codesii=${DTE_FACTURA}&number=${soloDigitos(numero)}&limit=5`);
    const items: any[] = r?.items || [];
    return items.find((d) => Number(d?.state) !== 1) || items[0] || null;
  }

  // Resume lo que define la factura; si cambia entre revisar y emitir, se frena.
  huellaDe(b: any): string {
    const base = JSON.stringify({
      c: b.cliente?.id || 0,
      t: b.tipo_documento_id,
      l: (b.lineas || []).map((l: any) => [l.detalle_id, l.cantidad, l.neto]),
      r: (b.referencias || []).map((r: any) => [r.codigo_sii, r.folio, r.numero]),
      n: b.totales?.total || 0,
    });
    return createHash('sha256').update(base).digest('hex').slice(0, 24);
  }

  // ── Emisión ─────────────────────────────────────────────────────────────

  async emitir(
    usuario: { id: string; email: string },
    body: { licitacion_id: number; guia_ids: number[]; fecha_emision?: string; dias_vencimiento?: number; forma_pago_id?: number; oc_numero?: string; huella?: string; simular?: boolean },
  ) {
    await this.exigirRol(usuario.id);
    if (!this.token) throw new BadRequestException('La integración con Bsale no está configurada (falta el token).');

    const licId = Number(body?.licitacion_id);
    const guiaIds = [...new Set((body?.guia_ids || []).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
    const clave = `AMS-${licId}-${guiaIds.join('.')}`;
    const db = this.supabase.getClient();
    // Botón "Simular" (o emisión apagada en el servidor): se arma y se valida
    // todo igual, pero no se llama a Bsale ni se escribe nada.
    const real = this.emisionActiva && body?.simular !== true;

    // Una emisión que sí salió pero no alcanzó a registrarse en el sistema se
    // completa aquí, sin volver a llamar a Bsale.
    if (real) {
      const pendiente = await this.emisionSinRegistrar(clave);
      if (pendiente) return this.registrarEnSistema(pendiente, usuario.email);
    }

    const b = await this.armarBorrador(licId, guiaIds);
    if (real && b._recuperar && !b.problemas.length) {
      const doc = b._recuperar.doc;
      const datos = {
        estado: 'emitida',
        respuesta: doc,
        bsale_id: Number(doc?.id) || null,
        numero: String(doc?.number ?? ''),
        neto: Number(doc?.netAmount) || null,
        total: Number(doc?.totalAmount) || null,
        url_pdf: doc?.urlPdf || doc?.urlPublicView || null,
        fecha_emision: epochAFecha(doc?.emissionDate) || hoyEnChile(),
        error: null,
        updated_at: new Date().toISOString(),
      };
      await db.from('bsale_emisiones').update(datos).eq('id', b._recuperar.emision_id);
      this.logger.log(`Factura ${datos.numero} recuperada desde Bsale (cotización ${licId}) por ${usuario.email}`);
      return this.registrarEnSistema({ id: b._recuperar.emision_id, licitacion_id: licId, guias_doc_ids: guiaIds, ...datos }, usuario.email);
    }
    if (b.problemas.length) {
      throw new BadRequestException(`No se puede emitir: ${b.problemas.map((p) => p.mensaje).join(' ')}`);
    }
    if (!body?.huella || body.huella !== b.huella) {
      throw new ConflictException('La guía cambió en Bsale desde que revisaste el borrador. Vuelve a abrirlo y revísalo otra vez.');
    }

    const fecha = String(body?.fecha_emision || b.fecha_emision).slice(0, 10);
    if (!Number.isFinite(fechaAEpoch(fecha))) throw new BadRequestException('La fecha de emisión no es válida.');
    if (fecha > b.fecha_maxima) throw new BadRequestException('La fecha de emisión no puede ser futura.');
    if (fecha < b.fecha_minima) throw new BadRequestException(`La fecha de emisión no puede ser anterior a la de la guía (${b.fecha_minima}).`);
    const dias = Math.round(Number(body?.dias_vencimiento ?? b.dias_vencimiento));
    if (!Number.isFinite(dias) || dias < 0 || dias > 365) throw new BadRequestException('El plazo de vencimiento debe estar entre 0 y 365 días.');
    const forma = Number(body?.forma_pago_id ?? b.forma_pago_id);
    if (!b.formas_pago.some((f) => f.id === forma)) throw new BadRequestException('La forma de pago no existe en Bsale.');

    // Corrección del folio de la orden de compra (la guía puede traerlo mal tipeado).
    const ocNueva = normOc(body?.oc_numero);
    if (ocNueva) {
      if (!b.oc_editable) throw new BadRequestException('Esta factura no lleva una única orden de compra que corregir.');
      if (ocNueva.length > MAX_FOLIO_REF) throw new BadRequestException(`El N° de orden de compra no puede tener más de ${MAX_FOLIO_REF} caracteres.`);
      b.referencias = b.referencias.map((r) =>
        r.codigo_sii === DTE_OC ? referenciaOcFactura(ocNueva, r.fecha) : r.codigo_sii === DTE_GUIA ? { ...r, razon: ocNueva } : r,
      );
    }

    const opciones = { fecha_emision: fecha, dias_vencimiento: dias, forma_pago_id: forma };

    if (!real) {
      const solicitud = armarSolicitud(b as any, { ...opciones, sales_id: `${clave}-0` });
      const vendedor = await this.ponerVendedor(solicitud, null, licId, usuario.email);
      const formaPago = b.formas_pago.find((f) => f.id === forma);
      return {
        simulacion: true,
        // Se pidió emitir pero el servidor tiene la emisión apagada.
        emision_apagada: body?.simular !== true,
        solicitud,
        totales: b.totales,
        fecha_vencimiento: sumarDias(fecha, dias),
        // Lo que verá la persona: el documento como quedaría, en palabras.
        vista: {
          correo: this.correos ? await this.correos.destinatarioDocumento(licId) : null,
          tipo: 'Factura electrónica',
          sii: true,
          descuenta_stock: false,
          emisor: EMISOR,
          cliente: b.cliente,
          lineas: b.lineas.map((l) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto, guia: l.guia })),
          totales: b.totales,
          referencias: b.referencias.map(referenciaVista),
          forma_pago: formaPago?.nombre || null,
          fecha_emision: fecha,
          vencimiento: sumarDias(fecha, dias),
          vendedor: vendedor.nombre,
          notas: ['Las líneas quedan enlazadas a la guía: el stock no se descuenta otra vez.', ...(vendedor.aviso ? [vendedor.aviso] : [])],
        },
      };
    }

    // ── A partir de aquí es emisión real ──
    const { count: previas, error: errCuenta } = await db
      .from('bsale_emisiones')
      .select('id', { count: 'exact', head: true })
      .eq('clave', clave)
      .eq('estado', 'emitida');
    if (errCuenta) {
      throw new BadRequestException('Falta aplicar la migración de emisiones de Bsale (tabla bsale_emisiones). Sin ese registro no se emite.');
    }
    // Mismo `salesId` mientras el intento no se confirme: si la respuesta se
    // pierde, Bsale devuelve la factura ya creada en vez de hacer otra.
    const salesId = `${clave}-${previas || 0}`;
    const solicitud = armarSolicitud(b as any, { ...opciones, sales_id: salesId });
    await this.ponerVendedor(solicitud, null, licId, usuario.email);

    const fila = {
      sales_id: salesId,
      clave,
      tipo: 'factura',
      licitacion_id: licId,
      guias_doc_ids: guiaIds,
      estado: 'enviando',
      solicitud,
      usuario: usuario.email || null,
      error: null,
      updated_at: new Date().toISOString(),
    };
    const { data: previa } = await db.from('bsale_emisiones').select('id, estado, updated_at').eq('sales_id', salesId).maybeSingle();
    let emisionId: number;
    if (previa) {
      const reciente = Date.now() - new Date((previa as any).updated_at).getTime() < 90 * 1000;
      if ((previa as any).estado === 'enviando' && reciente) {
        throw new ConflictException('Ya hay una emisión en curso para esta guía. Espera un momento y revisa si la factura quedó registrada.');
      }
      const { error } = await db.from('bsale_emisiones').update(fila).eq('id', (previa as any).id);
      if (error) throw new BadRequestException(error.message);
      emisionId = (previa as any).id;
    } else {
      let { data, error } = await db.from('bsale_emisiones').insert([fila]).select('id').single();
      // Migración 20261004 (columna tipo) sin aplicar: la factura se registra igual.
      if (error && /tipo/.test(String(error.message)) && /column|schema cache/i.test(String(error.message))) {
        const { tipo: _t, ...sinTipo } = fila;
        ({ data, error } = await db.from('bsale_emisiones').insert([sinTipo]).select('id').single());
      }
      // La restricción única sobre sales_id corta dos clics simultáneos.
      if (error) throw new ConflictException('Ya hay una emisión en curso para esta guía.');
      emisionId = (data as any).id;
    }

    let doc: any = null;
    try {
      doc = await this.apiPostDocumento(solicitud);
    } catch (e: any) {
      const incierta = e?.incierta === true;
      await db
        .from('bsale_emisiones')
        .update({ estado: incierta ? 'incierta' : 'error', error: String(e?.message || e).slice(0, 1000), updated_at: new Date().toISOString() })
        .eq('id', emisionId);
      if (incierta) {
        throw new BadGatewayException('Bsale no respondió y no se sabe si la factura se emitió. Vuelve a intentarlo: lleva el mismo identificador, así que no se duplicará.');
      }
      throw new BadRequestException(`Bsale rechazó la factura: ${String(e?.message || e).slice(0, 400)}`);
    }

    const emitida = {
      estado: 'emitida',
      respuesta: doc,
      bsale_id: Number(doc?.id) || null,
      numero: doc?.number != null ? String(doc.number) : null,
      neto: Number(doc?.netAmount ?? b.totales.neto) || null,
      total: Number(doc?.totalAmount ?? b.totales.total) || null,
      url_pdf: doc?.urlPdf || doc?.urlPublicView || null,
      fecha_emision: fecha,
      updated_at: new Date().toISOString(),
    };
    const { error: errEmitida } = await db.from('bsale_emisiones').update(emitida).eq('id', emisionId);
    if (errEmitida) this.logger.error(`Factura ${emitida.numero} emitida en Bsale pero no se pudo marcar en bsale_emisiones: ${errEmitida.message}`);
    this.logger.log(`Factura ${emitida.numero} emitida en Bsale (cotización ${licId}, guías ${guiaIds.join(',')}) por ${usuario.email}`);

    // Bsale calcula los montos por su cuenta: si no dan lo del borrador, se dice.
    const avisosEmision: string[] = [];
    if (Number.isFinite(Number(doc?.totalAmount)) && Math.abs(Number(doc.totalAmount) - b.totales.total) > 1) {
      avisosEmision.push(
        `Bsale emitió la factura por $${Number(doc.totalAmount).toLocaleString('es-CL')} y el borrador decía $${b.totales.total.toLocaleString('es-CL')}. Revisa la factura en Bsale.`,
      );
      this.logger.warn(`Factura ${emitida.numero}: total de Bsale ${doc.totalAmount} ≠ borrador ${b.totales.total}`);
    }
    if (solicitud.sellerId && emitida.bsale_id) {
      const sinVendedor = await this.avisoVendedor(emitida.bsale_id, emitida.numero, Number(solicitud.sellerId));
      if (sinVendedor) avisosEmision.push(sinVendedor);
    }

    return this.registrarEnSistema({ id: emisionId, ...fila, ...emitida }, usuario.email, avisosEmision);
  }

  private async emisionSinRegistrar(clave: string) {
    const { data } = await this.supabase
      .getClient()
      .from('bsale_emisiones')
      .select('*')
      .eq('clave', clave)
      .eq('estado', 'emitida')
      .is('documento_id', null)
      .order('id', { ascending: false })
      .limit(1);
    return (data as any[])?.[0] || null;
  }

  /* POST del documento. Un rechazo con respuesta (4xx) es un error claro; si
     no hay respuesta o es 5xx, NO se sabe si Bsale alcanzó a emitir: se marca
     `incierta` y no se reintenta solo. */
  private apiPostDocumento(solicitud: Record<string, any>): Promise<any> {
    return this.apiPost('/documents.json', solicitud);
  }

  async apiPost(ruta: string, solicitud: Record<string, any>): Promise<any> {
    return this.apiEnviar('POST', ruta, solicitud);
  }

  /* POST, PUT o DELETE a Bsale. Un 5xx o una respuesta perdida queda
     "incierta" (no se sabe si Bsale lo hizo); un 4xx trae el motivo del rechazo.
     DELETE (anular una guía, 2026-10-16) va sin cuerpo. */
  async apiEnviar(metodo: 'POST' | 'PUT' | 'DELETE', ruta: string, solicitud: Record<string, any> | null): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(`${this.base}/v1${ruta}`, {
        method: metodo,
        headers: { access_token: this.token, Accept: 'application/json', ...(solicitud ? { 'Content-Type': 'application/json' } : {}) },
        ...(solicitud ? { body: JSON.stringify(solicitud) } : {}),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      throw Object.assign(new Error(`sin respuesta de Bsale (${e?.name || 'error de red'})`), { incierta: true });
    } finally {
      clearTimeout(t);
    }
    const texto = await res.text().catch(() => '');
    if (res.status >= 500) throw Object.assign(new Error(`Bsale ${res.status}: ${texto.slice(0, 300)}`), { incierta: true });
    if (!res.ok) {
      // Bsale explica el rechazo en `error` (o `message`): se muestra eso, no el JSON.
      let motivo = texto.slice(0, 600);
      try {
        const cuerpo = JSON.parse(texto);
        motivo = String(cuerpo?.error || cuerpo?.message || motivo).slice(0, 600);
      } catch {
        /* no era JSON */
      }
      throw new Error(motivo || `código ${res.status}`);
    }
    try {
      return JSON.parse(texto);
    } catch {
      throw Object.assign(new Error('Bsale respondió algo que no se pudo leer'), { incierta: true });
    }
  }

  /* Deja la factura emitida como documento de la cotización, igual que si la
     hubieran subido a mano: número, neto, fecha, guías y el PDF guardado. */
  private async registrarEnSistema(emision: any, email: string, avisosPrevios: string[] = []) {
    const db = this.supabase.getClient();
    const licId = Number(emision.licitacion_id);
    const guiaIds: number[] = (emision.guias_doc_ids || []).map(Number);
    const numero = String(emision.numero || '');
    const avisos: string[] = [...avisosPrevios];

    // PDF: Bsale puede tardar unos segundos en tenerlo listo.
    let archivo: { path: string; size: number } | null = null;
    if (emision.url_pdf) {
      for (let intento = 0; intento < 4 && !archivo; intento++) {
        try {
          const r = await fetch(String(emision.url_pdf));
          const tipo = r.headers.get('content-type') || '';
          if (r.ok && /pdf/i.test(tipo)) {
            const buf = Buffer.from(await r.arrayBuffer());
            const path = `${licId}/${Date.now()}-bsale-factura-${numero || emision.bsale_id}.pdf`;
            const { error } = await db.storage.from('factura').upload(path, buf, { contentType: 'application/pdf', upsert: false });
            if (!error) archivo = { path, size: buf.length };
          }
        } catch {
          /* se reintenta */
        }
        if (!archivo) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!archivo) avisos.push('No se pudo guardar el PDF en el sistema; se puede ver desde Bsale.');

    const documento: Record<string, any> = {
      licitacion_id: licId,
      tipo: 'factura',
      numero: numero || null,
      monto: Number(emision.neto) || null, // NETO, como todos los documentos
      fecha_oc: null,
      fecha_factura: emision.fecha_emision || hoyEnChile(),
      deriva_de_id: guiaIds[0] || null,
      guias_ids: guiaIds.length ? guiaIds : null,
      bucket: archivo ? 'factura' : null,
      storage_path: archivo?.path || null,
      file_name: archivo ? `Factura ${numero}.pdf` : null,
      mime_type: archivo ? 'application/pdf' : null,
      size_bytes: archivo?.size || null,
      bsale_id: Number(emision.bsale_id) || null,
      bsale_url: emision.url_pdf || null,
    };
    let { data: creado, error } = await db.from('licitacion_documentos').insert([documento]).select('id').single();
    if (error && /bsale_id|bsale_url/.test(String(error.message))) {
      const { bsale_id: _a, bsale_url: _b, ...sinBsale } = documento;
      ({ data: creado, error } = await db.from('licitacion_documentos').insert([sinBsale]).select('id').single());
    }
    if (error) {
      this.logger.error(`Factura ${numero} emitida en Bsale pero NO registrada en el sistema: ${error.message}`);
      return {
        emitida: true,
        registrada: false,
        numero,
        neto: emision.neto,
        total: emision.total,
        url_pdf: emision.url_pdf,
        avisos: [...avisosPrevios, `La factura ${numero} se emitió en Bsale pero no quedó registrada en la cotización (${error.message}). Presiona «Emitir» otra vez para registrarla: no se emitirá de nuevo.`],
      };
    }
    await db
      .from('bsale_emisiones')
      .update({ documento_id: (creado as any).id, updated_at: new Date().toISOString() })
      .eq('id', emision.id);
    // (2026-10-08) Nunca se envía sola: queda el aviso que abre la ventana de
    // correo con la factura prellenada, y la persona revisa y envía.
    let correo: any = null;
    if (this.licitaciones) {
      await this.licitaciones.avisarCorreoDocumento(Number((creado as any).id), { tipo: 'factura', licitacion_id: licId, numero });
      const dest = this.correos ? await this.correos.destinatarioDocumento(licId) : null;
      correo = { ventana: true, para: dest?.para || null };
    }
    return {
      emitida: true,
      registrada: true,
      numero,
      neto: emision.neto,
      total: emision.total,
      url_pdf: emision.url_pdf,
      bsale_id: Number(emision.bsale_id) || null,
      documento_id: (creado as any).id,
      emitida_por: email,
      avisos,
      correo,
    };
  }
}
