import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

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

/* Cuántas fichas se piden a la vez. Medido el 2026-08-11 contra la API real,
   sobre procesos pendientes de verdad:
     ·  4 en paralelo →  1 de  4 responde  ·  ~2 fichas/min
     · 12 en paralelo →  7 de 12 responden · ~14 fichas/min
     · 24 en paralelo →  0 de 24 responden · la API se cae entera
   O sea que el techo está entre 12 y 24, y por debajo de 12 se desaprovecha.
   Los 504 NO los provoca nuestra concurrencia (a 4 fallaba el 75% y a 12 el
   42%): son intermitentes del lado de ellos. Se deja ajustable por si el
   comportamiento de la API cambia, que ya pasó una vez. */
const CONCURRENCIA_SYNC = Math.max(1, Math.min(24, Number(process.env.MP_CONCURRENCIA) || 12));

/* Procesos cuya consulta falló hace poco, para no reintentarlos dentro de la
   misma corrida. Vive en memoria a propósito: es una espera, no un dato. Se
   pierde al reiniciar el backend, que es exactamente lo que se quiere. */
const fallosRecientes = new Map<number, number>();

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
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

@Injectable()
export class MercadopublicoService {
  private readonly logger = new Logger(MercadopublicoService.name);

  constructor(private supabase: SupabaseService) {}

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
  async resultados(desde?: string) {
    const client = this.supabase.getClient();
    // Se descarta un `desde` inválido en vez de fallar: peor que un refresco
    // caro es un refresco que devuelve un error a mitad de sincronización.
    const corte = desde && !Number.isNaN(Date.parse(desde)) ? new Date(desde).toISOString() : null;
    let query = client
      .from('mp_resultados')
      .select('*')
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
    for (let i = 0; i < ids.length; i += TANDA_IDS) {
      const { data: lics, error: errLics } = await client
        .from('licitaciones')
        .select('id, id_licitacion, nombre, nombre_entidad, estado, total_con_iva, total_sin_iva, vendedor_nombre, creado_por, fecha, created_at')
        .in('id', ids.slice(i, i + TANDA_IDS));
      if (errLics) throw new BadRequestException(errLics.message);
      for (const l of lics || []) porId.set(l.id, l);
    }

    return lista.map((r: any) => ({ ...r, interna: porId.get(r.licitacion_id) || null }));
  }

  /* ── Sincronización: consulta la API para los procesos pendientes ──
     Rango configurable (desde/hasta, fecha de creación de la cotización
     interna, formato YYYY-MM-DD); sin rango parte del día 1 del mes anterior. */
  async sincronizar(body?: { desde?: string; hasta?: string; lote?: number; forzar?: boolean | string }) {
    if (!this.ticket) {
      throw new BadRequestException(
        'Falta configurar MP_API_TICKET en el backend. El ticket se solicita gratis en chilecompra.cl/api con Clave Única.',
      );
    }
    const client = this.supabase.getClient();

    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const desdeParam = reFecha.test(String(body?.desde || '')) ? `${body!.desde}T00:00:00` : null;
    const hastaParam = reFecha.test(String(body?.hasta || '')) ? `${body!.hasta}T23:59:59.999` : null;
    const desde = desdeParam || primerDiaMesAnterior();

    /* Cotizaciones internas candidatas: las que llevan código con formato de
       Mercado Público.

       Se pagina. Antes era un `range(0, 2000)` de una sola pasada, y con 3.999
       cotizaciones en la tabla eso dejaba fuera a las 1.999 más antiguas SIN
       AVISAR: de las 3.337 con código de Mercado Público, la sincronización
       solo llegaba a ver 1.576. Las otras 1.761 no eran candidatas, así que no
       se consultaban nunca y jamás iban a aparecer en el panel. El recorte no
       lo hacía la ventana de fechas —todas caen dentro de los 240 días— sino
       el tope de filas, que en la práctica movía el corte real a la fecha de
       la cotización número 2.001. */
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
      // Tope de seguridad: 50.000 cotizaciones es varias veces el tamaño real.
      if (pagina >= 49) break;
    }

    // Estado ya conocido: los procesos con estado final no se re-consultan, y
    // los no finales consultados hace poco tampoco (evita quemar cuota
    // re-preguntando lo mismo en tandas seguidas de la misma sincronización).
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

