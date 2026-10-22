import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MpColaService } from './mp-cola.service';
import { mpLimitador } from './mp-limitador';
import { fueSeleccionado } from './seleccion';

/* ============================================================
   Integración con las APIs oficiales de Mercado Público para
   comparar NUESTRAS postulaciones contra la oferta GANADORA.

   - Compra Ágil (códigos *-COT##): API v2
     GET https://api2.mercadopublico.cl/v2/compra-agil/{codigo}
     header `ticket`. Desde estado "cerrada" expone TODAS las
     cotizaciones (proveedores_cotizando[]) con montos y precios
     unitarios por producto → comparación completa.
   - Licitaciones (LE/LP/LQ/LR...): API clásica v1
     GET https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json
     ?codigo=...&ticket=...  → tras la adjudicación entrega, por ítem,
     el proveedor ganador y su monto unitario (no expone al resto de
     los oferentes).

   Config (.env): MP_API_TICKET (ticket de acceso, se pide en
   chilecompra.cl/api con Clave Única) y MP_RUT_EMPRESA (RUT con el
   que postulamos, para detectar si la oferta ganadora fue la nuestra).
   Resultados persistidos en mp_resultados (upsert por licitacion_id).
============================================================ */

const V2_BASE = 'https://api2.mercadopublico.cl';
const V1_BASE = 'https://api.mercadopublico.cl/servicios/v1/publico';

// Estados desde los cuales el proceso ya no cambia (no se vuelve a consultar).
const ESTADOS_FINALES = new Set([
  'proveedor_seleccionado', 'oc_emitida', 'adjudicada', 'desierta', 'cancelada', 'revocada', 'suspendida',
  'no_encontrada',
]);

// Estados en los que SÍ hubo adjudicación (se eligió proveedor). Es un
// subconjunto de ESTADOS_FINALES: desierta, cancelada, revocada y suspendida
// también son finales, pero en ellas nadie ganó y no hay fecha que mostrar.
const ESTADOS_ADJUDICADOS = new Set(['proveedor_seleccionado', 'oc_emitida', 'adjudicada']);

// Máximo de procesos consultados por sincronización (la API tiene cuota diaria).
const MAX_CONSULTAS_POR_SYNC = 60;

/* La concurrencia hacia la API vive ahora en mp-limitador.ts (MP_CONCURRENCIA). */

// Solo analizamos cotizaciones internas de los últimos N días.
/* Sin rango explícito se sincroniza DESDE EL DÍA 1 DEL MES ANTERIOR: el 11 de
   agosto, desde el 1 de julio. Da entre uno y dos meses de margen según el día
   en que se corra, que es la ventana en la que un proceso de Compra Ágil se
   publica, cierra y se adjudica.

   Se calcula en hora de Chile a propósito. El servidor de producción corre en
   UTC, así que la madrugada del día 1 el mes allá y acá no coinciden y la
   ventana saltaría un mes entero sin que se note. */
const ZONA_CHILE = 'America/Santiago';

function primerDiaMesAnterior(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CHILE, year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const anio = Number(partes.find((p) => p.type === 'year')?.value);
  const mes = Number(partes.find((p) => p.type === 'month')?.value);
  const y = mes === 1 ? anio - 1 : anio;
  const m = mes === 1 ? 12 : mes - 1;
  return `${y}-${String(m).padStart(2, '0')}-01T00:00:00`;
}

const RE_CODIGO_MP = /^\d{1,10}-\d{1,10}-[A-Z]{1,3}\d{2}$/i;

/* Código de Mercado Público a partir de lo que se escribió en la cotización, o
   null si eso no es un código.

   El campo se llena a mano y llega con dos vicios: espacios sueltos —incluso
   alrededor de los guiones, "799512-1088-COT26 - 2"— y un sufijo de versión
   cuando se cotiza dos veces el mismo proceso ("2381-638-COT26-2"). Comparando
   el texto tal cual, esas quedaban fuera del panel: 314 en total.

   Quitar el sufijo es seguro: un código válido termina en letras + 2 dígitos
   (COT26, LE26…), así que `-<dígitos>` al final nunca es parte del código. */
function codigoMpDe(raw: unknown): string | null {
  const limpio = String(raw || '')
    .trim()
    .replace(/\s*-\s*/g, '-')   // "1002772-2282-COT26 - 2" → "1002772-2282-COT26-2"
    .replace(/-\d+$/, '')       // quita el sufijo de versión
    .toUpperCase();
  return RE_CODIGO_MP.test(limpio) ? limpio : null;
}

function normRut(raw: unknown): string {
  return String(raw || '').replace(/[^0-9kK]/g, '').toUpperCase();
}

function esNuestro(rut: unknown, rutEmpresa: string): boolean {
  const a = normRut(rut);
  return !!a && !!rutEmpresa && a === rutEmpresa;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* fetch con timeout: una request colgada no puede estancar la sincronización.
   Estaba en 15 s, POR DEBAJO de lo que tarda la API: medido el 2026-08-11, una
   ficha de Compra Ágil responde entre 11 y 27 s. Con 15 s se abortaba casi
   todas y la sincronización giraba en falso. El techo real es de ellos: su
   gateway corta a los ~29,5 s con 504, así que 35 s alcanza para VER ese 504
   en vez de abortar antes sin saber qué pasó. */
async function fetchConTimeout(url: string, init: any = {}, ms = 35000): Promise<Response> {
  // (2026-10-21) Pasa por el limitador global: el reloj del timeout arranca
  // cuando la llamada SALE, no mientras espera cupo.
  return mpLimitador.con(url, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  });
}

