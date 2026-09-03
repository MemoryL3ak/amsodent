import { useEffect, useMemo, useRef, useState } from "react";
import {
  Trophy, TrendingDown, RefreshCw, Search, ChevronDown, ChevronRight,
  Target, Percent, AlertTriangle, KeyRound, Crown, Building2, Scale,
  ArrowUp, ArrowDown, ArrowUpDown, Download, X, Square, CalendarRange,
  ArrowLeftRight,
} from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import { SunflowerIcon } from "../components/DamarIAWidget";

/* ============================================================
   Análisis Mercado Público — nuestras postulaciones vs la oferta
   GANADORA de cada proceso (Compra Ágil y Licitaciones), con los
   datos oficiales de las APIs de Mercado Público sincronizados por
   el backend (mp_resultados).
   ─ KPIs: tasa de éxito, monto ganado, oportunidad perdida, brechas.
   ─ Dona resultado global · barras de brechas · ranking competidores.
   ─ Tabla por proceso, expandible: todas las cotizaciones del
     proceso + comparación producto a producto contra el ganador.
============================================================ */

const fmt$ = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `$${Math.round(Number(v)).toLocaleString("es-CL")}`);
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtFecha = (iso) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

/* Un "AAAA-MM-DD" suelto se muestra dando vuelta las partes, sin pasar por
   `new Date`: eso lo interpretaría como medianoche UTC y en Chile (UTC-4/-3)
   restaría un día, así que "2026-08-01" se leería "31-07-2026". */
const diaLegible = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd || "");
};

/* Tiempo restante en palabras. Se redondea a propósito: es una estimación que
   se recalcula sola con el ritmo real de la corrida, no un cronómetro. */