    /* UNA cotización por proceso de Mercado Público.

       Al aceptar los códigos con sufijo entran varias cotizaciones del mismo
       proceso —la original y sus versiones—, y en Mercado Público hay una sola
       ficha. Sin este paso se crearía una fila por versión: medido sobre el
       histórico, 303 fichas duplicadas que inflarían ganadas, perdidas y montos.
       (Y ya había 36 duplicados de antes, de procesos escritos con el mismo
       código exacto en dos cotizaciones distintas.)

       Criterio de desempate, en orden:
         1. La que YA tiene ficha guardada. Es lo primero por continuidad: si se
            eligiera otra, la ficha vieja quedaría huérfana en `mp_resultados`
            —que devuelve todo lo guardado— y el proceso aparecería DOS veces en
            el panel. Medido: 26 casos.
         2. La que trae el código exacto, que es la cotización original.
         3. La más reciente, que es la versión vigente. */
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
    // Tiene que superar la duración de una pasada completa (~1 h) para que la
    // corrida no se muerda la cola.
    const FRESCURA_FORZAR_MS = 3 * 3600 * 1000; // 3 horas

    // `forzar`: re-consulta también los procesos en estado final. Normalmente
    // no tiene sentido (ya no cambian) y solo quema cuota, pero es la ÚNICA
    // forma de rellenar campos nuevos en filas viejas: sin esto, un dato que se
    // agrega después queda para siempre vacío en los procesos ya cerrados.
    const forzar = body?.forzar === true || body?.forzar === 'true';

    // Purga de la memoria de fallos: lo que ya cumplió la espera vuelve a la cola.
    for (const [id, ts] of fallosRecientes) {
      if (Date.now() - ts > FRESCURA_MS) fallosRecientes.delete(id);
    }

    /* `forzar` levanta el filtro de estados finales, pero NO el de frescura.
       Si lo levantara, `pendientesTotales` devolvería SIEMPRE el catálogo
       entero: un proceso recién consultado seguiría contando como pendiente,
       `restantes` no bajaría nunca y no habría forma de saber cuándo terminó
       la pasada. Con la ventana puesta, lo consultado sale de la cola y la
       corrida converge sola — que es lo que necesita el proceso automático
       para no quedarse dando vueltas. La ventana de forzar es más corta que
       la normal porque su objetivo es justamente refrescar lo ya cerrado. */
    const ventana = forzar ? FRESCURA_FORZAR_MS : FRESCURA_MS;

    /* Un fallo NO saca el proceso de la cola: lo manda al final.

       El problema que había que resolver es de ORDEN, no de reintento. Un
       proceso que falla no escribe fila, así que sigue contando como «nunca
       consultado», y como esos van primero, las mismas fichas rotas volvían a
       encabezar cada tanda y las demás no se alcanzaban nunca.

       La primera solución fue excluirlas 6 horas, y con la API en un mal día
       —medido: 3 de 12 responden en horario hábil— eso vaciaba la cola entera:
       `pendientes` quedaba en 0, la pasada se daba por terminada y avisaba
       «completa» con miles sin consultar. Ahora solo se saltan durante 2
       minutos, lo justo para no repetirlas dentro de la misma oleada, y luego
       vuelven detrás de todo lo que no se ha intentado. Así una pasada larga
       recorre primero lo nuevo y después reintenta lo fallido, tantas veces
       como haga falta, en vez de rendirse. */
    const REINTENTO_MS = 2 * 60 * 1000; // 2 minutos

    const pendientesTotales = candidatas
      .filter((l: any) => {
        const fallo = fallosRecientes.get(l.id);
        if (fallo && Date.now() - fallo < REINTENTO_MS) return false;
        const prev: any = previoPorId.get(l.id);
        if (!prev) return true; // nunca consultado
        if (!forzar && ESTADOS_FINALES.has(String(prev.estado_mp || ''))) return false;
        return Date.now() - new Date(prev.consultado_at || 0).getTime() > ventana;
      })
      .sort((a: any, b: any) => {
        // 1º lo que no ha fallado en esta corrida; entre fallidos, el que
        // falló hace más rato (más probable que la API ya se haya recuperado).
        const fa = fallosRecientes.get(a.id) || 0;
        const fb = fallosRecientes.get(b.id) || 0;
        if (!!fa !== !!fb) return fa ? 1 : -1;
        if (fa && fb) return fa - fb;
        // 2º nunca consultados; luego los consultados hace más tiempo.
        const pa: any = previoPorId.get(a.id);
        const pb: any = previoPorId.get(b.id);
        if (!pa && pb) return -1;
        if (pa && !pb) return 1;
        if (!pa && !pb) return 0;
        return new Date(pa.consultado_at || 0).getTime() - new Date(pb.consultado_at || 0).getTime();
      });