@Injectable()
export class MercadopublicoService {
  private readonly logger = new Logger(MercadopublicoService.name);

  constructor(
    private supabase: SupabaseService,
    private cola: MpColaService,
  ) {}

  private get ticket(): string {
    // Se aceptan ambos nombres de variable (MERCADO_PUBLICO_TICKET fue el
    // usado al pegar el ticket por primera vez).
    return (process.env.MP_API_TICKET || process.env.MERCADO_PUBLICO_TICKET || '').trim();
  }

  private get rutEmpresa(): string {
    return normRut(process.env.MP_RUT_EMPRESA || '');
  }

  estado() {
    return {
      ticket_configurado: !!this.ticket,
      rut_configurado: !!this.rutEmpresa,
      rut_empresa: process.env.MP_RUT_EMPRESA || null,
      max_consultas_por_sync: MAX_CONSULTAS_POR_SYNC,
    };
  }

  /* ── Resultados para el panel (mp_resultados + datos internos) ──
     Con `desde` (ISO) devuelve solo las fichas consultadas después de ese
     instante. Es el modo incremental que usa la sincronización para refrescar
     entre tandas sin volver a bajar el panel completo. */
  /* (2026-10-07) Pedido de Ariel: "revisar el módulo de análisis de Mercado
     Público, está muy lenta la carga". Medido con los datos reales: 2.447
     fichas, ~10 s y 22 MB de JSON, el 90 % en `detalle` (las cotizaciones de
     cada competidor con sus productos, los productos solicitados, la
     convocatoria…) que la tabla no usa. Ahora la lista trae solo las columnas
     que usa el panel y, del detalle, lo que necesita el análisis de productos
     (comparacion_items y el monto adjudicado). El detalle completo de una
     ficha se pide al desplegarla (detalleResultado). Además: caché de 5
     minutos de la lista completa (se borra al sincronizar) y los datos
     internos se piden en paralelo. */
  /* (2026-10-09) Segunda pasada por lentitud: de los 2,7 MB que viajaban,
     1 MB era `comparacion_items` (los ítems de cada ficha), que el panel solo
     usaba para armar el análisis de productos en el navegador. Ahora ese
     análisis se arma acá (resultadosProductos) y la lista viaja sin ítems. */
  private static readonly COLS_LISTA =
    'id, licitacion_id, codigo_mp, tipo, estado_mp, participamos, ganamos, ganador_rut, ganador_nombre, ganador_es_emt, ' +
    'monto_nuestro, monto_ganador, organismo, fecha_cierre, consultado_at, fecha_adjudicacion, ' +
    'monto_nuestro_adjudicado:detalle->monto_nuestro_adjudicado';
  private cacheLista: { ts: number; datos: any[] } | null = null;
  private cacheItems: { ts: number; filas: any[] } | null = null;