function restanteAprox(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const seg = Math.round(ms / 1000);
  if (seg < 60) return "menos de 1 min";
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Clasificación de cada proceso para el panel.
function clasificar(r) {
  if (r.ganamos === true) return "ganada";
  if (r.ganamos === false && r.participamos === false) return "sin_participar";
  if (r.ganamos === false) return "perdida";
  if (["desierta", "cancelada", "revocada", "suspendida"].includes(r.estado_mp)) return "sin_efecto";
  if (r.estado_mp === "no_encontrada") return "no_encontrada";
  return "en_curso";
}

const CLASES = {
  ganada:         { label: "Ganada",          color: "#15803d", bg: "#dcfce7" },
  perdida:        { label: "Perdida",         color: "#b91c1c", bg: "#fee2e2" },
  en_curso:       { label: "En curso",        color: "#b45309", bg: "#fef3c7" },
  sin_efecto:     { label: "Sin efecto",      color: "#475569", bg: "#e2e8f0" },
  sin_participar: { label: "No participamos", color: "#6d28d9", bg: "#ede9fe" },
  no_encontrada:  { label: "No encontrada",   color: "#64748b", bg: "#f1f5f9" },
};

function brechaPct(r) {
  const mio = Number(r.monto_nuestro);
  const gan = Number(r.monto_ganador);
  if (!Number.isFinite(mio) || !Number.isFinite(gan) || gan <= 0) return null;
  return ((mio - gan) / gan) * 100;
}

/* Monto que EFECTIVAMENTE ganamos en un proceso. `monto_nuestro` es nuestra
   OFERTA completa, no lo adjudicado: en licitaciones por línea se puede ganar
   solo una parte (medido: 4329-4-LE26, oferta $2.463.908, acta $2.157.662) y
   en Compra Ágil el monto seleccionado puede diferir de la cotización interna
   (418-1062-COT26: oferta $2.223.713, seleccionado $2.486.686 = OC exacta).
   El dato fino viene del sync:
   · licitación: detalle.monto_nuestro_adjudicado (los ítems adjudicados a
     NUESTRO rut en el acta). El acta viene en NETO —verificado contra las OC:
     acta × 1,19 = OC bruta al peso en 1057390-34, 1979-112 y 1660-89— así que
     se lleva a bruto para sumar con el resto del panel;
   · compra ágil: monto_ganador (se adjudica completa y la seleccionada es la
     nuestra; ya viene en bruto y calza al peso con la orden de compra).
   Fichas viejas sin esos datos caen a monto_nuestro, que era el valor usado. */
function montoGanadoDe(f) {
  const adj = Number(f?.detalle?.monto_nuestro_adjudicado);
  if (Number.isFinite(adj) && adj > 0) return Math.round(adj * 1.19);
  if (f.tipo === "compra_agil") {
    const g = Number(f.monto_ganador);
    if (Number.isFinite(g) && g > 0) return g;
  }
  return Number(f.monto_nuestro) || 0;
}

/* Convenios de suministro: el acta adjudica la demanda ESTIMADA de todo el
   período —4635-4-LR26 son 24 meses del Hospital de Carabineros, $74,5M— y la
   venta real llega en OC durante la vigencia ($6,1M al 13-08). Sumarlos como
   ganado del mes reventaba el acumulado: julio decía $104,5M cuando lo firme
   eran $30,0M. Van aparte en el KPI, no mezclados. Se detectan por el nombre
   del proceso o por la sigla LR (gran cuantía, el formato típico de estos
   contratos marco). */
function esConvenioSuministro(f) {
  if (f.tipo === "compra_agil") return false;
  const nombre = String(f?.interna?.nombre || "").toLowerCase();
  if (/suministro|convenio/.test(nombre)) return true;
  return /-lr\d{2}$/i.test(String(f?.codigo_mp || "").trim());
}

/* Código MP normalizado de una cotización interna. El patrón es el mismo que
   usa el backend para detectar candidatas (mercadopublico.service.ts):
   "4967-661-COT26", "1057390-34-LE26"… Las re-cotizaciones del mismo proceso
   se guardan con sufijo ("580075-78-COT26-2") y la OC suele quedar en esa
   copia: sin quitar el sufijo, el cruce con Indicadores las daba por "fuera
   de Mercado Público" y a la ficha real la dejaba "sin OC". */
function codigoMpDe(id) {
  const c = String(id || "").trim().toUpperCase();
  const m = /^(\d{1,10}-\d{1,10}-[A-Z]{1,3}\d{2})(?:-\d+)?$/.exec(c);
  return m ? m[1] : null;
}

/* Botones de sincronización manual ocultos (pedido 2026-08-27): las fichas se
   actualizan con la corrida automática del backend. true = vuelven los botones
   «Sincronizar con Mercado Público» y «Forzar». */
const MOSTRAR_SYNC = false;

export default function AnalisisMercadoPublico() {
  const [estadoApi, setEstadoApi] = useState(null);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [progresoSync, setProgresoSync] = useState(null); // { hechas, restantes, etaMs, transcurrido }
  const [toast, setToast] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroClase, setFiltroClase] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  // Filtro de la TABLA por fecha de adjudicación. Es distinto del rango de
  // arriba, que solo define qué cotizaciones se consultan contra la API.
  /* El período se mide SIEMPRE por fecha de adjudicación.

     Hubo antes dos rangos sueltos —uno por fecha de nuestra cotización, otro
     por adjudicación— y cada uno daba un número distinto para el mismo mes sin
     que se viera por qué: 6 ganadas por creación, 13 por adjudicación, 5
     cruzando ambos. Se unificaron en un solo rango con un selector de criterio
     (cierre / adjudicación / nuestra cotización), y el selector se quitó el
     2026-08-12 por decisión del equipo: en la práctica siempre se mira por
     adjudicación, que es cuando el resultado es un hecho, y tener la opción
     abierta solo reabría la duda de qué estaba midiendo cada cifra.

     Consecuencia asumida: lo que aún no se adjudica no tiene esta fecha, así
     que al poner un rango desaparece —son ~380 procesos, casi todo lo que está
     en curso—. Se avisa en pantalla para que no parezca pérdida de datos. */
  const fechaPeriodo = (f) => f.fecha_adjudicacion;
  const [expandida, setExpandida] = useState(null);
  const [donaPorMonto, setDonaPorMonto] = useState(false);
  // Orden de la tabla: por defecto las adjudicaciones más recientes primero.
  const [orden, setOrden] = useState({ campo: "adjudicacion", dir: "desc" });
  // Rango de cotizaciones internas a sincronizar
  // (vacío = desde el día 1 del mes anterior).
  const [syncDesde, setSyncDesde] = useState("");
  const [syncHasta, setSyncHasta] = useState("");

  /* Instante de la ficha más reciente que ya tenemos en pantalla. Es el corte
     del refresco incremental, y se toma de los DATOS y no del reloj del
     navegador a propósito: `consultado_at` lo escribe el servidor, así que un
     desfase de reloj de un par de minutos haría perder fichas (corte
     adelantado) o traerlas repetidas (corte atrasado). */
  const corteRef = useRef(null);

  function maxConsultado(filas) {
    let max = 0;
    for (const r of filas) {
      const t = Date.parse(r?.consultado_at || "");
      if (t && t > max) max = t;
    }
    return max ? new Date(max).toISOString() : null;
  }

  async function cargarResultados() {
    const res = await api.get("/mercado-publico/resultados");
    const filas = Array.isArray(res) ? res : [];
    setResultados(filas);
    corteRef.current = maxConsultado(filas);
  }

  /* Refresco INCREMENTAL entre tandas: pide solo las fichas consultadas después
     del corte y las mezcla con lo que ya está en pantalla.

     Por qué existe: la carga completa del panel pesa 6 MB hoy y unos 24 MB
     proyectados con el catálogo entero (3.337 procesos), así que pedirla entre
     tandas era carísimo y solo se hacía cada 5 tandas — o sea, una vez cada
     ~4 minutos. Ese era el motivo de que la barra avanzara pero los
     indicadores y la tabla se quedaran congelados. El delta de una tanda son
     12 fichas, unos 90 KB: ya se puede refrescar en cada una. */
  async function refrescarNuevos() {
    if (!corteRef.current) { await cargarResultados(); return; }
    const res = await api.get(`/mercado-publico/resultados?desde=${encodeURIComponent(corteRef.current)}`);
    const nuevas = Array.isArray(res) ? res : [];
    if (!nuevas.length) return;
    corteRef.current = maxConsultado(nuevas) || corteRef.current;
    setResultados((prev) => {
      // Por `licitacion_id`: una ficha re-consultada PISA a la anterior (es lo
      // que hace «Forzar»), y una nunca vista se suma.
      const porId = new Map(prev.map((r) => [r.licitacion_id, r]));
      for (const r of nuevas) porId.set(r.licitacion_id, r);
      return [...porId.values()].sort(
        (a, b) => Date.parse(b?.consultado_at || 0) - Date.parse(a?.consultado_at || 0),
      );
    });
  }

  async function cargar() {
    setLoading(true);
    try {
      const est = await api.get("/mercado-publico/estado");
      setEstadoApi(est);
      await cargarResultados();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "Error cargando el análisis." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []);

  // Sincronización INCREMENTAL: tandas de 8 procesos en loop, refrescando la
  // tabla tras cada tanda — los resultados aparecen en vivo, sin recargar.
  // `forzar` re-consulta también los procesos ya resueltos. Se usa para
  // rellenar datos que se agregaron después (la fecha de adjudicación, por
  // ejemplo): sin esto esos procesos nunca se vuelven a preguntar y el campo
  // queda vacío para siempre. Gasta cuota de la API, así que es a pedido.
  // Detener la sincronización. Va en refs y no en estado porque el bucle de
  // abajo lo lee entre tandas: con `useState` leería el valor congelado del
  // render en que arrancó y nunca se enteraría del clic.
  const detenerRef = useRef(false);
  const abortRef = useRef(null);
  // El ref manda el bucle, pero además hace falta ESTADO para que el botón
  // reaccione al clic: un ref no re-renderiza y el botón se quedaría igual.
  const [deteniendo, setDeteniendo] = useState(false);

  function detenerSync() {
    detenerRef.current = true;
    setDeteniendo(true);
    // Aborta también la tanda en vuelo: sin esto habría que esperar hasta
    // 30 s a que Mercado Público conteste antes de que el botón hiciera algo.
    abortRef.current?.abort();
  }

  async function sincronizar(forzar = false) {
    setSincronizando(true);
    setProgresoSync({ hechas: 0, guardadas: 0, restantes: null, etaMs: null, transcurrido: 0 });
    detenerRef.current = false;
    setDeteniendo(false);
    const inicio = Date.now();
    let hechas = 0;
    let guardadas = 0;
    let finalizadas = 0;
    let erroresTotal = 0;
    let cuotaAgotada = false;
    let detenida = false;
    // Tandas seguidas sin guardar NADA. Es la señal de que la API se cayó:
    // los intentos siguen, la barra avanza, pero no llega ni una ficha.
    let secas = 0;
    let apiCaida = false;
    let ultimasRestantes = 0;
    try {
      // El lote calza con el pool del backend: una tanda es UNA oleada de
      // consultas paralelas (~30 s), en vez de encadenar varias dentro de la
      // misma request y arriesgar el corte del proxy.
      const LOTE = 12;
      /* 300 × 12 = 3.600 procesos, por encima de las 3.348 cotizaciones con
         código de Mercado Público que hay hoy: una sola pasada alcanza a
         recorrer TODO el histórico sin volver a pulsar el botón. Estaba en 150
         (1.800), calculado cuando el panel solo cubría el mes en curso; para
         una puesta al día desde febrero —2.402 pendientes— se habría cortado a
         mitad de camino. Es solo un tope de seguridad: el bucle termina solo
         cuando no quedan pendientes. */
      const MAX_TANDAS = 300;
      for (let i = 0; i < MAX_TANDAS; i++) {
        if (detenerRef.current) { detenida = true; break; }
        abortRef.current = new AbortController();
        const r = await api.post("/mercado-publico/sincronizar", {
          desde: syncDesde || undefined,
          hasta: syncHasta || undefined,
          lote: LOTE,
          forzar,
        }, { signal: abortRef.current.signal });
        hechas += r.consultadas || 0;
        // `consultadas` cuenta INTENTOS —el backend lo suma antes de llamar a
        // la API—, mientras que `actualizadas` cuenta fichas realmente
        // guardadas. Se muestran las dos: cuando Mercado Público está lento y
        // devuelve 504, la barra avanza igual y sin este dato parecería que se
        // guardó algo que nunca llegó.
        guardadas += r.actualizadas || 0;
        finalizadas += r.finalizadas || 0;
        erroresTotal += r.errores?.length || 0;
        cuotaAgotada = !!r.cuota_agotada;
        const restantes = r.restantes ?? 0;
        // Un fallo ya no saca el proceso de la cola, solo lo manda al final, así
        // que el avance REAL es lo guardado y con eso se estima lo que falta.
        // Estimar con los intentos daría un tiempo optimista y falso en cuanto
        // la API empieza a devolver 504.
        secas = r.actualizadas ? 0 : secas + 1;
        ultimasRestantes = restantes;
        const transcurrido = Date.now() - inicio;
        /* Hace falta una muestra mínima para estimar. Con 1 ficha guardada en
           3 minutos la regla de tres daba «quedan 11 h 26 min», una cifra tan
           precisa como inventada: basta que la siguiente tanda traiga 8 fichas
           para que pase a 40 minutos. Hasta las 10 guardadas se muestra
           «calculando» en vez de un número que asusta y no significa nada. */
        const MUESTRA_MINIMA = 10;
        const etaMs = guardadas >= MUESTRA_MINIMA ? (transcurrido / guardadas) * restantes : null;
        setProgresoSync({ hechas, guardadas, restantes, etaMs, transcurrido });
        // Refresco en CADA tanda: al ser incremental cuesta ~90 KB, así que los
        // indicadores y la tabla se mueven cada ~45 s en vez de cada 4 minutos.
        await refrescarNuevos();
        if (cuotaAgotada || !r.restantes || !r.consultadas) break;
        /* 5 tandas seguidas = 60 intentos sin una sola ficha guardada. Antes se
           reintentaba en vano hasta agotar el tope; ahora se corta y se dice
           que fue la API, en vez de anunciar «completa» dejando miles fuera. */
        if (secas >= 5) { apiCaida = true; break; }
      }
      await refrescarNuevos();
      const partes = [`${guardadas} ficha${guardadas === 1 ? "" : "s"} actualizada${guardadas === 1 ? "" : "s"}`];
      // Solo se menciona el total intentado cuando NO coincide con lo guardado:
      // si coincide, repetir el mismo número dos veces confunde.
      if (hechas !== guardadas) partes.push(`de ${hechas} consultadas`);
      if (finalizadas) partes.push(`${finalizadas} con resultado final`);
      if (cuotaAgotada) partes.push("cuota diaria de la API agotada, el resto queda para mañana");
      if (erroresTotal) partes.push(`${erroresTotal} con error`);
      /* Tres finales distintos, y hay que decir cuál fue: antes cualquiera de
         ellos anunciaba «completa», así que rendirse porque la API no responde
         se leía igual que terminar el trabajo. */
      setToast({
        type: detenida || apiCaida ? "info" : erroresTotal || cuotaAgotada ? "info" : "success",
        message: detenida
          ? `Sincronización detenida: ${partes.join(" · ")}. Lo consultado quedó guardado.`
          : apiCaida
          ? `Mercado Público no está respondiendo: ${partes.join(" · ")}. Quedan ${ultimasRestantes} por consultar; vuelve a intentarlo más tarde o espera la corrida automática de las 23:00.`
          : `Sincronización completa: ${partes.join(" · ")}.`,
      });
    } catch (e) {
      // Abortar la request en vuelo NO es un error: es el usuario deteniendo.
      if (detenerRef.current || e?.name === "AbortError") {
        await refrescarNuevos();
        setToast({
          type: "info",
          message: `Sincronización detenida: ${guardadas} ficha${guardadas === 1 ? "" : "s"} actualizada${guardadas === 1 ? "" : "s"}. Lo consultado quedó guardado.`,
        });
      } else {
        setToast({ type: "error", message: e?.message || "No se pudo sincronizar." });
      }
    } finally {
      abortRef.current = null;
      detenerRef.current = false;
      setDeteniendo(false);
      setSincronizando(false);
      setProgresoSync(null);
    }
  }

  /* ── Métricas ── */
  /* Una fila por PROCESO de Mercado Público, no por cotización.

     Cuando el mismo proceso se cotiza dos veces —la original y una versión
     corregida— quedan dos cotizaciones distintas apuntando al mismo código, y
     cada una guardó su ficha. Medido: 26 procesos duplicados, contándose doble
     en todas las cifras del panel. Se queda la ficha consultada más
     recientemente, que es la que trae el estado más fresco. */
  const filas = useMemo(() => {
    const porCodigo = new Map();
    for (const r of resultados) {
      // Sin código no hay con qué agrupar: se deja tal cual, con su propia clave.
      const clave = r.codigo_mp || `sin-codigo:${r.licitacion_id}`;
      const prev = porCodigo.get(clave);
      if (!prev || Date.parse(r.consultado_at || 0) > Date.parse(prev.consultado_at || 0)) {
        porCodigo.set(clave, r);
      }
    }
    return [...porCodigo.values()].map((r) => ({ ...r, clase: clasificar(r), brecha: brechaPct(r) }));
  }, [resultados]);

  /* Base de TODA la pantalla: tarjetas, gráficos, simulador y tabla salen de
     aquí. Antes solo la tabla filtraba y los indicadores se calculaban sobre el
     total, así que convivían dos períodos sin avisar: la tarjeta decía 32
     ganadas (histórico) y la tabla 13 (agosto).

     Se aplican los DOS rangos de la pantalla:

     · El de arriba, por fecha de nuestra cotización. Es el que se usa para
       elegir qué sincronizar, y es el período en que uno piensa cuando dice
       "quiero ver agosto". Sirve además porque TODAS las fichas tienen esa
       fecha, así que acotar no esconde nada.
     · «Adjudicada entre», por fecha de adjudicación del proceso. Más fino,
       para mirar cuándo se resolvieron.

     No entran ni el filtro de clase ni la búsqueda: la dona se desglosa POR
     clase —filtrar por clase la dejaría de un solo color— y la búsqueda es
     para encontrar un proceso puntual, no para redefinir el período. */
  const enRango = useMemo(() => {
    if (!syncDesde && !syncHasta) return filas;
    return filas.filter((f) => {
      // Sin fecha de adjudicación no se puede afirmar que caiga en el rango.
      const dia = String(fechaPeriodo(f) || "").slice(0, 10);
      if (!dia) return false;
      if (syncDesde && dia < syncDesde) return false;
      if (syncHasta && dia > syncHasta) return false;
      return true;
    });
  }, [filas, syncDesde, syncHasta]);

  /* Cuántas se caen por no tener fecha de adjudicación: son los que siguen
     abiertos, y se van de golpe en cuanto se pone un rango. Sin avisarlo
     parece que se hubieran perdido datos. */
  const sinFechaFuera = useMemo(
    () => (syncDesde || syncHasta ? filas.filter((f) => !fechaPeriodo(f)).length : 0),
    [filas, syncDesde, syncHasta],
  );

  const stats = useMemo(() => {
    const ganadas = enRango.filter((f) => f.clase === "ganada");
    const perdidas = enRango.filter((f) => f.clase === "perdida");
    const decididas = ganadas.length + perdidas.length;
    // Los convenios de suministro se informan aparte: su acta es demanda
    // estimada del período completo, no venta del mes.
    const convenios = ganadas.filter(esConvenioSuministro);
    const montoGanado = ganadas.reduce((s, f) => s + (esConvenioSuministro(f) ? 0 : montoGanadoDe(f)), 0);
    const montoConvenios = convenios.reduce((s, f) => s + montoGanadoDe(f), 0);
    const oportunidadPerdida = perdidas.reduce((s, f) => s + (Number(f.monto_ganador) || 0), 0);
    const brechas = perdidas.map((f) => f.brecha).filter((b) => Number.isFinite(b) && b > 0);
    const brechaProm = brechas.length ? brechas.reduce((s, b) => s + b, 0) / brechas.length : null;
    // Perdidas "por poco": brecha menor al 5%.
    const casiGanadas = brechas.filter((b) => b <= 5).length;
    return {
      total: enRango.length,
      ganadas: ganadas.length,
      perdidas: perdidas.length,
      enCurso: enRango.filter((f) => f.clase === "en_curso").length,
      tasa: decididas ? (ganadas.length / decididas) * 100 : null,
      montoGanado,
      montoConvenios,
      convenios: convenios.length,
      oportunidadPerdida,
      brechaProm,
      casiGanadas,
    };
  }, [enRango]);

  // Ranking de competidores que nos han ganado.
  const competidores = useMemo(() => {
    const mapa = new Map();
    for (const f of enRango) {
      if (f.clase !== "perdida" || !f.ganador_nombre) continue;
      const key = f.ganador_rut || f.ganador_nombre;
      const prev = mapa.get(key) || { nombre: f.ganador_nombre, rut: f.ganador_rut, veces: 0, monto: 0, es_emt: f.ganador_es_emt };
      prev.veces += 1;
      prev.monto += Number(f.monto_ganador) || 0;
      mapa.set(key, prev);
    }
    return [...mapa.values()].sort((a, b) => b.veces - a.veces || b.monto - a.monto).slice(0, 8);
  }, [enRango]);

  // Perdidas más estrechas (donde estuvimos más cerca de ganar).
  const perdidasEstrechas = useMemo(
    () =>
      enRango
        .filter((f) => f.clase === "perdida" && Number.isFinite(f.brecha) && f.brecha > 0)
        .sort((a, b) => a.brecha - b.brecha)
        .slice(0, 8),
    [enRango],
  );

  /* Evolución mensual por fecha de ADJUDICACIÓN — el MISMO criterio que los
     KPIs, la dona y la tabla. Antes agrupaba por mes de cierre y era el único
     gráfico del panel midiendo otra cosa: sus barras no cuadraban con las
     cifras de arriba. Lo aún no adjudicado no tiene mes donde caer y queda
     fuera, igual que en el resto de los indicadores. */
  const tendencia = useMemo(() => {
    const mapa = new Map();
    for (const f of enRango) {
      const iso = f.fecha_adjudicacion;
      const d = iso ? new Date(iso) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = mapa.get(key) || { key, ganadas: 0, perdidas: 0, otras: 0 };
      if (f.clase === "ganada") b.ganadas += 1;
      else if (f.clase === "perdida") b.perdidas += 1;
      else b.otras += 1;
      mapa.set(key, b);
    }
    return [...mapa.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-8);
  }, [enRango]);

  /* ── Análisis de productos (pedido 2026-09-03) ──────────────────────────
     Agrega los ítems de todas las fichas del período (detalle.comparacion_items)
     para ver, POR PRODUCTO, en cuántos procesos aparece, cuántos ganamos o
     perdimos, y a qué precios se está adjudicando en Mercado Público.
     · El resultado por ítem manda cuando existe (licitaciones adjudican por
       línea: ganado_por_nosotros); si no, hereda la clase del proceso.
     · Los precios son PROMEDIOS unitarios; el "monto adjudicado" es
       precio ganador × cantidad (lo que efectivamente movió el producto). */
  const analisisProductos = useMemo(() => {
    const mapa = new Map();
    for (const f of enRango) {
      const items = f?.detalle?.comparacion_items || [];
      for (const it of items) {
        const nombre = String(it?.nombre || "").trim();
        const codigo = String(it?.codigo_producto || "").trim();
        const key = (codigo || nombre).toLowerCase();
        if (!key) continue;
        const e = mapa.get(key) || {
          nombre: nombre || codigo,
          codigo,
          procesos: new Set(),
          ganados: 0,
          perdidos: 0,
          precioNuestroSum: 0, precioNuestroN: 0,
          precioGanadorSum: 0, precioGanadorN: 0,
          montoAdjudicado: 0,
        };
        // Nos quedamos con la descripción más completa que aparezca.
        if (nombre && nombre.length > String(e.nombre || "").length) e.nombre = nombre;
        e.procesos.add(f.codigo_mp || f.licitacion_id);

        let resultado = null;
        if (typeof it.ganado_por_nosotros === "boolean") resultado = it.ganado_por_nosotros ? "ganado" : "perdido";
        else if (f.clase === "ganada") resultado = "ganado";
        else if (f.clase === "perdida") resultado = "perdido";
        if (resultado === "ganado") e.ganados += 1;
        else if (resultado === "perdido") e.perdidos += 1;

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
    return [...mapa.values()]
      .map((e) => {
        const precioNuestro = e.precioNuestroN ? e.precioNuestroSum / e.precioNuestroN : null;
        const precioGanador = e.precioGanadorN ? e.precioGanadorSum / e.precioGanadorN : null;
        return {
          nombre: e.nombre,
          codigo: e.codigo,
          procesos: e.procesos.size,
          ganados: e.ganados,
          perdidos: e.perdidos,
          precioNuestro,
          precioGanador,
          brecha: precioNuestro != null && precioGanador > 0
            ? ((precioNuestro - precioGanador) / precioGanador) * 100
            : null,
          montoAdjudicado: Math.round(e.montoAdjudicado),
        };
      })
      .sort((a, b) => b.procesos - a.procesos || b.montoAdjudicado - a.montoAdjudicado);
  }, [enRango]);

  const [busquedaProd, setBusquedaProd] = useState("");
  const [prodVerTodos, setProdVerTodos] = useState(false);

  const productosFiltrados = useMemo(() => {
    const q = busquedaProd.trim().toLowerCase();
    const base = q
      ? analisisProductos.filter((p) =>
          p.nombre.toLowerCase().includes(q) || String(p.codigo || "").toLowerCase().includes(q))
      : analisisProductos;
    return prodVerTodos ? base : base.slice(0, 15);
  }, [analisisProductos, busquedaProd, prodVerTodos]);

  async function exportarProductos() {
    if (!analisisProductos.length) return;
    try {
      const XLSX = await import("xlsx");
      const rows = analisisProductos.map((p) => ({
        "Producto": p.nombre,
        "Código ONU": p.codigo || "",
        "Procesos": p.procesos,
        "Ganados": p.ganados,
        "Perdidos": p.perdidos,
        "Nuestro precio prom.": p.precioNuestro != null ? Math.round(p.precioNuestro) : "",
        "Precio ganador prom.": p.precioGanador != null ? Math.round(p.precioGanador) : "",
        "Brecha %": p.brecha != null ? Number(p.brecha.toFixed(1)) : "",
        "Monto adjudicado": p.montoAdjudicado,
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Productos MP");
      XLSX.writeFile(wb, `analisis_productos_mp_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      console.error("Error exportando análisis de productos:", e);
    }
  }

  /* La tabla parte de la MISMA base que los indicadores y solo agrega encima
     los filtros propios de la tabla. Antes repetía aquí la lógica de fechas, y
     ese duplicado es lo que permitía que ambas partes divergieran. */
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return enRango.filter((f) => {
      if (filtroClase && f.clase !== filtroClase) return false;
      if (filtroTipo && f.tipo !== filtroTipo) return false;
      if (!q) return true;
      return [f.codigo_mp, f.organismo, f.ganador_nombre, f.interna?.nombre, f.interna?.nombre_entidad]
        .map((s) => String(s || "").toLowerCase())
        .some((s) => s.includes(q));
    });
  }, [enRango, busqueda, filtroClase, filtroTipo]);

  const ordenadas = useMemo(() => {
    const val = (f) => {
      switch (orden.campo) {
        case "adjudicacion": { const t = f.fecha_adjudicacion ? new Date(f.fecha_adjudicacion).getTime() : NaN; return Number.isFinite(t) ? t : null; }
        case "nuestra": return f.monto_nuestro != null ? Number(f.monto_nuestro) : null;
        case "ganadora": return f.monto_ganador != null ? Number(f.monto_ganador) : null;
        case "brecha": return Number.isFinite(f.brecha) ? f.brecha : null;
        default: return null;
      }
    };
    const dir = orden.dir === "asc" ? 1 : -1;
    return [...filtradas].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // sin dato siempre al final
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [filtradas, orden]);

  function toggleOrden(campo) {
    setOrden((o) => (o.campo === campo ? { campo, dir: o.dir === "asc" ? "desc" : "asc" } : { campo, dir: "desc" }));
  }

  function exportarCsv() {
    const enc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const filasCsv = [
      // El CSV conserva ambas fechas: la tabla muestra la adjudicación, pero
      // para analizar fuera conviene tener también el cierre.
      ["Código", "Tipo", "Cotización interna", "Organismo", "Cierre", "Adjudicación", "Nuestra oferta", "Oferta ganadora", "Brecha %", "Ganador", "RUT ganador", "Resultado"],
      ...ordenadas.map((f) => [
        f.codigo_mp, f.tipo === "compra_agil" ? "Compra Ágil" : esConvenioSuministro(f) ? "Convenio de suministro" : "Licitación", f.interna?.nombre || "", f.organismo || "",
        f.fecha_cierre ? fmtFecha(f.fecha_cierre) : "",
        f.fecha_adjudicacion ? fmtFecha(f.fecha_adjudicacion) : "",
        f.monto_nuestro ?? "", (f.clase === "ganada" ? montoGanadoDe(f) : f.monto_ganador) ?? "",
        Number.isFinite(f.brecha) ? f.brecha.toFixed(1) : "", f.ganador_nombre || "", f.ganador_rut || "", CLASES[f.clase].label,
      ]),
    ];
    // BOM + ";" para que Excel es-CL lo abra directo con tildes correctas.
    const csv = String.fromCharCode(0xfeff) + filasCsv.map((r) => r.map(enc).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "analisis-mercado-publico.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const sinConfig = estadoApi && !estadoApi.ticket_configurado;

  // Abre el chat de DamarIA con todo el contexto del panel cargado y le pide
  // de entrada un análisis completo (responde en texto y, con el parlante
  // activado, también con su voz).
  function preguntarleADamaria() {
    const decididas = enRango.filter((f) => f.clase === "ganada" || f.clase === "perdida");
    const contexto = {
      panel: "Análisis Mercado Público (postulaciones vs oferta ganadora, montos brutos con IVA)",
      // Sin decirle el período, DamarIA habla del histórico completo aunque las
      // cifras que recibe estén acotadas a un rango.
      periodo: syncDesde || syncHasta
        ? { medido_por: 'fecha de adjudicación', desde: syncDesde || null, hasta: syncHasta || null }
        : "todo el histórico disponible",
      kpis: {
        procesos_analizados: stats.total,
        ganadas: stats.ganadas,
        perdidas: stats.perdidas,
        en_curso: stats.enCurso,
        tasa_exito_pct: stats.tasa != null ? Math.round(stats.tasa) : null,
        monto_ganado_clp: stats.montoGanado,
        convenios_suministro: stats.convenios,
        convenios_suministro_clp_estimado_periodo_completo: stats.montoConvenios,
        oportunidad_perdida_clp: stats.oportunidadPerdida,
        brecha_promedio_al_perder_pct: stats.brechaProm != null ? Number(stats.brechaProm.toFixed(1)) : null,
        perdidas_por_menos_de_5pct: stats.casiGanadas,
      },
      competidores_que_nos_ganan: competidores.map((c) => ({ nombre: c.nombre, veces: c.veces, monto_clp: c.monto, es_emt: !!c.es_emt })),
      perdidas_mas_estrechas: perdidasEstrechas.map((f) => ({
        codigo: f.codigo_mp, organismo: f.organismo || null, brecha_pct: Number(f.brecha.toFixed(1)),
        nuestra_oferta_clp: Number(f.monto_nuestro) || null, oferta_ganadora_clp: Number(f.monto_ganador) || null,
      })),
      evolucion_mensual: tendencia.map((m) => ({ mes: m.key, ganadas: m.ganadas, perdidas: m.perdidas, otras: m.otras })),
      perdidas_sin_explicacion_por_precio: decididas.filter((f) => f.clase === "perdida" && Number(f.monto_nuestro) > 0 && Number(f.monto_nuestro) <= Number(f.monto_ganador)).length,
    };
    window.dispatchEvent(new CustomEvent("damaria:abrir", {
      detail: {
        nombre: "Análisis Mercado Público",
        contexto: JSON.stringify(contexto),
        pregunta: "Dame un análisis completo de cómo nos está yendo en Mercado Público: dónde estamos ganando y perdiendo, contra quién, y qué deberíamos hacer.",
      },
    }));
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Scale size={22} style={{ color: "var(--primary)" }} />
            Análisis Mercado Público
          </h1>
          <p className="page-subtitle">
            Nuestras postulaciones vs la oferta ganadora · datos oficiales de las APIs de Mercado Público
            {estadoApi?.rut_empresa ? ` · RUT ${estadoApi.rut_empresa}` : ""}
          </p>
        </div>
        <div className="page-actions" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            {/* Único rango de fechas de la pantalla. Acota el panel completo
                —indicadores, gráficos y tabla— con la fecha que se elija al
                lado, y además define qué se consulta al sincronizar. */}
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".03em", marginBottom: 3 }}
              title="Por fecha de adjudicación. Acota todo el panel: indicadores, gráficos y tabla. Los procesos aún sin adjudicar quedan fuera, porque no hay fecha con la cual ubicarlos. Vacío = se muestra todo. Al sincronizar, este rango se lee como fecha de tu cotización, que es lo que entiende la API.">
              PERÍODO · POR FECHA DE ADJUDICACIÓN
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 120px", minWidth: 0 }} title="Desde (vacío = se muestra todo)">
                <DateFilter value={syncDesde} onChange={setSyncDesde} placeholder="Desde" disabled={sincronizando} />
              </div>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>→</span>
              <div style={{ flex: "1 1 120px", minWidth: 0 }} title="Hasta (vacío = hoy)">
                <DateFilter
                  value={syncHasta}
                  onChange={setSyncHasta}
                  placeholder="Hasta"
                  disabled={sincronizando}
                  minDate={syncDesde ? new Date(`${syncDesde}T00:00:00`) : null}
                />
              </div>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={preguntarleADamaria} disabled={loading || enRango.length === 0}
            title="Abre a DamarIA con todos los datos de este panel cargados: pídele el análisis por texto o voz"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38 }}>
            <SunflowerIcon size={15} /> Pregúntale a DamarIA
          </button>
          {/* Sincronización manual OCULTA (pedido 2026-08-27): el panel se
              alimenta de la corrida automática; los botones («Sincronizar» y
              «Forzar») vuelven poniendo la bandera en true. La lógica queda
              intacta por si hay que dispararla puntualmente. */}
          {MOSTRAR_SYNC && (
            <>
              <button className="btn btn-primary" onClick={() => sincronizar(false)} disabled={sincronizando || sinConfig}
                style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38, minWidth: 250, justifyContent: "center" }}>
                <RefreshCw size={14} className={sincronizando ? "girando" : undefined} />
                {sincronizando
                  ? progresoSync?.restantes != null
                    ? `${progresoSync.hechas} de ${progresoSync.hechas + progresoSync.restantes}${
                        restanteAprox(progresoSync.etaMs) ? ` · ~${restanteAprox(progresoSync.etaMs)}` : ""
                      }`
                    : "Sincronizando…"
                  : "Sincronizar con Mercado Público"}
              </button>
              <button className="btn btn-ghost" onClick={() => sincronizar(true)} disabled={sincronizando || sinConfig}
                title="Vuelve a consultar TODOS los procesos, incluidos los ya resueltos. Úsalo para rellenar datos nuevos (como la fecha de adjudicación) en procesos antiguos. Consume más cuota de la API."
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38 }}>
                <RefreshCw size={13} /> Forzar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Avance de la sincronización. Es informativo: la sincronización tarda
          decenas de minutos porque la API responde una ficha cada ~25 s, así
          que hay que poder ver cuánto falta sin quedarse adivinando. */}
      {sincronizando && progresoSync && (
        <div style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
            <span>
              <b>{progresoSync.hechas}</b>
              {progresoSync.restantes != null && ` de ${progresoSync.hechas + progresoSync.restantes}`} procesos consultados
              {/* Lo consultado y lo guardado no siempre coinciden: cuando la API
                  se demora más de 30 s devuelve 504 y esa ficha no trae datos.
                  Sin este contador la barra avanzaba igual y no había forma de
                  saber que el panel no se estaba moviendo por eso. */}
              {progresoSync.guardadas < progresoSync.hechas && (
                <span style={{ color: "var(--text-muted)" }}> · {progresoSync.guardadas} guardadas</span>
              )}
              {progresoSync.transcurrido > 0 && (
                <span style={{ color: "var(--text-muted)" }}> · {restanteAprox(progresoSync.transcurrido)} transcurridos</span>
              )}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700, color: restanteAprox(progresoSync.etaMs) ? "var(--primary-dark)" : "var(--text-muted)" }}>
                {restanteAprox(progresoSync.etaMs)
                  ? `Queda ${restanteAprox(progresoSync.etaMs)} aprox.`
                  : "Calculando cuánto falta…"}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={detenerSync}
                disabled={deteniendo}
                title="Corta la sincronización. Lo ya consultado queda guardado y al retomar sigue desde ahí."
                style={{ display: "inline-flex", alignItems: "center", gap: 5, color: deteniendo ? "var(--text-muted)" : "#b91c1c" }}
              >
                <Square size={11} fill="currentColor" /> {deteniendo ? "Deteniendo…" : "Detener"}
              </button>
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "var(--neutral-bg)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${progresoSync.restantes != null && progresoSync.hechas + progresoSync.restantes > 0
                ? Math.min(100, (progresoSync.hechas / (progresoSync.hechas + progresoSync.restantes)) * 100)
                : 0}%`,
              background: "var(--primary)",
              borderRadius: 999,
              transition: "width .5s ease",
            }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 7, lineHeight: 1.5 }}>
            Cada ficha se guarda apenas llega, así que puedes cerrar esta pestaña cuando quieras: al volver, la
            sincronización retoma donde quedó y no repite lo ya consultado.
          </div>
        </div>
      )}

      {sinConfig && (
        <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <KeyRound size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            <b>Falta el ticket de la API de Mercado Público.</b><br />
            Solicítalo gratis en <a href="https://www.chilecompra.cl/api/" target="_blank" rel="noreferrer" style={{ color: "var(--primary-dark)" }}>chilecompra.cl/api</a> (botón
            "Pide tu ticket", con Clave Única — llega por correo). Luego agrégalo al backend como <code>MP_API_TICKET</code> junto
            con <code>MP_RUT_EMPRESA</code> (el RUT con que postulamos) y reinicia el backend.
            {estadoApi?.ticket_configurado && !estadoApi?.rut_configurado && " Falta además MP_RUT_EMPRESA para detectar nuestras ofertas."}
          </div>
        </div>
      )}

      {/* Con un rango puesto, TODA la pantalla habla de ese período. Se dice
          explícitamente porque el salto de cifras es grande y, en el caso de
          «Adjudicada entre», porque lo que aún no se adjudica no tiene fecha
          con la cual decidir si cae dentro del rango y desaparece de golpe. */}
      {(syncDesde || syncHasta) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: "1px solid var(--border)", background: "var(--neutral-bg)", borderRadius: 10, padding: "9px 14px", marginBottom: 12, fontSize: 12.5, color: "var(--text-soft)" }}>
          <CalendarRange size={14} style={{ flexShrink: 0 }} />
          <span>
            Indicadores, gráficos y tabla acotados por <b>fecha de adjudicación</b>
            {syncDesde && <> desde <b>{diaLegible(syncDesde)}</b></>}
            {syncHasta && <> hasta <b>{diaLegible(syncHasta)}</b></>}.
            {sinFechaFuera > 0 && (
              <span style={{ color: "var(--text-muted)" }}>
                {" "}Quedan fuera {sinFechaFuera} aún sin adjudicar.
              </span>
            )}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }}
            onClick={() => { setSyncDesde(""); setSyncHasta(""); }}>
            Ver todo
          </button>
        </div>
      )}

      {/* ── KPIs (clic = filtrar la tabla) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi icon={<Target size={17} />} tono="#1e9295" fondo="#e6f6f6" label="Procesos analizados" valor={stats.total}
          sub={`${stats.enCurso} en curso`}
          onClick={() => { setFiltroClase(""); setBusqueda(""); }} />
        {/* Solo el adjudicado firme. Los convenios de suministro no se
            muestran (pedido 14-08): su acta es demanda estimada del período,
            no venta; siguen excluidos de la suma y marcados en la tabla. */}
        <Kpi icon={<Trophy size={17} />} tono="#15803d" fondo="#dcfce7" label="Ganadas" valor={stats.ganadas}
          sub={fmt$(stats.montoGanado) + " adjudicado"}
          activo={filtroClase === "ganada"}
          onClick={() => setFiltroClase((v) => (v === "ganada" ? "" : "ganada"))} />
        <Kpi icon={<TrendingDown size={17} />} tono="#b91c1c" fondo="#fee2e2" label="Perdidas" valor={stats.perdidas}
          sub={fmt$(stats.oportunidadPerdida) + " se llevó la competencia"} activo={filtroClase === "perdida"}
          onClick={() => setFiltroClase((v) => (v === "perdida" ? "" : "perdida"))} />
        <Kpi icon={<Percent size={17} />} tono="#6d28d9" fondo="#ede9fe" label="Tasa de éxito"
          valor={stats.tasa == null ? "—" : `${stats.tasa.toFixed(0)}%`} sub="sobre procesos decididos" />
        <Kpi icon={<Scale size={17} />} tono="#b45309" fondo="#fef3c7" label="Brecha prom. al perder"
          valor={stats.brechaProm == null ? "—" : `+${stats.brechaProm.toFixed(1)}%`}
          sub={`${stats.casiGanadas} perdida${stats.casiGanadas === 1 ? "" : "s"} por <5%`} />
      </div>

      {/* ── Gráficos ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Panel titulo="Resultado global" extra={
          <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "3px 10px" }} onClick={() => setDonaPorMonto((v) => !v)}>
            {donaPorMonto ? "Por Monto" : "Por Cantidad"}
          </button>
        }>
          <DonaResultados filas={enRango} porMonto={donaPorMonto} />
        </Panel>

        <Panel titulo="Perdidas más estrechas" sub="Qué tan cerca estuvimos (brecha vs ganador)">
          {perdidasEstrechas.length === 0 ? (
            <Vacio texto="Sin perdidas con brecha calculable aún." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {perdidasEstrechas.map((f) => (
                <BarraH key={f.id}
                  etiqueta={f.codigo_mp}
                  detalle={`${fmt$(f.monto_nuestro)} vs ${fmt$(f.monto_ganador)}`}
                  valor={Math.min(f.brecha, 30)} max={30}
                  texto={`+${f.brecha.toFixed(1)}%`}
                  color={f.brecha <= 5 ? "#f59e0b" : "#ef4444"}
                  onClick={() => { setBusqueda(f.codigo_mp); setFiltroClase(""); }}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo="Evolución mensual" sub="Resultados por mes de adjudicación">
          {tendencia.length === 0 ? (
            <Vacio texto="Sin procesos adjudicados aún." />
          ) : (
            <TendenciaMensual meses={tendencia} />
          )}
        </Panel>

        <Panel titulo="Quién nos gana" sub="Competidores con más victorias sobre nosotros">
          {competidores.length === 0 ? (
            <Vacio texto="Aún no hay perdidas con ganador identificado." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {competidores.map((c) => (
                <BarraH key={c.rut || c.nombre}
                  etiqueta={c.nombre + (c.es_emt ? " · EMT" : "")}
                  detalle={fmt$(c.monto)}
                  valor={c.veces} max={competidores[0].veces}
                  texto={`${c.veces}×`}
                  color="#6d28d9"
                  onClick={() => { setBusqueda(c.nombre); setFiltroClase(""); }}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Simulador de precio ── */}
      <SimuladorPrecio filas={enRango} />

      {/* ── Análisis de productos (agregado desde los ítems de cada ficha) ── */}
      <div style={{ marginBottom: 16 }}>
        <Panel
          titulo="Análisis de productos"
          sub="Qué productos se mueven en Mercado Público, cuántos ganamos/perdemos y a qué precios (promedios del período)"
          extra={
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder="Buscar producto…"
                value={busquedaProd}
                onChange={(e) => setBusquedaProd(e.target.value)}
                style={{ height: 30, fontSize: 12, width: 180 }}
              />
              <button
                className="btn btn-ghost"
                onClick={exportarProductos}
                disabled={!analisisProductos.length}
                style={{ fontSize: 11.5, padding: "3px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}
                title="Descargar el análisis completo de productos en Excel"
              >
                <Download size={12} /> Excel
              </button>
            </div>
          }
        >
          {analisisProductos.length === 0 ? (
            <Vacio texto="Aún no hay fichas con detalle de productos en el período." />
          ) : (
            <>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--surface)", minWidth: 780 }}>
                  <thead>
                    <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
                      <th style={{ padding: "6px 10px" }}>Producto</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Procesos</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Ganados</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Perdidos</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Nuestro precio prom.</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Precio ganador prom.</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Brecha prom.</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Monto adjudicado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosFiltrados.map((p, i) => (
                      <tr key={`${p.codigo}-${p.nombre}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "5px 10px", maxWidth: 320 }}>
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }} title={p.nombre}>{p.nombre}</div>
                          {p.codigo && <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>ONU {p.codigo}</div>}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700 }}>{p.procesos}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#15803d", fontWeight: 600 }}>{p.ganados || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#b91c1c", fontWeight: 600 }}>{p.perdidos || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{p.precioNuestro != null ? fmt$(Math.round(p.precioNuestro)) : "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right" }}>{p.precioGanador != null ? fmt$(Math.round(p.precioGanador)) : "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: p.brecha == null ? "var(--text-muted)" : p.brecha > 0 ? "#b91c1c" : "#15803d" }}>
                          {p.brecha == null ? "—" : `${p.brecha > 0 ? "+" : ""}${p.brecha.toFixed(1)}%`}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{fmt$(p.montoAdjudicado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analisisProductos.length > 15 && !busquedaProd && (
                <div style={{ marginTop: 8, textAlign: "center" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setProdVerTodos((v) => !v)}>
                    {prodVerTodos ? "Ver solo el top 15" : `Ver los ${analisisProductos.length} productos`}
                  </button>
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
                Brecha positiva = nuestro precio promedio quedó sobre el del ganador. En licitaciones el resultado es por ítem
                (se puede ganar una línea y perder otra); "monto adjudicado" = precio del ganador × cantidad, gane quien gane.
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* ── Diferencias con el Panel Indicadores ── */}
      <DiferenciasIndicadores filas={filas} syncDesde={syncDesde} syncHasta={syncHasta} />

      {/* ── Filtros ── */}
      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 1, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 30 }} placeholder="Código, organismo, competidor…"
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Resultado</label>
          <select className="input" value={filtroClase} onChange={(e) => setFiltroClase(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Todos</option>
            {Object.entries(CLASES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo</label>
          <select className="input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Todos</option>
            <option value="compra_agil">Compra Ágil</option>
            <option value="licitacion">Licitación</option>
          </select>
        </div>
        {/* El rango de fechas ya no vive aquí: era un segundo filtro por
            adjudicación que competía con el de arriba y daba cifras distintas
            para el mismo mes. Ahora hay un solo período, arriba, y esa lectura
            por adjudicación es una de sus opciones. */}
      </div>

      {/* ── Tabla ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 6, gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
          {loading ? "" : `${filtradas.length} proceso${filtradas.length === 1 ? "" : "s"}${filtradas.length !== enRango.length ? ` (de ${enRango.length})` : ""}`}
        </div>
        <button className="btn btn-ghost" onClick={exportarCsv} disabled={!filtradas.length}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 12px" }}>
          <Download size={13} /> Exportar CSV
        </button>
      </div>
      <div className="mp-tabla-wrap">
        <table className="mp-tabla">
          <thead>
            <tr>
              <th style={{ width: 26 }} />
              <th>Proceso</th>
              <th>Organismo</th>
              <ThOrden campo="adjudicacion" orden={orden} onOrden={toggleOrden}>Adjudicación</ThOrden>
              <ThOrden campo="nuestra" orden={orden} onOrden={toggleOrden} right>Nuestra oferta</ThOrden>
              <ThOrden campo="ganadora" orden={orden} onOrden={toggleOrden} right>Oferta ganadora</ThOrden>
              <ThOrden campo="brecha" orden={orden} onOrden={toggleOrden} right>Brecha</ThOrden>
              <th>Ganador</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando análisis…</td></tr>
            ) : ordenadas.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                {resultados.length === 0
                  ? MOSTRAR_SYNC
                    ? "Sin datos todavía. Usa \"Sincronizar con Mercado Público\" para consultar tus postulaciones."
                    : "Sin datos todavía. Las postulaciones se consultan con la sincronización automática del sistema."
                  : "Sin resultados con los filtros actuales."}
              </td></tr>
            ) : (
              ordenadas.map((f) => {
                const cl = CLASES[f.clase];
                const abierta = expandida === f.id;
                return (
                  <FilaProceso key={f.id} f={f} cl={cl} abierta={abierta}
                    onToggle={() => setExpandida(abierta ? null : f.id)} />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
        Compra Ágil: cotizaciones públicas desde el cierre del proceso (API v2). Licitaciones: la API solo publica la
        adjudicación (ganador por ítem), no las demás ofertas. Montos con IVA incluido. La sincronización avanza en
        tandas y la tabla se actualiza en vivo; los procesos ya consultados no se repiten hasta pasadas 6 horas
        (cuida la cuota diaria del ticket).
      </p>

      <style>{`
        .girando { animation: mp-spin 1s linear infinite; }
        @keyframes mp-spin { to { transform: rotate(360deg); } }
        .mp-tabla-wrap {
          border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
          max-height: 62vh; overflow: auto;
        }
        .mp-tabla { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; white-space: nowrap; }
        .mp-tabla thead th {
          position: sticky; top: 0; z-index: 2;
          background: var(--bg); color: var(--text-muted); text-align: left;
          padding: 9px 12px; font-weight: 600;
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .mp-tabla thead th.mp-th-orden { cursor: pointer; user-select: none; }
        .mp-tabla thead th.mp-th-orden:hover { color: var(--text); }
        .mp-tabla tbody tr:not(:first-child) > td { border-top: 1px solid var(--border); }
        .mp-tabla tbody tr.mp-det > td { border-top: none; }
        .mp-fila:hover > td { background: color-mix(in srgb, var(--primary, #1e9295) 5%, transparent); }
      `}</style>
    </div>
  );
}

/* ── Fila expandible de la tabla ── */
function FilaProceso({ f, cl, abierta, onToggle }) {
  const det = f.detalle || {};
  const cotizaciones = det.cotizaciones || [];
  const comparacion = det.comparacion_items || [];
  const tieneDetalle = cotizaciones.length > 0 || comparacion.length > 0;

  return (
    <>
      <tr className="mp-fila" style={{ cursor: tieneDetalle ? "pointer" : "default", background: abierta ? "var(--bg)" : undefined }}
        onClick={tieneDetalle ? onToggle : undefined}>
        <td style={{ padding: "7px 4px 7px 12px", color: "var(--text-muted)" }}>
          {tieneDetalle ? (abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </td>
        <td style={{ padding: "7px 12px" }}>
          <div style={{ fontWeight: 700 }}>{f.codigo_mp}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
            {f.interna?.nombre || ""} · {f.tipo === "compra_agil" ? "Compra Ágil" : esConvenioSuministro(f) ? "Convenio de suministro" : "Licitación"}
          </div>
        </td>
        <td style={{ padding: "7px 12px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }} title={f.organismo || ""}>
          {f.organismo || f.interna?.nombre_entidad || "—"}
        </td>
        {/* Fecha de adjudicación. Cuando el proceso aún no se resuelve no hay
            dato, así que se deja el cierre a mano en el tooltip para no perder
            la referencia temporal. */}
        <td
          style={{ padding: "7px 12px", fontSize: 12.5, color: "var(--text-muted)" }}
          title={f.fecha_cierre ? `Cierre del proceso: ${fmtFecha(f.fecha_cierre)}` : ""}
        >
          {f.fecha_adjudicacion ? fmtFecha(f.fecha_adjudicacion) : "—"}
        </td>
        <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600 }}>{fmt$(f.monto_nuestro)}</td>
        {/* En una ganada, "lo ganador" es LO NUESTRO adjudicado: mostrar la
            suma de todos los proveedores del acta confundía (y es lo que
            inflaba el acumulado). */}
        <td
          style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600 }}
          title={f.clase === "ganada" ? "Monto adjudicado a nosotros según el acta" : ""}
        >
          {fmt$(f.clase === "ganada" ? montoGanadoDe(f) : f.monto_ganador)}
        </td>
        <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, color: f.brecha == null ? "var(--text-muted)" : f.brecha > 0 ? "#b91c1c" : "#15803d" }}>
          {f.clase === "ganada" ? "—" : fmtPct(f.brecha)}
        </td>
        <td style={{ padding: "7px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }} title={f.ganador_nombre || ""}>
          {f.ganamos === true
            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#15803d", fontWeight: 700 }}><Crown size={13} /> Nosotros</span>
            : f.ganador_nombre
              ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Building2 size={12} style={{ color: "var(--text-muted)" }} />{f.ganador_nombre}{f.ganador_es_emt ? <em style={{ fontSize: 10.5, color: "#6d28d9", fontStyle: "normal", fontWeight: 700 }}>EMT</em> : null}</span>
              : "—"}
        </td>
        <td style={{ padding: "7px 12px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, color: cl.color, background: cl.bg }}>
            {cl.label}
          </span>
        </td>
      </tr>

      {abierta && (
        <tr className="mp-det" style={{ background: "var(--bg)" }}>
          <td colSpan={9} style={{ padding: "6px 16px 16px 40px" }}>
            <DetalleProceso f={f} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleProceso({ f }) {
  const det = f.detalle || {};
  const cotizaciones = [...(det.cotizaciones || [])].sort((a, b) => (a.monto_total ?? Infinity) - (b.monto_total ?? Infinity));
  const comparacion = det.comparacion_items || [];
  const nuestra = cotizaciones.find((c) => c.nuestra);

  // Diagnóstico de por qué se perdió (solo cuando hay datos de ambas ofertas).
  const razones = [];
  if (f.clase === "perdida" && nuestra) {
    const gan = cotizaciones.find((c) => c.rut === f.ganador_rut);
    if (nuestra.inadmisible) razones.push(`Nuestra cotización fue declarada inadmisible${nuestra.justificacion_inadmisibilidad ? `: ${nuestra.justificacion_inadmisibilidad}` : "."}`);
    if (gan && nuestra.valor_neto != null && gan.valor_neto != null && nuestra.valor_neto > gan.valor_neto) {
      razones.push(`Nuestro neto fue ${(((nuestra.valor_neto - gan.valor_neto) / gan.valor_neto) * 100).toFixed(1)}% más alto (${fmt$(nuestra.valor_neto)} vs ${fmt$(gan.valor_neto)}).`);
    }
    if (gan && (nuestra.monto_despacho || 0) > (gan.monto_despacho || 0)) {
      razones.push(`Nuestro despacho fue más caro: ${fmt$(nuestra.monto_despacho || 0)} vs ${fmt$(gan.monto_despacho || 0)} del ganador.`);
    }
    if (razones.length === 0 && f.brecha != null && f.brecha > 0) {
      razones.push(`Perdimos por precio: nuestra oferta total fue ${f.brecha.toFixed(1)}% más alta que la ganadora.`);
    }
    if (razones.length === 0) razones.push("El comprador seleccionó otra oferta (revisa el motivo de selección en la ficha del proceso).");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {razones.length > 0 && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.6 }}>
          <b style={{ color: "#b91c1c", display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={13} /> Por qué perdimos</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {razones.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {cotizaciones.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Cotizaciones del proceso ({cotizaciones.length})</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--surface)" }}>
              <thead>
                <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}>#</th>
                  <th style={{ padding: "6px 10px" }}>Proveedor</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Neto</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Despacho</th>
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Total</th>
                  <th style={{ padding: "6px 10px" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((c, i) => {
                  const esGanadora = c.rut && c.rut === f.ganador_rut;
                  return (
                    <tr key={i} style={{
                      borderTop: "1px solid var(--border)",
                      background: c.nuestra ? "#e6f6f6" : esGanadora ? "#f0fdf4" : undefined,
                      fontWeight: c.nuestra || esGanadora ? 600 : 400,
                    }}>
                      <td style={{ padding: "5px 10px", color: "var(--text-muted)" }}>{i + 1}</td>
                      <td style={{ padding: "5px 10px" }}>
                        {c.nombre || c.rut || "—"}
                        {c.nuestra && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: "#1e9295" }}>NOSOTROS</span>}
                        {esGanadora && <Crown size={12} style={{ marginLeft: 6, color: "#15803d", verticalAlign: -2 }} />}
                        {c.es_emt && <em style={{ marginLeft: 6, fontSize: 10, color: "#6d28d9", fontStyle: "normal", fontWeight: 700 }}>EMT</em>}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(c.valor_neto)}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(c.monto_despacho)}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700 }}>{fmt$(c.monto_total)}</td>
                      <td style={{ padding: "5px 10px", fontSize: 11.5, color: c.inadmisible ? "#b91c1c" : "var(--text-muted)" }}>
                        {c.inadmisible ? "Inadmisible" : c.estado_por_comprador || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comparacion.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
            {f.tipo === "compra_agil" ? "Producto a producto: nosotros vs ganador" : "Adjudicación por ítem"}
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--surface)" }}>
              <thead>
                <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 10px" }}>Producto</th>
                  {f.tipo === "compra_agil" && <th style={{ padding: "6px 10px", textAlign: "right" }}>Nuestro precio</th>}
                  <th style={{ padding: "6px 10px", textAlign: "right" }}>Precio ganador</th>
                  {f.tipo === "compra_agil"
                    ? <th style={{ padding: "6px 10px", textAlign: "right" }}>Diferencia</th>
                    : <th style={{ padding: "6px 10px" }}>Adjudicado a</th>}
                </tr>
              </thead>
              <tbody>
                {comparacion.map((it, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "5px 10px", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }} title={it.nombre || ""}>
                      {it.nombre || it.codigo_producto || "—"}
                    </td>
                    {f.tipo === "compra_agil" && <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(it.nuestro_precio)}</td>}
                    <td style={{ padding: "5px 10px", textAlign: "right" }}>{fmt$(it.precio_ganador)}</td>
                    {f.tipo === "compra_agil" ? (
                      <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: it.diferencia > 0 ? "#b91c1c" : it.diferencia < 0 ? "#15803d" : "var(--text-muted)" }}>
                        {it.diferencia == null ? "—" : `${it.diferencia > 0 ? "+" : ""}${fmt$(it.diferencia)}`}
                      </td>
                    ) : (
                      <td style={{ padding: "5px 10px", fontSize: 12 }}>
                        {it.ganado_por_nosotros
                          ? <span style={{ color: "#15803d", fontWeight: 700 }}>Nosotros</span>
                          : (it.ganador_nombre || it.ganador_rut || "—")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Componentes de visualización ── */
/* ── Diferencias con el Panel Indicadores ─────────────────────────────────
   Los dos paneles miden "adjudicado" con reglas distintas y NUNCA van a dar
   igual; la pregunta recurrente es cuánto difieren y por qué. Este bloque
   cruza ambos mundos proceso por proceso y clasifica cada diferencia:

   · Universo: se compara contra Indicadores en su vista «Pública» (solo
     entidad pública; las ventas a particulares quedan fuera del cruce, son
     otro negocio). Aun así Indicadores incluye ventas públicas sin código
     de Mercado Público; este panel solo procesos MP con ficha sincronizada.
   · Fecha: Indicadores fecha de la 1ª OC/boleta registrada; aquí la fecha
     del acta de adjudicación → el mismo cierre puede caer en meses distintos.
   · Monto: los documentos se guardan en NETO, así que el KPI de Indicadores
     es neto; aquí es bruto (acta ×1,19). Para comparar, la OC se lleva a
     bruto y así cada peso de diferencia es una causa real, no el IVA.
   · Convenios de suministro: aquí van fuera del KPI (acta = demanda estimada
     del período completo); en Indicadores suman sus OC reales.

   Los datos de Indicadores (~4.000 cotizaciones + documentos) se piden solo
   al apretar «Comparar»: bajarlos siempre encarecería el panel para todos
   los que no miran esta sección. */
const CATS_DIF = {
  fecha: {
    label: "Desfase de fecha", color: "#b45309", bg: "#fef3c7",
    explica: "El mismo proceso cae en períodos distintos: Indicadores usa la fecha de la 1ª OC registrada y este panel la fecha del acta de adjudicación.",
  },
  monto: {
    label: "Monto distinto", color: "#6d28d9", bg: "#ede9fe",
    explica: "Está en ambos paneles y en el mismo período, pero el monto no calza (lo que suman las OC vs lo adjudicado en el acta).",
  },
  sin_oc: {
    label: "Ganada sin OC aún", color: "#0e7490", bg: "#cffafe",
    explica: "El acta ya nos da como ganadores, pero la OC no está registrada en el sistema: para Indicadores todavía no existe.",
  },
  sin_resultado: {
    label: "Con OC, sin resultado MP", color: "#b91c1c", bg: "#fee2e2",
    explica: "Indicadores la cuenta por su OC, pero la ficha de Mercado Público aún no la da por ganada (falta sincronizar o la OC llegó por otra vía).",
  },
  sin_ficha: {
    label: "Sin ficha MP", color: "#475569", bg: "#e2e8f0",
    explica: "Cotización con código de Mercado Público que aún no tiene ficha sincronizada en este panel.",
  },
  fuera_mp: {
    label: "Fuera de Mercado Público", color: "#334155", bg: "#f1f5f9",
    explica: "Cotizaciones a entidades públicas sin código de Mercado Público (venta directa u otro canal): cuentan en Indicadores y nunca van a aparecer en este panel.",
  },
  convenio: {
    label: "Convenio de suministro", color: "#9d174d", bg: "#fce7f3",
    explica: "Por diseño va fuera del KPI de este panel; Indicadores suma las OC reales que van llegando durante la vigencia.",
  },
  ok: {
    label: "Coinciden", color: "#15803d", bg: "#dcfce7",
    explica: "En ambos paneles, mismo período y mismo monto (OC bruta = acta ×1,19). No son diferencia; se listan para cerrar la cuenta.",
  },
};
const ORDEN_CATS_DIF = ["fecha", "sin_oc", "monto", "sin_resultado", "sin_ficha", "fuera_mp", "convenio", "ok"];

function DiferenciasIndicadores({ filas, syncDesde, syncHasta }) {
  const [datos, setDatos] = useState(null); // { lics, adj, sums } — el mundo Indicadores
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [catAbierta, setCatAbierta] = useState(null);

  async function comparar() {
    setCargando(true);
    setError("");
    try {
      const lics = (await api.get(
        "/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,estado,tipo_cliente",
      )) || [];
      const ids = lics.map((l) => Number(l.id)).filter(Boolean);
      const adj = {};  // licId → fecha de adjudicación según Indicadores (1ª OC/boleta/efectivo)
      const sums = {}; // licId → { oc, factbol } en NETO (los documentos se guardan netos)
      if (ids.length) {
        const docs = await api.post("/licitaciones/documentos/filter", {
          filter: { licitacion_ids: ids, tipo: ["orden_compra", "factura", "factura_boleta", "efectivo"] },
          fields: "licitacion_id,tipo,monto,fecha_oc,created_at",
        });
        const dia = (v) => {
          const s = String(v || "").slice(0, 10);
          return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        };
        for (const d of docs || []) {
          const lid = Number(d.licitacion_id);
          if (!lid) continue;
          const acc = (sums[lid] = sums[lid] || { oc: 0, factbol: 0 });
          const monto = Number(d.monto || 0);
          if (d.tipo === "orden_compra") acc.oc += monto;
          else acc.factbol += monto;
          // Misma regla del Panel Indicadores: adjudicada = fecha de la 1ª OC
          // (público) o de la 1ª boleta/efectivo (particular).
          if (d.tipo === "orden_compra" || d.tipo === "factura_boleta" || d.tipo === "efectivo") {
            const f = dia(d.fecha_oc) || dia(d.created_at);
            if (f && (!adj[lid] || f < adj[lid])) adj[lid] = f;
          }
        }
      }
      setDatos({ lics, adj, sums });
    } catch (e) {
      setError(e?.message || "No se pudieron cargar los datos del Panel Indicadores.");
    } finally {
      setCargando(false);
    }
  }

  const analisis = useMemo(() => {
    if (!datos) return null;
    const { lics, adj, sums } = datos;
    const enRangoDia = (d) => !!d && (!syncDesde || d >= syncDesde) && (!syncHasta || d <= syncHasta);
    const diaMp = (f) => String(f?.fecha_adjudicacion || "").slice(0, 10) || null;

    const mpPorLicId = new Map();
    const mpPorCodigo = new Map();
    for (const f of filas) {
      if (f.licitacion_id != null) mpPorLicId.set(Number(f.licitacion_id), f);
      const c = String(f.codigo_mp || "").trim().toUpperCase();
      if (c && !mpPorCodigo.has(c)) mpPorCodigo.set(c, f);
    }

    const esPart = (l) => String(l?.tipo_cliente || "").toLowerCase().includes("particular");
    // En público el adjudicado son las OC (la vista «Pública» de Indicadores
    // no mira boletas para el monto).
    const netoInd = (l) => (sums[l.id] || {}).oc || 0;
    const brutoInd = (l) => Math.round(netoInd(l) * 1.19);

    // Lado Indicadores: cierres del período SOLO de entidad pública — el
    // cruce replica la vista «Pública» de ese panel; los particulares son
    // otro negocio y solo ensuciaban la comparación (pedido 14-08).
    const indPeriodo = lics.filter((l) => !esPart(l) && enRangoDia(adj[l.id]));
    // Lado Análisis MP: ganadas del período (misma regla de este panel).
    const ganadasMp = filas.filter((f) => f.clase === "ganada" && enRangoDia(diaMp(f)));

    /* Cada proceso de cualquiera de los dos lados termina en EXACTAMENTE una
       categoría, con su "efecto" = lo que aporta al KPI de este panel menos lo
       que aporta al de Indicadores (en bruto). Así la suma de efectos cierra
       al peso contra la diferencia entre ambos KPIs: si un caso no cuadrara,
       la conciliación misma lo delata. */
    const items = [];
    const usadas = new Set(); // fichas MP ya emparejadas con un cierre del período
    /* Inconsistencias de ESTADO interno detectadas al pasar: cotizaciones que
       el sistema da por perdidas/descartadas pero cuyo acta o cuya OC dicen lo
       contrario. Se listan aparte porque son datos por corregir, no una
       diferencia entre paneles. */
    const MAL_ESTADO = new Set(["perdida", "descartada", "cancelada", "desierta"]);
    const inconsistencias = [];

    for (const l of indPeriodo) {
      const mp =
        mpPorLicId.get(Number(l.id)) ||
        mpPorCodigo.get(codigoMpDe(l.id_licitacion) || "") ||
        null;
      const bruto = brutoInd(l);
      const base = {
        codigo: String(l.id_licitacion || "").trim() || `#${l.id}`,
        licId: l.id,
        estadoInterno: l.estado || "",
        nombre: l.nombre || "",
        entidad: l.nombre_entidad || "",
        fechaInd: adj[l.id] || null,
        fechaMp: mp ? diaMp(mp) : null,
        montoInd: bruto,
        montoMp: null,
        efecto: -bruto,
      };
      if (MAL_ESTADO.has(String(l.estado || "").trim().toLowerCase())) {
        inconsistencias.push({
          codigo: base.codigo, licId: l.id, entidad: base.entidad, monto: bruto,
          detalle: `tiene OC registrada por ${fmt$(bruto)}, pero su estado interno dice «${l.estado}».`,
        });
      }
      if (!mp) {
        if (!codigoMpDe(l.id_licitacion)) {
          items.push({ ...base, cat: "fuera_mp", motivo: "La cotización no tiene código de Mercado Público (venta directa u otro canal)." });
        } else {
          items.push({ ...base, cat: "sin_ficha", motivo: "Tiene código de Mercado Público pero ninguna sincronización la ha consultado aún. Corre una sincronización que cubra la fecha de la cotización." });
        }
        continue;
      }
      const yaUsada = usadas.has(mp);
      usadas.add(mp);
      if (mp.clase !== "ganada") {
        items.push({ ...base, cat: "sin_resultado", motivo: `Hay OC registrada, pero la ficha de Mercado Público dice «${(CLASES[mp.clase] || {}).label || mp.clase}». Si el proceso ya se adjudicó, un «Forzar» actualiza la ficha.` });
        continue;
      }
      const convenio = esConvenioSuministro(mp);
      const mMp = montoGanadoDe(mp);
      if (yaUsada) {
        // Dos cotizaciones internas con OC para el MISMO proceso: el acta ya
        // se contó con la primera; esta solo resta por el lado Indicadores.
        items.push({ ...base, montoMp: mMp, cat: "monto", motivo: "Hay más de una cotización interna con OC para este mismo proceso; lo adjudicado según el acta ya se contó con la otra." });
        continue;
      }
      if (!enRangoDia(diaMp(mp))) {
        items.push({
          ...base,
          montoMp: mMp,
          cat: convenio ? "convenio" : "fecha",
          motivo: `Indicadores la cuenta en este período por su OC del ${diaLegible(adj[l.id])}; este panel la ubica ${diaMp(mp) ? `el ${diaLegible(diaMp(mp))} (fecha del acta)` : "sin fecha de adjudicación todavía"}.${convenio ? " Además es convenio de suministro, fuera del KPI de este panel." : ""}`,
        });
        continue;
      }
      // Ganada en ambos paneles dentro del período.
      const efecto = (convenio ? 0 : mMp) - bruto;
      if (convenio) {
        items.push({ ...base, montoMp: mMp, efecto, cat: "convenio", motivo: `El KPI de este panel no suma su acta (${fmt$(mMp)} es demanda estimada del período completo del convenio); Indicadores suma las OC reales que han llegado (${fmt$(bruto)} bruto).` });
      } else if (Math.abs(mMp - bruto) > Math.max(1200, 0.01 * Math.max(mMp, bruto))) {
        const sinActa = !(Number(mp?.detalle?.monto_nuestro_adjudicado) > 0) && mp.tipo !== "compra_agil";
        items.push({
          ...base, montoMp: mMp, efecto, cat: "monto",
          motivo: sinActa
            ? "La ficha se sincronizó antes de que se guardara el detalle del acta y usa nuestra oferta completa. Un «Forzar» trae el monto adjudicado real."
            : mMp > bruto
              ? "El acta adjudica más de lo que suman las OC registradas: falta subir una OC, o llegó rebajada."
              : "Las OC registradas suman más que lo adjudicado en el acta: reajustes, despacho u OC complementarias.",
        });
      } else {
        items.push({ ...base, montoMp: mMp, efecto, cat: "ok", motivo: "" });
      }
    }

    // Ganadas de este panel que Indicadores no cuenta en el período.
    for (const f of ganadasMp) {
      if (usadas.has(f)) continue;
      const lid = Number(f.licitacion_id);
      const convenio = esConvenioSuministro(f);
      const mMp = montoGanadoDe(f);
      const fechaOc = adj[lid] || null;
      const base = {
        codigo: f.codigo_mp || `#${lid}`,
        licId: lid || null,
        estadoInterno: f.interna?.estado || "",
        nombre: f.interna?.nombre || "",
        entidad: f.interna?.nombre_entidad || f.organismo || "",
        fechaInd: fechaOc,
        fechaMp: diaMp(f),
        montoInd: null,
        montoMp: mMp,
        efecto: convenio ? 0 : mMp,
      };
      if (MAL_ESTADO.has(String(f.interna?.estado || "").trim().toLowerCase())) {
        inconsistencias.push({
          codigo: base.codigo, licId: lid || null, entidad: base.entidad, monto: mMp,
          detalle: `el acta oficial nos da GANADORES por ${fmt$(mMp)}, pero su estado interno dice «${f.interna.estado}».`,
        });
      }
      if (convenio) {
        items.push({ ...base, cat: "convenio", motivo: `Fuera del KPI de este panel (acta ${fmt$(mMp)} = demanda estimada del convenio); en Indicadores ${fechaOc ? `sus OC cuentan desde el ${diaLegible(fechaOc)}` : "va a aparecer a medida que lleguen sus OC"}.` });
      } else if (fechaOc) {
        items.push({ ...base, cat: "fecha", motivo: `Este panel la cuenta por la fecha del acta (${diaLegible(diaMp(f))}); Indicadores por su OC del ${diaLegible(fechaOc)}, que cae en otro período.` });
      } else {
        items.push({ ...base, cat: "sin_oc", motivo: "Ganada según el acta, pero sin OC registrada en el sistema: en Indicadores va a aparecer recién cuando llegue la OC." });
      }
    }

    const totalIndNeto = indPeriodo.reduce((s, l) => s + netoInd(l), 0);
    const totalIndBruto = indPeriodo.reduce((s, l) => s + brutoInd(l), 0);
    const totalMp = ganadasMp.reduce((s, f) => s + (esConvenioSuministro(f) ? 0 : montoGanadoDe(f)), 0);
    const porCat = new Map();
    for (const it of items) {
      const acc = porCat.get(it.cat) || { items: [], efecto: 0 };
      acc.items.push(it);
      acc.efecto += it.efecto;
      porCat.set(it.cat, acc);
    }
    for (const acc of porCat.values()) acc.items.sort((a, b) => Math.abs(b.efecto) - Math.abs(a.efecto));
    // La conciliación se auto-verifica: la suma de los efectos debe calzar AL
    // PESO con la diferencia entre ambos KPIs. Si no calza, hay un caso mal
    // clasificado y la pantalla lo dice en vez de fingir que cuadra.
    const sumaEfectos = items.reduce((s, it) => s + (Number(it.efecto) || 0), 0);
    return { nInd: indPeriodo.length, nMp: ganadasMp.length, totalIndNeto, totalIndBruto, totalMp, porCat, inconsistencias, sumaEfectos };
  }, [datos, filas, syncDesde, syncHasta]);

  const periodoTxt = syncDesde || syncHasta
    ? `${syncDesde ? `desde ${diaLegible(syncDesde)}` : ""}${syncDesde && syncHasta ? " " : ""}${syncHasta ? `hasta ${diaLegible(syncHasta)}` : ""}`
    : "todo el histórico";
  const dif = analisis ? analisis.totalMp - analisis.totalIndBruto : 0;
  // ¿La conciliación cierra al peso? (debería siempre; si no, se avisa).
  const cierraAlPeso = analisis ? Math.round(analisis.sumaEfectos) === Math.round(dif) : false;

  // Exporta el cruce completo (todas las categorías, fila a fila) a Excel.
  async function descargarCruce() {
    if (!analisis) return;
    const filasX = [];
    for (const k of ORDEN_CATS_DIF) {
      const acc = analisis.porCat.get(k);
      if (!acc) continue;
      for (const it of acc.items) {
        filasX.push({
          "Categoría": CATS_DIF[k].label,
          "Proceso": it.codigo,
          "Cotización interna": it.licId ?? "",
          "Entidad": it.entidad || "",
          "Nombre": it.nombre || "",
          "Estado interno": it.estadoInterno || "",
          "Fecha 1ª OC": it.fechaInd || "",
          "Fecha acta": it.fechaMp || "",
          "$ Indicadores (bruto)": it.montoInd ?? "",
          "$ Análisis MP": it.montoMp ?? "",
          "Efecto en la diferencia": it.efecto,
          "Motivo": it.motivo || "",
        });
      }
    }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(filasX);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cruce adjudicadas");
    XLSX.writeFile(wb, `cruce_adjudicadas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <ArrowLeftRight size={15} style={{ color: "var(--primary)" }} /> Diferencias con el Panel Indicadores
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            Por qué las adjudicadas de ambos paneles no calzan · {periodoTxt}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {analisis && (
            <button className="btn btn-ghost" onClick={descargarCruce}
              title="Descarga el cruce completo (todas las categorías, fila a fila) en Excel"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, fontSize: 12.5 }}>
              <Download size={13} /> Excel
            </button>
          )}
          <button className="btn btn-secondary" onClick={comparar} disabled={cargando}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, fontSize: 12.5 }}>
            <RefreshCw size={13} className={cargando ? "girando" : undefined} />
            {cargando ? "Comparando…" : datos ? "Actualizar" : "Comparar"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, color: "#b91c1c", marginBottom: 10 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
        </div>
      )}

      {!analisis ? (
        <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.65 }}>
          Los dos paneles miden «adjudicado» con reglas distintas, así que sus cifras <b>nunca van a coincidir por diseño</b>:
          Indicadores cuenta cada cotización cuando se registra su <b>1ª OC</b> y suma los documentos en <b>neto</b>; este panel
          cuenta por la <b>fecha del acta de adjudicación</b> de Mercado Público, en <b>bruto</b>, y deja los convenios de
          suministro fuera del KPI. <b>Comparar</b> cruza ambos mundos proceso por proceso —contra la vista <b>Pública</b> de
          Indicadores; los clientes particulares quedan fuera— y explica cada diferencia del período: cuáles son y por qué existen.
        </div>
      ) : (
        <>
          {/* Resumen: los dos KPIs frente a frente y la diferencia conciliada. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 12 }}>
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 13px" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Panel Indicadores · Pública · {periodoTxt}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{analisis.nInd} adjudicadas · {fmt$(analisis.totalIndBruto)}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                OC llevadas a bruto — ese panel las muestra en neto: {fmt$(analisis.totalIndNeto)}
              </div>
            </div>
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 13px" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Análisis Mercado Público</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{analisis.nMp} ganadas · {fmt$(analisis.totalMp)}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>KPI «adjudicado» de este panel (bruto, sin convenios)</div>
            </div>
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 13px" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Diferencia</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: dif === 0 ? "#15803d" : "var(--primary-dark)" }}>
                {dif > 0 ? "+" : ""}{fmt$(dif)}
              </div>
              {/* La conciliación se verifica sola: si la suma de efectos no
                  calza al peso, se dice — nunca fingir que cuadra. */}
              <div style={{ fontSize: 10.5, fontWeight: 700, color: cierraAlPeso ? "#15803d" : "#b91c1c" }}>
                {cierraAlPeso
                  ? "✓ conciliada al peso por las categorías de abajo"
                  : `⚠ la suma de causas da ${fmt$(analisis.sumaEfectos)}: hay un caso sin clasificar`}
              </div>
            </div>
          </div>

          {/* Barra de conciliación: cuánto pesa cada causa en la diferencia
              (proporcional al valor absoluto de su efecto). */}
          {(() => {
            const cats = ORDEN_CATS_DIF
              .filter((k) => analisis.porCat.has(k))
              .map((k) => ({ k, c: CATS_DIF[k], ...analisis.porCat.get(k) }))
              .filter((x) => Math.abs(x.efecto) > 0);
            if (!cats.length) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                  {cats.map((x) => (
                    <span
                      key={x.k}
                      title={`${x.c.label}: ${x.efecto > 0 ? "+" : "−"}${fmt$(Math.abs(x.efecto))} (${x.items.length} proceso${x.items.length === 1 ? "" : "s"})`}
                      style={{ flex: `${Math.abs(x.efecto)} 0 2px`, background: x.c.color, minWidth: 3 }}
                    />
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                  {cats.map((x) => (
                    <span key={x.k} style={{ whiteSpace: "nowrap" }}>
                      <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: x.c.color, marginRight: 5, verticalAlign: "-1px" }} />
                      {x.c.label} {x.efecto > 0 ? "+" : "−"}{fmt$(Math.abs(x.efecto))}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Datos por corregir detectados de pasada: estados internos que
              contradicen lo que dicen el acta o las OC. No son diferencia
              entre paneles, son cotizaciones mal cerradas en el sistema. */}
          {analisis.inconsistencias.length > 0 && (
            <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <AlertTriangle size={14} />
                {analisis.inconsistencias.length} cotización{analisis.inconsistencias.length === 1 ? "" : "es"} con estado interno por corregir
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
                {analisis.inconsistencias.map((x) => (
                  <div key={`${x.codigo}-${x.licId}`}>
                    {x.licId ? (
                      <a href={`/detalle/${x.licId}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontWeight: 700, color: "#92400e" }}
                        title="Abrir la cotización en una pestaña nueva para corregir su estado">
                        {x.codigo}
                      </a>
                    ) : (
                      <b>{x.codigo}</b>
                    )}
                    {x.entidad ? ` (${x.entidad})` : ""}: {x.detalle}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Aviso de cobertura: muchas «sin ficha» no son un error del cruce,
              son histórico que la sincronización (desde el mes anterior por
              defecto) nunca consultó. */}
          {(analisis.porCat.get("sin_ficha")?.items.length || 0) >= 10 && (
            <div style={{ border: "1px solid var(--border)", background: "var(--neutral-bg)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "var(--text-soft)", lineHeight: 1.55 }}>
              <b>{analisis.porCat.get("sin_ficha").items.length} procesos sin ficha:</b> la sincronización automática
              cubre desde el día 1 del mes anterior, así que las adjudicadas más antiguas del rango elegido nunca se han
              consultado contra Mercado Público. Para rellenar ese histórico hay que correr una sincronización que cubra
              esas fechas.
            </div>
          )}

          {/* Categorías: cada una explica un porqué; clic para ver los procesos. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ORDEN_CATS_DIF.filter((k) => analisis.porCat.has(k)).map((k) => {
              const c = CATS_DIF[k];
              const { items: its, efecto } = analisis.porCat.get(k);
              const abierta = catAbierta === k;
              return (
                <div key={k} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div onClick={() => setCatAbierta(abierta ? null : k)}
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", cursor: "pointer", background: abierta ? "var(--bg)" : "transparent", flexWrap: "wrap" }}>
                    {abierta ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} style={{ flexShrink: 0 }} />}
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{its.length} proceso{its.length === 1 ? "" : "s"}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, marginLeft: "auto", color: efecto === 0 ? "var(--text-muted)" : efecto > 0 ? "#15803d" : "#b91c1c", whiteSpace: "nowrap" }}
                      title="Cuánto explica esta categoría de la diferencia total (positivo = suma a este panel; negativo = suma a Indicadores)">
                      {efecto > 0 ? "+" : efecto < 0 ? "−" : ""}{efecto === 0 ? "sin efecto en $" : fmt$(Math.abs(efecto))}
                    </span>
                    <span style={{ flexBasis: "100%", fontSize: 11, color: "var(--text-muted)", paddingLeft: 23 }}>{c.explica}</span>
                  </div>
                  {abierta && (
                    <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, whiteSpace: "nowrap" }}>
                        <thead>
                          <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                            <th style={{ padding: "7px 12px", fontWeight: 600 }}>Proceso</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600 }}>Entidad</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600 }} title="Estado de la cotización interna en el sistema">Estado</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600 }} title="Fecha de la 1ª OC (criterio Indicadores)">OC</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600 }} title="Fecha del acta de adjudicación (criterio de este panel)">Acta</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600, textAlign: "right" }} title="Lo que suma en el Panel Indicadores, llevado a bruto">$ Indicadores</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600, textAlign: "right" }} title="Lo que suma en el KPI de este panel">$ Análisis MP</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600, textAlign: "right" }} title="Cuánto aporta esta fila a la diferencia total (positivo = suma a este panel; negativo = a Indicadores)">Efecto</th>
                            <th style={{ padding: "7px 12px", fontWeight: 600, minWidth: 260, whiteSpace: "normal" }}>Por qué</th>
                          </tr>
                        </thead>
                        <tbody>
                          {its.map((it, i) => (
                            <tr key={`${it.codigo}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={{ padding: "7px 12px" }}>
                                {/* El código abre la cotización interna en una
                                    pestaña nueva, para sanear el dato sin
                                    perder el cruce en pantalla. */}
                                {it.licId ? (
                                  <a href={`/detalle/${it.licId}`} target="_blank" rel="noopener noreferrer"
                                    className="table-link" style={{ fontWeight: 600 }}
                                    title="Abrir el detalle de la cotización en una pestaña nueva">
                                    {it.codigo}
                                  </a>
                                ) : (
                                  <span style={{ fontWeight: 600 }}>{it.codigo}</span>
                                )}
                                {it.nombre && <div style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{it.nombre}</div>}
                              </td>
                              <td style={{ padding: "7px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{it.entidad || "—"}</td>
                              <td style={{ padding: "7px 12px", fontSize: 11.5, color: "var(--text-muted)" }}>{it.estadoInterno || "—"}</td>
                              <td style={{ padding: "7px 12px" }}>{it.fechaInd ? diaLegible(it.fechaInd) : "—"}</td>
                              <td style={{ padding: "7px 12px" }}>{it.fechaMp ? diaLegible(it.fechaMp) : "—"}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right" }}>{it.montoInd != null ? fmt$(it.montoInd) : "—"}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right" }}>{it.montoMp != null ? fmt$(it.montoMp) : "—"}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600, color: it.efecto === 0 ? "var(--text-muted)" : it.efecto > 0 ? "#15803d" : "#b91c1c" }}>
                                {it.efecto === 0 ? "—" : `${it.efecto > 0 ? "+" : "−"}${fmt$(Math.abs(it.efecto))}`}
                              </td>
                              <td style={{ padding: "7px 12px", whiteSpace: "normal", minWidth: 260, maxWidth: 420, fontSize: 11.5, color: "var(--text-soft)", lineHeight: 1.45 }}>{it.motivo || "Mismo monto en ambos."}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 9, lineHeight: 1.5 }}>
            Cruce contra la vista <b>Pública</b> de Indicadores (los clientes particulares quedan fuera). Montos comparados
            en <b>bruto</b>: las OC se guardan en neto y aquí se llevan a ×1,19 para que el IVA no aparezca como diferencia.
            La foto de Indicadores es la de este momento («Actualizar» la refresca); el período usa el mismo rango de fecha
            del panel.
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, tono, fondo, label, valor, sub, onClick, activo }) {
  return (
    <div onClick={onClick}
      title={onClick ? "Clic para filtrar la tabla" : undefined}
      style={{
        border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "13px 15px",
        display: "flex", gap: 12, alignItems: "center",
        cursor: onClick ? "pointer" : "default",
        boxShadow: activo ? `0 0 0 2px ${tono}66` : undefined,
        transition: "box-shadow .15s ease",
      }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: fondo, color: tono, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15 }}>{valor}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
    </div>
  );
}