    const lote = Math.max(1, Math.min(MAX_CONSULTAS_POR_SYNC, Number(body?.lote) || MAX_CONSULTAS_POR_SYNC));
    const pendientes = pendientesTotales.slice(0, lote);

    let consultadas = 0;
    let actualizadas = 0;
    let finalizadas = 0;
    let cuotaAgotada = false;
    const errores: string[] = [];

    for (let i = 0; i < pendientes.length && !cuotaAgotada; i += CONCURRENCIA_SYNC) {
      const tanda = pendientes.slice(i, i + CONCURRENCIA_SYNC);
      await Promise.all(tanda.map(async (lic: any) => {
        // El código YA normalizado: es el que entiende la API. Usar el texto
        // crudo de la cotización devolvía 404 en las que traían sufijo.
        const codigo = lic.codigo_mp_norm || String(lic.id_licitacion).trim();
        const esCompraAgil = /-COT\d{2}$/i.test(codigo);
        try {
          consultadas += 1;
          const fila = esCompraAgil
            ? await this.consultarCompraAgil(codigo, lic)
            : await this.consultarLicitacion(codigo, lic);
          if (!fila) return;
          const { error: errUp } = await client
            .from('mp_resultados')
            .upsert([fila], { onConflict: 'licitacion_id' });
          if (errUp) throw new Error(errUp.message);
          actualizadas += 1;
          if (fila.estado_mp && ESTADOS_FINALES.has(fila.estado_mp)) finalizadas += 1;
          // Transición a GANADA: si el proceso pasó a adjudicado a nuestro
          // favor (y antes no lo estaba), se avisa al vendedor y a los jefes
          // de ventas. Nunca corta la sincronización (maneja sus errores).
          const previo: any = previoPorId.get(lic.id);
          if (fila.ganamos === true && previo?.ganamos !== true) {
            await this.notificarAdjudicacion(lic, fila);
          }
        } catch (e: any) {
          const msg = String(e?.message || e);
          errores.push(`${codigo}: ${msg.slice(0, 140)}`);
          // Cuota diaria agotada: no tiene sentido seguir consultando hoy.
          if (/429|límite de solicitudes/i.test(msg)) {
            cuotaAgotada = true;
            return;
          }
          // Se anota el intento fallido. Sin esto la sincronización no
          // avanzaba: un proceso que falla no escribe fila, sigue contando como
          // «nunca consultado» y el orden los pone PRIMERO, así que las mismas
          // fichas rotas volvían a encabezar todas las tandas y las demás no se
          // alcanzaban nunca. Se anota en memoria y no en `mp_resultados`
          // porque un fallo no es un resultado: escribirlo pisaría la ficha
          // buena de un proceso ya sincronizado que hoy dio 504, y ensuciaría
          // el panel con filas que no son procesos reales.
          fallosRecientes.set(lic.id, Date.now());
        }
      }));
    }

    return {
      rango: { desde: desdeParam || desde.slice(0, 10), hasta: hastaParam ? hastaParam.slice(0, 10) : null },
      candidatas: candidatas.length,
      pendientes: pendientes.length,
      // Procesos que quedaron SIN consultar en esta pasada (tope por cuota).
      restantes: Math.max(0, pendientesTotales.length - consultadas),
      consultadas,
      actualizadas,
      finalizadas,
      cuota_agotada: cuotaAgotada,
      errores,
    };
  }

  /* ── Aviso de adjudicación ganada (2026-09-03) ──
     Cuando la corrida (nocturna o manual) detecta que un proceso pasó a
     "ganado" (ganamos=true y antes no), avisa al VENDEDOR de la cotización y
     a los JEFES DE VENTAS con una notificación en la campana (sin correo, a
     pedido 2026-09-04). Dedupe permanente por (usuario, licitación) sobre la
     tabla notificaciones, así un vaivén de estados de la API no repite el
     aviso. */
  private async notificarAdjudicacion(lic: any, fila: any) {
    try {
      const client = this.supabase.getClient();
      const vendedor = String(lic?.creado_por || '').trim().toLowerCase();
      const { data: jefes } = await client
        .from('profiles')
        .select('email')
        .in('rol', ['jefe_ventas', 'jefe_ventas_especial']);
      const emails = Array.from(new Set(
        [vendedor, ...(jefes || []).map((j: any) => String(j?.email || '').trim().toLowerCase())].filter(Boolean),
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
      seleccionado: c?.seleccion?.proveedor_seleccionado === true,
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