  async resultados(desde?: string) {
    const client = this.supabase.getClient();
    // Se descarta un `desde` inválido en vez de fallar: peor que un refresco
    // caro es un refresco que devuelve un error a mitad de sincronización.
    const corte = desde && !Number.isNaN(Date.parse(desde)) ? new Date(desde).toISOString() : null;
    if (!corte && this.cacheLista && Date.now() - this.cacheLista.ts < 2 * 60 * 1000) return this.cacheLista.datos;
    let query = client
      .from('mp_resultados')
      .select(MercadopublicoService.COLS_LISTA)
      .order('consultado_at', { ascending: false })
      // 5.000 se quedaba corto: hay 3.337 cotizaciones con código de Mercado
      // Público y el margen se agotaba en meses, truncando el panel sin avisar.
      .range(0, 49999);
    if (corte) query = query.gt('consultado_at', corte);
    const { data: res, error } = await query;
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260807_mp_resultados.sql en Supabase.'
          : error.message,
      );
    }
    const lista = res || [];
    if (lista.length === 0) return [];

    /* Los datos internos se piden POR TANDAS. Un `.in('id', ids)` con los
       miles de ids de golpe arma una URL de decenas de KB que PostgREST
       rechaza; con pocos procesos no se notaba, pero el catálogo real son
       3.337 y al ponerse al día la sincronización iba a reventar justo aquí. */
    const ids = lista.map((r: any) => r.licitacion_id);
    const porId = new Map<any, any>();
    const TANDA_IDS = 500;
    const tandas: any[][] = [];
    for (let i = 0; i < ids.length; i += TANDA_IDS) tandas.push(ids.slice(i, i + TANDA_IDS));
    // En paralelo (antes, una tras otra: ~7 viajes seguidos con 3.300 fichas).
    const respuestas = await Promise.all(tandas.map((t) => client
      .from('licitaciones')
      .select('id, id_licitacion, nombre, nombre_entidad, estado')
      .in('id', t)));
    for (const { data: lics, error: errLics } of respuestas) {
      if (errLics) throw new BadRequestException(errLics.message);
      for (const l of lics || []) porId.set((l as any).id, l);
    }

    // Misma forma que antes para el panel: `detalle` con lo que usa la lista.
    const datos = lista.map((r: any) => {
      const { monto_nuestro_adjudicado, ...resto } = r;
      return {
        ...resto,
        detalle: { monto_nuestro_adjudicado: monto_nuestro_adjudicado ?? null, resumido: true },
        interna: porId.get(r.licitacion_id) || null,
      };
    });
    if (!corte) this.cacheLista = { ts: Date.now(), datos };
    return datos;
  }

  /* (2026-10-09) Análisis POR PRODUCTO del período (antes lo armaba el panel
     con los ítems de todas las fichas): en cuántos procesos aparece cada
     producto, cuántos ganamos o perdimos, a qué precios y cuánto movió. La
     ficha más reciente de cada código manda; el resultado por ítem manda
     cuando existe (ganado_por_nosotros) y si no hereda la clase del proceso.
     `desde`/`hasta` acotan por fecha de adjudicación (las sin fecha quedan
     fuera cuando hay rango), igual que el panel. */
  async resultadosProductos(desde?: string, hasta?: string) {
    const esFecha = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    const d = esFecha(desde) ? String(desde) : null;
    const h = esFecha(hasta) ? String(hasta) : null;
    const filas = await this.itemsFichas();
    // La ficha más reciente de cada código de Mercado Público.
    const porCodigo = new Map<string, any>();
    for (const r of filas) {
      const clave = r.codigo_mp || `sin-codigo:${r.licitacion_id}`;
      const prev = porCodigo.get(clave);
      if (!prev || Date.parse(r.consultado_at || 0) > Date.parse(prev.consultado_at || 0)) porCodigo.set(clave, r);
    }
    const clasificar = (r: any) => {
      if (r.ganamos === true) return 'ganada';
      if (r.ganamos === false && r.participamos === false) return 'sin_participar';
      if (r.ganamos === false) return 'perdida';
      if (['desierta', 'cancelada', 'revocada', 'suspendida'].includes(r.estado_mp)) return 'sin_efecto';
      if (r.estado_mp === 'no_encontrada') return 'no_encontrada';
      return 'en_curso';
    };
    const mapa = new Map<string, any>();
    let fichas = 0;
    for (const f of porCodigo.values()) {
      if (d || h) {
        const dia = String(f.fecha_adjudicacion || '').slice(0, 10);
        if (!dia) continue;
        if (d && dia < d) continue;
        if (h && dia > h) continue;
      }
      fichas += 1;
      const clase = clasificar(f);
      for (const it of Array.isArray(f.comparacion_items) ? f.comparacion_items : []) {
        const nombre = String(it?.nombre || '').trim();
        const codigo = String(it?.codigo_producto || '').trim();
        const key = (codigo || nombre).toLowerCase();
        if (!key) continue;
        const e = mapa.get(key) || {
          nombre: nombre || codigo, codigo, procesos: new Set<string>(), ganados: 0, perdidos: 0,
          precioNuestroSum: 0, precioNuestroN: 0, precioGanadorSum: 0, precioGanadorN: 0, montoAdjudicado: 0,
        };
        if (nombre && nombre.length > String(e.nombre || '').length) e.nombre = nombre;
        e.procesos.add(String(f.codigo_mp || f.licitacion_id));
        let resultado: string | null = null;
        if (typeof it.ganado_por_nosotros === 'boolean') resultado = it.ganado_por_nosotros ? 'ganado' : 'perdido';
        else if (clase === 'ganada') resultado = 'ganado';
        else if (clase === 'perdida') resultado = 'perdido';
        if (resultado === 'ganado') e.ganados += 1;
        else if (resultado === 'perdido') e.perdidos += 1;
        const pn = Number(it.nuestro_precio);
        if (Number.isFinite(pn) && pn > 0) { e.precioNuestroSum += pn; e.precioNuestroN += 1; }
        const pg = Number(it.precio_ganador);
        if (Number.isFinite(pg) && pg > 0) {
          e.precioGanadorSum += pg;
          e.precioGanadorN += 1;
          const cant = Number(it.cantidad_ganador ?? it.nuestra_cantidad ?? 1) || 1;
          e.montoAdjudicado += pg * cant;
        }
        mapa.set(key, e);
      }
    }
    const productos = [...mapa.values()]
      .map((e) => {
        const precioNuestro = e.precioNuestroN ? e.precioNuestroSum / e.precioNuestroN : null;
        const precioGanador = e.precioGanadorN ? e.precioGanadorSum / e.precioGanadorN : null;
        return {
          nombre: e.nombre, codigo: e.codigo, procesos: e.procesos.size, ganados: e.ganados, perdidos: e.perdidos,
          precioNuestro, precioGanador,
          brecha: precioNuestro != null && precioGanador != null && precioGanador > 0 ? ((precioNuestro - precioGanador) / precioGanador) * 100 : null,
          montoAdjudicado: Math.round(e.montoAdjudicado),
        };
      })
      .sort((a, b) => b.procesos - a.procesos || b.montoAdjudicado - a.montoAdjudicado);
    return { desde: d, hasta: h, fichas, productos };
  }

  /* Los ítems de todas las fichas (solo lo que usa el análisis), en caché 5 min. */
  private async itemsFichas(): Promise<any[]> {
    if (this.cacheItems && Date.now() - this.cacheItems.ts < 2 * 60 * 1000) return this.cacheItems.filas;
    const { data, error } = await this.supabase
      .getClient()
      .from('mp_resultados')
      .select('licitacion_id, codigo_mp, consultado_at, fecha_adjudicacion, ganamos, participamos, estado_mp, comparacion_items:detalle->comparacion_items')
      .order('consultado_at', { ascending: false })
      .range(0, 49999);
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message) ? 'Falta aplicar la migración 20260807_mp_resultados.sql en Supabase.' : error.message,
      );
    }
    const filas = data || [];
    this.cacheItems = { ts: Date.now(), filas };
    return filas;
  }

  /* Detalle completo de UNA ficha (cotizaciones de cada competidor, ítems…):
     lo pide el panel al desplegar la fila. Sin los productos de cada
     cotización, que el panel no muestra. */
  async detalleResultado(id: number) {
    const { data, error } = await this.supabase.getClient().from('mp_resultados').select('id, detalle').eq('id', Number(id)).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Ficha no encontrada.');
    const d: any = (data as any).detalle || {};
    return {
      id: (data as any).id,
      detalle: {
        ...d,
        cotizaciones: (Array.isArray(d.cotizaciones) ? d.cotizaciones : []).map(({ productos, ...c }: any) => c),
        productos_solicitados: undefined,
        convocatoria: undefined,
      },
    };
  }

  /* ── Sincronización: consulta la API para los procesos pendientes ──
     Rango configurable (desde/hasta, fecha de creación de la cotización
     interna, formato YYYY-MM-DD); sin rango parte del día 1 del mes anterior. */
  /* ── Planificación de la sincronización ──
     Qué procesos hay que consultar y en qué orden. NO llama a la API: es lo
     que antes hacía `sincronizar` antes de ponerse a consultar.

     Rango configurable (desde/hasta, fecha de creación de la cotización
     interna, formato YYYY-MM-DD); sin rango parte del día 1 del mes anterior. */
  async planificar(body?: { desde?: string; hasta?: string; forzar?: boolean | string }) {
    const client = this.supabase.getClient();

    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const desdeParam = reFecha.test(String(body?.desde || '')) ? `${body!.desde}T00:00:00` : null;
    const hastaParam = reFecha.test(String(body?.hasta || '')) ? `${body!.hasta}T23:59:59.999` : null;
    const desde = desdeParam || primerDiaMesAnterior();

    /* Cotizaciones internas candidatas: las que llevan código con formato de
       Mercado Público. Se pagina: un `range(0, 2000)` de una sola pasada
       dejaba fuera a las más antiguas sin avisar. */
    const conCodigo: any[] = [];
    for (let pagina = 0; ; pagina++) {
      const PAGINA = 1000;
      let query = client
        .from('licitaciones')
        .select('id, id_licitacion, nombre, nombre_entidad, creado_por, total_con_iva, total_sin_iva, created_at')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .range(pagina * PAGINA, (pagina + 1) * PAGINA - 1);
      if (hastaParam) query = query.lte('created_at', hastaParam);
      const { data: lics, error: errLics } = await query;
      if (errLics) throw new BadRequestException(errLics.message);
      const filas = lics || [];
      for (const l of filas) {
        const cod = codigoMpDe(l.id_licitacion);
        if (cod) conCodigo.push({ ...l, codigo_mp_norm: cod });
      }
      if (filas.length < PAGINA) break;
      if (pagina >= 49) break; // 50.000 cotizaciones: varias veces el tamaño real
    }

    // Estado ya conocido: los procesos con estado final no se re-consultan, y
    // los no finales consultados hace poco tampoco.
    const { data: previos, error: errPrev } = await client
      .from('mp_resultados')
      .select('licitacion_id, estado_mp, ganamos, consultado_at')
      .range(0, 49999);
    if (errPrev) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(errPrev.message)
          ? 'Falta aplicar la migración 20260807_mp_resultados.sql en Supabase.'
          : errPrev.message,
      );
    }
    const previoPorId = new Map((previos || []).map((p: any) => [p.licitacion_id, p]));

    /* UNA cotización por proceso de Mercado Público (la original y sus
       versiones comparten ficha). Desempate: la que ya tiene ficha guardada;
       luego la del código exacto; luego la más reciente. */
    const porCodigo = new Map<string, any>();
    const exacta = (l: any) => RE_CODIGO_MP.test(String(l.id_licitacion || '').trim());
    const tieneFicha = (l: any) => previoPorId.has(l.id);
    for (const l of conCodigo) {
      const prev = porCodigo.get(l.codigo_mp_norm);
      if (!prev) { porCodigo.set(l.codigo_mp_norm, l); continue; }
      if (tieneFicha(l) !== tieneFicha(prev)) {
        if (tieneFicha(l)) porCodigo.set(l.codigo_mp_norm, l);
      } else if (exacta(l) !== exacta(prev)) {
        if (exacta(l)) porCodigo.set(l.codigo_mp_norm, l);
      } else if (new Date(l.created_at || 0) > new Date(prev.created_at || 0)) {
        porCodigo.set(l.codigo_mp_norm, l);
      }
    }
    const candidatas = [...porCodigo.values()];
    const FRESCURA_MS = 6 * 3600 * 1000; // 6 horas
    // Más corta en «forzar»: ahí el objetivo ES refrescar lo ya consultado.
    const FRESCURA_FORZAR_MS = 3 * 3600 * 1000; // 3 horas
    const forzar = body?.forzar === true || body?.forzar === 'true';
    const ventana = forzar ? FRESCURA_FORZAR_MS : FRESCURA_MS;

    const pendientes = candidatas
      .filter((l: any) => {
        const prev: any = previoPorId.get(l.id);
        if (!prev) return true; // nunca consultado
        if (!forzar && ESTADOS_FINALES.has(String(prev.estado_mp || ''))) return false;
        return Date.now() - new Date(prev.consultado_at || 0).getTime() > ventana;
      })
      .sort((a: any, b: any) => {
        // Nunca consultados primero; luego los consultados hace más tiempo.
        const pa: any = previoPorId.get(a.id);
        const pb: any = previoPorId.get(b.id);
        if (!pa && pb) return -1;
        if (pa && !pb) return 1;
        if (!pa && !pb) return 0;
        return new Date(pa.consultado_at || 0).getTime() - new Date(pb.consultado_at || 0).getTime();
      });

    return {
      rango: { desde: desdeParam || desde.slice(0, 10), hasta: hastaParam ? hastaParam.slice(0, 10) : null },
      forzar,
      candidatas,
      pendientes,
      previoPorId,
    };
  }

  /* ── Encolar la sincronización (2026-10-21) ──
     Lo que antes hacía `sincronizar` consultando la API dentro de la request:
     ahora deja un trabajo «ficha» por proceso pendiente y el robot
     (MpRobotService, en el worker) los va consultando. La pantalla sigue el
     avance con mp_cola_resumen y refresca con `resultados?desde=`. */
  async encolarSincronizacion(
    body: { desde?: string; hasta?: string; forzar?: boolean | string } | undefined,
    solicitadoPor: string | null,
    opts: { prioridad?: number } = {},
  ) {
    if (!this.ticket) {
      throw new BadRequestException(
        'Falta configurar MP_API_TICKET en el backend. El ticket se solicita gratis en chilecompra.cl/api con Clave Única.',
      );
    }
    const plan = await this.planificar(body || {});
    const items = plan.pendientes.map((l: any) => ({
      tipo: 'ficha' as const,
      clave: l.id,
      prioridad: opts.prioridad ?? 5,
      payload: {
        forzar: plan.forzar,
        lic: {
          id: l.id,
          id_licitacion: l.id_licitacion,
          codigo_mp_norm: l.codigo_mp_norm,
          nombre: l.nombre,
          nombre_entidad: l.nombre_entidad,
          creado_por: l.creado_por,
          total_con_iva: l.total_con_iva,
          total_sin_iva: l.total_sin_iva,
          created_at: l.created_at,
        },
      },
    }));
    const r = await this.cola.encolar(items, { solicitadoPor });
    // Lo que se sincroniza cambia la lista: la caché del panel se descarta.
    this.cacheLista = null;
    this.cacheItems = null;
    this.logger.log(
      `Sincronización encolada por ${solicitadoPor || 'sistema'}: ${r.encolados} proceso(s) (${r.omitidos} ya estaban en cola) · lote ${r.lote}.`,
    );
    return {
      ...r,
      rango: plan.rango,
      forzar: plan.forzar,
      candidatas: plan.candidatas.length,
      pendientes: plan.pendientes.length,
    };
  }

  /* ── Consultar y guardar UN proceso (lo llama el robot) ──
     `lic` es la cotización interna (al menos `id`; si viene sin código se lee
     de la base). Devuelve cuántas fichas guardó (0 o 1) y si el proceso quedó
     en estado final. Los errores de la API se lanzan tal cual: el robot decide
     si reintenta (504, timeout), pausa (cuota) o marca con error. */
  async consultarYGuardar(lic: any) {
    if (!this.ticket) throw new Error('Falta configurar MP_API_TICKET en el backend.');
    const client = this.supabase.getClient();
    let cot: any = lic;
    if (!cot?.id_licitacion) {
      const { data, error } = await client
        .from('licitaciones')
        .select('id, id_licitacion, nombre, nombre_entidad, creado_por, total_con_iva, total_sin_iva, created_at')
        .eq('id', Number(lic?.id))
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { guardada: 0, finalizada: 0, error: 'La cotización ya no existe.' };
      cot = data;
    }
    // El código YA normalizado: es el que entiende la API. Usar el texto
    // crudo de la cotización devolvía 404 en las que traían sufijo.
    const codigo = cot.codigo_mp_norm || codigoMpDe(cot.id_licitacion) || String(cot.id_licitacion || '').trim();
    if (!codigo) return { guardada: 0, finalizada: 0, error: 'La cotización no tiene código de Mercado Público.' };
    const esCompraAgil = /-COT\d{2}$/i.test(codigo);

    // Lo que ya se sabía, para detectar la transición a GANADA.
    const { data: previo } = await client
      .from('mp_resultados')
      .select('ganamos')
      .eq('licitacion_id', cot.id)
      .maybeSingle();

    const fila = esCompraAgil
      ? await this.consultarCompraAgil(codigo, cot)
      : await this.consultarLicitacion(codigo, cot);
    if (!fila) return { guardada: 0, finalizada: 0, codigo };
    const { error: errUp } = await client.from('mp_resultados').upsert([fila], { onConflict: 'licitacion_id' });
    if (errUp) throw new Error(errUp.message);
    const finalizada = fila.estado_mp && ESTADOS_FINALES.has(fila.estado_mp) ? 1 : 0;
    // Transición a GANADA: si el proceso pasó a adjudicado a nuestro favor (y
    // antes no lo estaba), se avisa al vendedor y a los jefes de ventas.
    if (fila.ganamos === true && (previo as any)?.ganamos !== true) {
      await this.notificarAdjudicacion(cot, fila);
    }
    return { guardada: 1, finalizada, codigo, estado_mp: fila.estado_mp, ganamos: fila.ganamos };
  }

  /* ── Aviso de adjudicación ganada (2026-09-03) ──
     Cuando la corrida (nocturna o manual) detecta que un proceso pasó a
     "ganado" (ganamos=true y antes no), avisa al VENDEDOR de la cotización,
     a los JEFES DE VENTAS y a los correos extra configurados, con una
     notificación en la campana (sin correo, a pedido 2026-09-04). Dedupe
     permanente por (usuario, licitación) sobre la tabla notificaciones, así
     un vaivén de estados de la API no repite el aviso. */
  private async notificarAdjudicacion(lic: any, fila: any) {
    try {
      const client = this.supabase.getClient();
      const vendedor = String(lic?.creado_por || '').trim().toLowerCase();
      const { data: jefes } = await client
        .from('profiles')
        .select('email')
        .in('rol', ['jefe_ventas', 'jefe_ventas_especial']);
      // Destinatarios extra fuera de la regla por rol (separados por coma).
      // Default: Jeremías Alarcón (admin, pedido 2026-09-03); la env permite
      // cambiar la lista sin tocar código.
      const extras = (process.env.MP_ADJUDICADA_EXTRA_CORREOS ?? 'jer.consorcio@gmail.com')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const emails = Array.from(new Set(
        [vendedor, ...(jefes || []).map((j: any) => String(j?.email || '').trim().toLowerCase()), ...extras].filter(Boolean),
      ));
      if (!emails.length) return;

      // Dedupe permanente (leídas incluidas): un aviso por usuario y cotización.
      const { data: previas } = await client
        .from('notificaciones')
        .select('user_email, metadata')
        .eq('tipo', 'mp_adjudicada')
        .in('user_email', emails);
      const yaAvisados = new Set(
        (previas || [])
          .filter((n: any) => Number(n?.metadata?.licitacion_id) === Number(lic.id))
          .map((n: any) => String(n?.user_email || '').trim().toLowerCase()),
      );
      const destinatarios = emails.filter((e) => !yaAvisados.has(e));
      if (!destinatarios.length) return;

      const codigo = fila?.codigo_mp || codigoMpDe(lic.id_licitacion) || String(lic.id_licitacion || '');
      const organismo = String(fila?.organismo || lic?.nombre_entidad || '').trim();
      const monto = num(fila?.monto_ganador) ?? num(fila?.monto_nuestro) ?? 0;
      const montoTxt = monto > 0 ? ` por $${Math.round(monto).toLocaleString('es-CL')} neto` : '';
      const idCot = lic.id_licitacion || `#${lic.id}`;
      const mensaje =
        `🏆 ¡Ganamos en Mercado Público! La cotización ${idCot}` +
        `${organismo ? ` (${organismo})` : ''} fue adjudicada a Amsodent${montoTxt}. ` +
        `Continúa el ciclo: OC → guía de despacho → factura.`;

      const filasNotif = destinatarios.map((email) => ({
        user_email: email,
        tipo: 'mp_adjudicada',
        mensaje,
        link: `/detalle/${lic.id}`,
        metadata: {
          licitacion_id: lic.id,
          id_licitacion: lic.id_licitacion || null,
          codigo_mp: codigo,
          estado_mp: fila?.estado_mp || null,
          monto_ganador: monto > 0 ? monto : null,
          vendedor: vendedor || null,
        },
      }));
      const { error: errNotif } = await client.from('notificaciones').insert(filasNotif);
      if (errNotif) throw new Error(errNotif.message);
      this.logger.log(`Adjudicación MP ${codigo} notificada a: ${destinatarios.join(', ')}`);
    } catch (e: any) {
      this.logger.warn(`No se pudo notificar la adjudicación MP de #${lic?.id}: ${e?.message || e}`);
    }
  }

  /* ── Compra Ágil (API v2) ── */
  private async consultarCompraAgil(codigo: string, lic: any) {
    const res = await fetchConTimeout(`${V2_BASE}/v2/compra-agil/${encodeURIComponent(codigo)}`, {
      headers: { ticket: this.ticket },
    });
    const body: any = await res.json().catch(() => null);
    if (res.status === 404) return this.filaSinProceso(codigo, lic, 'compra_agil');
    if (!res.ok || body?.success !== 'OK') {
      const msg = body?.errors?.[0]?.mensaje || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const p = body.payload || {};
    const rutEmpresa = this.rutEmpresa;

    const cotizaciones = (Array.isArray(p.proveedores_cotizando) ? p.proveedores_cotizando : []).map((c: any) => ({
      rut: c.rut_proveedor || null,
      nombre: c.razon_social || null,
      es_emt: c.es_emt === true,
      nuestra: esNuestro(c.rut_proveedor, rutEmpresa),
      seleccionado: fueSeleccionado(c),
      estado_por_comprador: c.estado_por_comprador ?? c?.estado_cotizacion?.glosa ?? null,
      inadmisible: !!c.justificacion_inadmisibilidad,
      justificacion_inadmisibilidad: c.justificacion_inadmisibilidad || null,
      valor_neto: num(c.valor_neto),
      total_impuesto: num(c.total_impuesto),
      monto_despacho: num(c.monto_despacho),
      monto_total: num(c.monto_total),
      fecha: c.fecha_creacion || null,
      productos: (Array.isArray(c.productos_cotizados) ? c.productos_cotizados : []).map((it: any) => ({
        codigo_producto: it.codigo_producto ?? null,
        nombre: it.nombre_producto || it.descripcion || null,
        cantidad: num(it.cantidad),
        precio_unitario: num(it.precio_unitario),
        monto_total: num(it.monto_total_producto),
      })),
    }));

    const nuestra = cotizaciones.find((c: any) => c.nuestra) || null;
    const estadoMp = String(p?.estado?.codigo || '').toLowerCase() || null;
    const haySeleccion = estadoMp === 'proveedor_seleccionado' || estadoMp === 'oc_emitida' || !!p?.orden_compra?.id_orden_compra;

    // Ganador: flag oficial; respaldo por glosa; y patrón observado en la API
    // real: en procesos con proveedor seleccionado, el ÚNICO cotizante con
    // estado_por_comprador no nulo (códigos "1"/"2"/"4" según criterio) es el
    // seleccionado — verificado contra procesos adjudicados nuestros.
    let ganadora = cotizaciones.find((c: any) => c.seleccionado);
    if (!ganadora) {
      ganadora = cotizaciones.find((c: any) => /selec|adjudic|acept|ganad/i.test(String(c.estado_por_comprador || '')));
    }
    if (!ganadora && haySeleccion) {
      const conEstado = cotizaciones.filter(
        (c: any) => c.estado_por_comprador != null && String(c.estado_por_comprador).trim() !== '' && !c.inadmisible,
      );
      if (conEstado.length === 1) ganadora = conEstado[0];
    }

    // Comparación por producto entre nuestra oferta y la ganadora.
    const comparacionItems: any[] = [];
    if (nuestra && ganadora && !ganadora.nuestra) {
      const ganPorCodigo = new Map<string, any>(
        ganadora.productos.map((it: any) => [String(it.codigo_producto), it] as [string, any]),
      );
      for (const mio of nuestra.productos) {
        const suyo = ganPorCodigo.get(String(mio.codigo_producto));
        comparacionItems.push({
          codigo_producto: mio.codigo_producto,
          nombre: mio.nombre || suyo?.nombre || null,
          nuestro_precio: mio.precio_unitario,
          precio_ganador: suyo?.precio_unitario ?? null,
          nuestra_cantidad: mio.cantidad,
          cantidad_ganador: suyo?.cantidad ?? null,
          diferencia:
            mio.precio_unitario != null && suyo?.precio_unitario != null
              ? mio.precio_unitario - suyo.precio_unitario
              : null,
        });
      }
    }

    return {
      licitacion_id: lic.id,
      codigo_mp: codigo,
      tipo: 'compra_agil',
      estado_mp: estadoMp,
      estado_glosa: p?.estado?.glosa || null,
      participamos: cotizaciones.length > 0 ? !!nuestra : null,
      ganamos: haySeleccion ? (ganadora ? !!ganadora.nuestra : (nuestra ? null : false)) : null,
      ganador_rut: ganadora?.rut || null,
      ganador_nombre: ganadora?.nombre || null,
      ganador_es_emt: ganadora ? ganadora.es_emt : null,
      monto_nuestro: nuestra?.monto_total ?? num(lic.total_con_iva),
      monto_ganador: ganadora?.monto_total ?? null,
      total_ofertas: num(p?.resumen?.total_ofertas_recibidas) ?? cotizaciones.length,
      presupuesto_clp: num(p?.presupuesto?.monto_disponible_clp) ?? num(p?.presupuesto?.presupuesto_estimado),
      organismo: p?.institucion?.organismo_comprador || null,
      fecha_cierre: p?.fechas?.fecha_cierre || null,
      // Compra Ágil no publica fecha de adjudicación. Si el proceso ya está
      // resuelto, el último cambio de estado ES la selección del proveedor, así
      // que sirve como aproximación; si sigue abierto, no hay dato que dar.
      fecha_adjudicacion: ESTADOS_ADJUDICADOS.has(String(estadoMp))
        ? (p?.fechas?.fecha_ultimo_cambio || null)
        : null,
      detalle: {
        cotizaciones,
        comparacion_items: comparacionItems,
        productos_solicitados: p?.productos_solicitados || [],
        convocatoria: p?.convocatoria || null,
        motivos: p?.motivos || null,
        oc: p?.orden_compra || null,
      },
      consultado_at: new Date().toISOString(),
    };
  }

  /* ── Licitación (API clásica v1) ── */
  private async consultarLicitacion(codigo: string, lic: any) {
    const url = `${V1_BASE}/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(this.ticket)}`;
    const res = await fetchConTimeout(url);
    const body: any = await res.json().catch(() => null);
    if (res.status === 429) {
      // La v1 devuelve 429 por dos motivos: cuota diaria agotada y «peticiones
      // simultáneas». Solo el primero debe pausar al robot hasta mañana.
      throw new Error(
        /simult/i.test(String(body?.Mensaje || ''))
          ? 'Mercado Público rechazó la consulta por peticiones simultáneas'
          : 'Se agotó la cuota diaria del ticket de Mercado Público',
      );
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const det = body?.Listado?.[0];
    if (!det) return this.filaSinProceso(codigo, lic, 'licitacion');

    // CodigoEstado: 5 Publicada · 6 Cerrada · 7 Desierta · 8 Adjudicada · 18 Revocada · 19 Suspendida
    const cod = Number(det.CodigoEstado);
    const estadoMp =
      cod === 8 ? 'adjudicada'
      : cod === 7 ? 'desierta'
      : cod === 6 ? 'cerrada'
      : cod === 5 ? 'publicada'
      : cod === 18 ? 'revocada'
      : cod === 19 ? 'suspendida'
      : String(det.Estado || '').toLowerCase() || null;

    const items = det?.Items?.Listado || [];
    const rutEmpresa = this.rutEmpresa;
    const porProveedor = new Map<string, { rut: string; nombre: string; monto: number; items: number }>();
    const comparacionItems: any[] = [];
    let montoNuestroAdj = 0;

    for (const it of items) {
      const adj = it?.Adjudicacion;
      if (!adj?.RutProveedor) continue;
      const rut = normRut(adj.RutProveedor);
      const cantidad = num(adj.CantidadAdjudicada) ?? num(it.Cantidad) ?? 0;
      const monto = (num(adj.MontoUnitario) || 0) * (cantidad || 0);
      const prev = porProveedor.get(rut) || { rut: adj.RutProveedor, nombre: adj.NombreProveedor || '', monto: 0, items: 0 };
      prev.monto += monto;
      prev.items += 1;
      porProveedor.set(rut, prev);
      if (rut === rutEmpresa) montoNuestroAdj += monto;
      comparacionItems.push({
        codigo_producto: it.CodigoProducto ?? it.Correlativo ?? null,
        nombre: it.NombreProducto || it.Descripcion || null,
        cantidad_ganador: cantidad,
        precio_ganador: num(adj.MontoUnitario),
        ganador_rut: adj.RutProveedor,
        ganador_nombre: adj.NombreProveedor || null,
        ganado_por_nosotros: rut === rutEmpresa,
      });
    }

    const adjudicados = [...porProveedor.values()].sort((a, b) => b.monto - a.monto);
    const principal = adjudicados[0] || null;
    const ganamosAlgo = adjudicados.some((a) => normRut(a.rut) === rutEmpresa);
    const esAdjudicada = cod === 8;

    return {
      licitacion_id: lic.id,
      codigo_mp: codigo,
      tipo: 'licitacion',
      estado_mp: estadoMp,
      estado_glosa: det.Estado || null,
      participamos: null, // la API v1 no expone a los oferentes no adjudicados
      ganamos: esAdjudicada ? ganamosAlgo : null,
      ganador_rut: principal?.rut || null,
      ganador_nombre: principal?.nombre || null,
      ganador_es_emt: null,
      monto_nuestro: num(lic.total_con_iva),
      monto_ganador: esAdjudicada ? adjudicados.reduce((s, a) => s + a.monto, 0) : null,
      total_ofertas: num(det.CantidadOfertas) ?? null,
      presupuesto_clp: num(det.MontoEstimado),
      organismo: det?.Comprador?.NombreOrganismo || null,
      fecha_cierre: det?.Fechas?.FechaCierre || null,
      // Dato oficial. Se prefiere la fecha real de adjudicación; si el proceso
      // todavía no la trae, la estimada sirve de referencia (queda claro en el
      // panel porque el estado aún no es "adjudicada").
      fecha_adjudicacion:
        det?.Fechas?.FechaAdjudicacion ||
        det?.Adjudicacion?.Fecha ||
        det?.Fechas?.FechaEstimadaAdjudicacion ||
        null,
      detalle: {
        adjudicados_por_proveedor: adjudicados,
        comparacion_items: comparacionItems,
        monto_nuestro_adjudicado: montoNuestroAdj,
        nota: 'La API de licitaciones solo expone la adjudicación (ganadores por ítem); las demás ofertas no son públicas por API.',
      },
      consultado_at: new Date().toISOString(),
    };
  }

  // El código no existe en la API (proceso muy antiguo o ID no MP real).
  private filaSinProceso(codigo: string, lic: any, tipo: string) {
    return {
      licitacion_id: lic.id,
      codigo_mp: codigo,
      tipo,
      estado_mp: 'no_encontrada',
      estado_glosa: 'No encontrada en Mercado Público',
      participamos: null,
      ganamos: null,
      ganador_rut: null,
      ganador_nombre: null,
      ganador_es_emt: null,
      monto_nuestro: num(lic.total_con_iva),
      monto_ganador: null,
      total_ofertas: null,
      presupuesto_clp: null,
      organismo: null,
      fecha_cierre: null,
      fecha_adjudicacion: null,
      detalle: null,
      consultado_at: new Date().toISOString(),
    };
  }
}