function Panel({ titulo, sub, extra, children }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, gap: 8 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{sub}</div>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Vacio({ texto }) {
  return <div style={{ padding: "26px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 12.5 }}>{texto}</div>;
}

// Cabecera de columna ordenable.
function ThOrden({ campo, orden, onOrden, right, children }) {
  const activo = orden.campo === campo;
  const Flecha = !activo ? ArrowUpDown : orden.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="mp-th-orden" onClick={() => onOrden(campo)} style={{ textAlign: right ? "right" : "left" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: activo ? "var(--text)" : undefined }}>
        {children}
        <Flecha size={11} style={{ opacity: activo ? 1 : 0.4, flexShrink: 0 }} />
      </span>
    </th>
  );
}

// Barras verticales apiladas por mes: ganadas / perdidas / resto.
function TendenciaMensual({ meses }) {
  const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const max = Math.max(...meses.map((m) => m.ganadas + m.perdidas + m.otras), 1);
  const ALTO = 110;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: ALTO + 34, paddingTop: 6 }}>
        {meses.map((m) => {
          const total = m.ganadas + m.perdidas + m.otras;
          const [anio, mes] = m.key.split("-");
          const h = (v) => Math.round((v / max) * ALTO);
          return (
            <div key={m.key} style={{ flex: 1, minWidth: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
              title={`${MESES_CORTOS[Number(mes) - 1]} ${anio}: ${m.ganadas} ganadas · ${m.perdidas} perdidas · ${m.otras} otras`}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>{total}</div>
              <div style={{ width: "100%", maxWidth: 34, display: "flex", flexDirection: "column", justifyContent: "flex-end", borderRadius: 6, overflow: "hidden" }}>
                {m.otras > 0 && <div style={{ height: h(m.otras), background: "#cbd5e1" }} />}
                {m.perdidas > 0 && <div style={{ height: h(m.perdidas), background: "#ef4444" }} />}
                {m.ganadas > 0 && <div style={{ height: h(m.ganadas), background: "#15803d" }} />}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {MESES_CORTOS[Number(mes) - 1]} {String(anio).slice(2)}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "var(--text-muted)" }}>
        <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: "#15803d", marginRight: 5 }} />Ganadas</span>
        <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: "#ef4444", marginRight: 5 }} />Perdidas</span>
        <span><i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: "#cbd5e1", marginRight: 5 }} />En curso / otras</span>
      </div>
    </div>
  );
}

// Dona SVG: ganadas / perdidas / en curso / otras.
function DonaResultados({ filas, porMonto }) {
  const partes = [
    { clase: "ganada", color: "#15803d" },
    { clase: "perdida", color: "#ef4444" },
    { clase: "en_curso", color: "#f59e0b" },
    { clase: "sin_efecto", color: "#94a3b8" },
    { clase: "sin_participar", color: "#8b5cf6" },
  ].map((p) => {
    const del = filas.filter((f) => f.clase === p.clase);
    const valor = porMonto
      ? del.reduce((s, f) => s + (f.clase === "ganada"
          // Convenios fuera también aquí: su demanda estimada de 24 meses
          // aplastaría al resto de la dona.
          ? (esConvenioSuministro(f) ? 0 : montoGanadoDe(f))
          : Number(f.clase === "perdida" ? f.monto_ganador : f.monto_nuestro) || 0), 0)
      : del.length;
    return { ...p, label: CLASES[p.clase].label, valor };
  }).filter((p) => p.valor > 0);

  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) return <Vacio texto="Sin procesos clasificados todavía." />;

  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const ganadas = filas.filter((f) => f.clase === "ganada").length;
  const decididas = ganadas + filas.filter((f) => f.clase === "perdida").length;
  const tasa = decididas ? Math.round((ganadas / decididas) * 100) : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flexShrink: 0 }}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--border)" strokeWidth="16" />
        {partes.map((p) => {
          const frac = p.valor / total;
          const el = (
            <circle key={p.clase} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-offset * C}
              transform="rotate(-90 70 70)" strokeLinecap="butt" />
          );
          offset += frac;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "var(--text)" }}>
          {tasa == null ? "—" : `${tasa}%`}
        </text>
        <text x="70" y="84" textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--text-muted)", fontWeight: 600 }}>
          tasa de éxito
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
        {partes.map((p) => (
          <div key={p.clase} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{p.label}</span>
            <b>{porMonto ? fmt$(p.valor) : p.valor}</b>
            <span style={{ color: "var(--text-muted)", fontSize: 11.5, width: 38, textAlign: "right" }}>
              {((p.valor / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Simulador de precio: probabilidad de ganar según descuento ──────────
   Modelo empírico sobre los procesos DECIDIDOS sincronizados: para cada
   perdida se calcula el descuento que habría hecho nuestra oferta más barata
   que la ganadora (d = 1 − ganador/nuestro). La curva P(d) = fracción de
   procesos que habríamos ganado aplicando un descuento d parejo. El "punto
   óptimo" maximiza el valor esperado P(d) × (1 − d): más allá de él, cada
   punto de descuento extra cuesta más margen del que aporta en victorias. */
function SimuladorPrecio({ filas }) {
  const [tipo, setTipo] = useState("");
  const [organismo, setOrganismo] = useState("");
  const [descuento, setDescuento] = useState(5);
  // Margen bruto de referencia: el punto óptimo maximiza la utilidad esperada
  // P(d) × (margen − d); sin él, la curva empuja siempre al descuento máximo.
  const [margen, setMargen] = useState(30);
  // Recomendación generada por DamarIA (modelo generativo) sobre la curva.
  const [recom, setRecom] = useState("");
  const [cargandoRecom, setCargandoRecom] = useState(false);
  const [errorRecom, setErrorRecom] = useState("");

  // Si cambian los filtros o el margen, la recomendación anterior ya no aplica.
  useEffect(() => { setRecom(""); setErrorRecom(""); }, [tipo, organismo, margen]);

  const organismos = useMemo(() => {
    const cnt = new Map();
    for (const f of filas) {
      if (f.clase !== "ganada" && f.clase !== "perdida") continue;
      const o = (f.organismo || "").trim();
      if (o) cnt.set(o, (cnt.get(o) || 0) + 1);
    }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [filas]);

  const sim = useMemo(() => {
    const base = filas.filter((f) => {
      if (f.clase !== "ganada" && f.clase !== "perdida") return false;
      if (tipo && f.tipo !== tipo) return false;
      if (organismo && (f.organismo || "").trim() !== organismo) return false;
      const n = Number(f.monto_nuestro), w = Number(f.monto_ganador);
      return Number.isFinite(n) && n > 0 && Number.isFinite(w) && w > 0;
    });
    // Perdidas donde éramos más baratos igual: el precio no las explica
    // (inadmisibilidad u otro criterio del comprador) — nunca se "ganan"
    // bajando el precio en este modelo.
    const inmunes = base.filter((f) => f.clase === "perdida" && Number(f.monto_nuestro) <= Number(f.monto_ganador)).length;
    const puntos = [];
    for (let d = 0; d <= 25; d++) {
      const frac = d / 100;
      const ganariamos = base.filter((f) => {
        if (f.clase === "ganada") return true;
        const dNec = 1 - Number(f.monto_ganador) / Number(f.monto_nuestro);
        return dNec > 0 && frac >= dNec - 1e-9;
      }).length;
      puntos.push({ d, ganariamos, prob: base.length ? ganariamos / base.length : 0 });
    }
    // Punto óptimo: maximiza la utilidad esperada P(d) × (margen − d), solo
    // dentro de descuentos que dejan margen positivo.
    let mejor = puntos[0];
    for (const p of puntos) {
      if (p.d >= margen) break;
      if (p.prob * (margen - p.d) > mejor.prob * (margen - mejor.d) + 1e-9) mejor = p;
    }
    return { base, puntos, mejor, inmunes };
  }, [filas, tipo, organismo, margen]);

  const actual = sim.puntos[descuento] || sim.puntos[0];
  const sinDatos = sim.base.length < 5;

  // Arma un resumen compacto con los números YA calculados y se lo pasa a
  // DamarIA para que redacte la recomendación estratégica (la aritmética la
  // pone la estadística; la interpretación, la IA).
  async function pedirRecomendacion() {
    if (cargandoRecom || sinDatos) return;
    setCargandoRecom(true);
    setErrorRecom("");
    try {
      const ganadas = sim.base.filter((f) => f.clase === "ganada");
      const perdidas = sim.base.filter((f) => f.clase === "perdida");
      // Descuento que habría hecho falta en cada perdida "por precio".
      const dNecesarios = perdidas
        .map((f) => (1 - Number(f.monto_ganador) / Number(f.monto_nuestro)) * 100)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const pctl = (p) => (dNecesarios.length ? Number(dNecesarios[Math.min(dNecesarios.length - 1, Math.floor((p / 100) * dNecesarios.length))].toFixed(1)) : null);

      const porOrg = new Map();
      for (const f of sim.base) {
        const o = (f.organismo || "").trim() || "(sin organismo)";
        const e = porOrg.get(o) || { organismo: o, ganadas: 0, perdidas: 0, brechas: [], monto_perdido: 0, monto_ganado: 0 };
        if (f.clase === "ganada") {
          e.ganadas += 1;
          if (!esConvenioSuministro(f)) e.monto_ganado += montoGanadoDe(f);
        } else {
          e.perdidas += 1;
          e.monto_perdido += Number(f.monto_ganador) || 0;
          if (Number.isFinite(f.brecha) && f.brecha > 0) e.brechas.push(f.brecha);
        }
        porOrg.set(o, e);
      }
      const compet = new Map();
      for (const f of perdidas) {
        if (!f.ganador_nombre) continue;
        const e = compet.get(f.ganador_nombre) || { nombre: f.ganador_nombre, veces: 0, monto: 0, es_emt: !!f.ganador_es_emt };
        e.veces += 1;
        e.monto += Number(f.monto_ganador) || 0;
        compet.set(f.ganador_nombre, e);
      }
      const porTipo = {};
      for (const t of ["compra_agil", "licitacion"]) {
        const del = sim.base.filter((f) => f.tipo === t);
        if (del.length) porTipo[t] = { decididos: del.length, ganadas: del.filter((f) => f.clase === "ganada").length };
      }

      const resumen = {
        filtro: { tipo: tipo || "todos", organismo: organismo || "todos" },
        margen_bruto_asumido_pct: margen,
        procesos_decididos: sim.base.length,
        ganadas: ganadas.length,
        perdidas: perdidas.length,
        tasa_exito_actual_pct: Math.round((ganadas.length / sim.base.length) * 100),
        // Causa de las perdidas: cuántas se explican por precio y cuántas no.
        perdidas_por_precio: dNecesarios.length,
        perdidas_no_precio: sim.inmunes,
        casi_ganadas_brecha_menor_5pct: dNecesarios.filter((d) => d <= 5).length,
        // Qué descuento habría hecho falta (distribución de las perdidas por precio).
        descuento_necesario_pctl: { p25: pctl(25), mediana: pctl(50), p75: pctl(75) },
        montos_clp: {
          ganado_total: ganadas.reduce((s, f) => s + (esConvenioSuministro(f) ? 0 : montoGanadoDe(f)), 0),
          convenios_suministro_estimado_periodo_completo: ganadas.reduce((s, f) => s + (esConvenioSuministro(f) ? montoGanadoDe(f) : 0), 0),
          perdido_total_se_lo_llevo_competencia: perdidas.reduce((s, f) => s + (Number(f.monto_ganador) || 0), 0),
        },
        por_tipo: porTipo,
        curva_probabilidad: sim.puntos
          .filter((p) => p.d % 2 === 0)
          .map((p) => ({ descuento_pct: p.d, prob_ganar_pct: Math.round(p.prob * 100), procesos_que_ganariamos: p.ganariamos })),
        punto_optimo_descuento_pct: sim.mejor.d,
        perdidas_mas_estrechas: perdidas
          .filter((f) => Number.isFinite(f.brecha) && f.brecha > 0)
          .sort((a, b) => a.brecha - b.brecha)
          .slice(0, 8)
          .map((f) => ({
            codigo: f.codigo_mp,
            organismo: f.organismo || null,
            brecha_pct: Number(f.brecha.toFixed(1)),
            monto_ganador_clp: Number(f.monto_ganador) || null,
          })),
        organismos_top: [...porOrg.values()]
          .sort((a, b) => b.ganadas + b.perdidas - (a.ganadas + a.perdidas))
          .slice(0, 10)
          .map((e) => ({
            organismo: e.organismo,
            ganadas: e.ganadas,
            perdidas: e.perdidas,
            brecha_prom_al_perder_pct: e.brechas.length
              ? Number((e.brechas.reduce((s, b) => s + b, 0) / e.brechas.length).toFixed(1))
              : null,
            monto_ganado_clp: e.monto_ganado,
            monto_perdido_clp: e.monto_perdido,
          })),
        competidores_top: [...compet.values()]
          .sort((a, b) => b.veces - a.veces || b.monto - a.monto)
          .slice(0, 8)
          .map((c) => ({ nombre: c.nombre, veces: c.veces, monto_clp: c.monto, es_emt: c.es_emt })),
      };
      const res = await api.post("/ia/recomendacion-precios", { resumen });
      setRecom(String(res?.recomendacion || ""));
    } catch (e) {
      setErrorRecom(e?.message || "DamarIA no pudo generar la recomendación.");
    } finally {
      setCargandoRecom(false);
    }
  }

  // Curva SVG: x = descuento 0–25%, y = probabilidad 0–100%.
  const W = 340, H = 150, PX = 34, PY = 14;
  const x = (d) => PX + (d / 25) * (W - PX - 10);
  const y = (p) => H - PY - p * (H - 2 * PY - 8);
  const linea = sim.puntos.map((p) => `${x(p.d).toFixed(1)},${y(p.prob).toFixed(1)}`).join(" ");

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <SunflowerIcon size={16} /> Simulador de precio · DamarIA
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            DamarIA estima la probabilidad de ganar según el descuento, con {sim.base.length} proceso{sim.base.length === 1 ? "" : "s"} decidido{sim.base.length === 1 ? "" : "s"} del período sincronizado
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" style={{ height: 34, fontSize: 12.5 }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Ambos tipos</option>
            <option value="compra_agil">Compra Ágil</option>
            <option value="licitacion">Licitación</option>
          </select>
          <select className="input" style={{ height: 34, fontSize: 12.5, maxWidth: 260 }} value={organismo} onChange={(e) => setOrganismo(e.target.value)}>
            <option value="">Todos los organismos</option>
            {organismos.map(([o, n]) => <option key={o} value={o}>{o.length > 40 ? `${o.slice(0, 40)}…` : o} ({n})</option>)}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}
            title="Margen bruto promedio de tus productos: define hasta dónde tiene sentido descontar">
            Margen bruto
            <input type="number" className="input" min={5} max={80} step={1} value={margen}
              onChange={(e) => setMargen(Math.max(5, Math.min(80, Number(e.target.value) || 0)))}
              style={{ height: 34, width: 64, fontSize: 12.5 }} />
            %
          </label>
        </div>
      </div>

      {sinDatos ? (
        <Vacio texto="DamarIA necesita al menos 5 procesos decididos con montos para simular. Sincroniza más período o quita filtros." />
      ) : (
        // Las dos columnas sumaban 560px mínimos; .layout-par las pone una
        // debajo de la otra en cuanto dejan de caber.
        <div className="layout-par" style={{ gap: 18, alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
              Descuento sobre nuestros precios: <span style={{ color: "var(--primary-dark)" }}>−{descuento}%</span>
            </label>
            <input type="range" min={0} max={25} step={1} value={descuento}
              onChange={(e) => setDescuento(Number(e.target.value))} style={{ width: "100%" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
              <div style={{ background: "var(--bg)", borderRadius: 10, padding: "9px 12px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Probabilidad de ganar</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: actual.prob >= 0.5 ? "#15803d" : "#b45309" }}>
                  {(actual.prob * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{actual.ganariamos} de {sim.base.length} procesos</div>
              </div>
              <div style={{ background: "var(--bg)", borderRadius: 10, padding: "9px 12px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Punto óptimo</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--primary-dark)" }}>−{sim.mejor.d}%</div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  maximiza la utilidad esperada con margen {margen}% ({(sim.mejor.prob * 100).toFixed(0)}% de éxito)
                </div>
              </div>
            </div>
            {sim.inmunes > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.45 }}>
                <AlertTriangle size={11} style={{ verticalAlign: -1, color: "#b45309" }} /> {sim.inmunes} perdida{sim.inmunes === 1 ? "" : "s"} no se explica{sim.inmunes === 1 ? "" : "n"} por precio
                (éramos más baratos e igual perdimos: inadmisibilidad u otro criterio) — ningún descuento las gana.
              </div>
            )}
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <g key={p}>
                <line x1={PX} y1={y(p)} x2={W - 10} y2={y(p)} stroke="var(--border)" strokeWidth="1" strokeDasharray={p === 0 ? "" : "3 4"} />
                <text x={PX - 5} y={y(p) + 3} textAnchor="end" style={{ fontSize: 8.5, fill: "var(--text-muted)" }}>{(p * 100).toFixed(0)}%</text>
              </g>
            ))}
            {[0, 5, 10, 15, 20, 25].map((d) => (
              <text key={d} x={x(d)} y={H - 1} textAnchor="middle" style={{ fontSize: 8.5, fill: "var(--text-muted)" }}>−{d}%</text>
            ))}
            <polygon points={`${x(0)},${y(0)} ${linea} ${x(25)},${y(0)}`} fill="var(--primary)" opacity="0.12" />
            <polyline points={linea} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinejoin="round" />
            {/* Punto óptimo */}
            <line x1={x(sim.mejor.d)} y1={y(0)} x2={x(sim.mejor.d)} y2={y(sim.mejor.prob)} stroke="#15803d" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(sim.mejor.d)} cy={y(sim.mejor.prob)} r="4" fill="#15803d" />
            {/* Descuento seleccionado */}
            <circle cx={x(actual.d)} cy={y(actual.prob)} r="5" fill="var(--surface)" stroke="var(--primary-dark)" strokeWidth="2.5" />
          </svg>
        </div>
      )}

      {!sinDatos && (
        <div style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
          {!recom && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={pedirRecomendacion}
              disabled={cargandoRecom}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5 }}
            >
              <SunflowerIcon size={15} />
              {cargandoRecom ? "DamarIA está analizando a fondo (tarda ±1 minuto)…" : "Pedir recomendación a DamarIA"}
            </button>
          )}
          {errorRecom && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: "#b91c1c" }}>{errorRecom}</div>
          )}
          {recom && (
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SunflowerIcon size={14} /> Recomendación de DamarIA
                </div>
                <button type="button" className="btn btn-ghost" onClick={pedirRecomendacion} disabled={cargandoRecom}
                  style={{ fontSize: 11.5, padding: "3px 10px" }}>
                  {cargandoRecom ? "Analizando…" : "Actualizar"}
                </button>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{recom}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Barra horizontal con etiqueta, valor y click para filtrar.
function BarraH({ etiqueta, detalle, valor, max, texto, color, onClick }) {
  const pct = max > 0 ? Math.max(6, (valor / max) * 100) : 0;
  return (
    <div onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }} title={detalle}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 2 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{etiqueta}</span>
        <b style={{ color }}>{texto}</b>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--bg)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${color}99, ${color})` }} />
      </div>
    </div>
  );
}
