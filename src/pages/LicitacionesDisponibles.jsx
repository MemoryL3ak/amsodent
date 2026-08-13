// LicitacionesDisponibles.jsx
// Listado de licitaciones "disponibles" (publicadas) que se sube por xlsx
// (columnas ID + Nombre). Los ejecutivos ven el listado y "cargan" cada
// licitación, lo que abre una Nueva Cotización prellenada y marca la fila.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { replicarEnWhatsApp } from "../lib/chatWhatsapp";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import DateFilter from "../components/DateFilter";
import ConfirmModal from "../components/ConfirmModal";
import { Upload, Search, FileSpreadsheet, Trash2, X, ClipboardList, Check, RotateCcw, Ban, FilePlus2, ExternalLink, FileDown, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

function fmtFecha(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ¿El dato de cierre del xlsx trae hora explícita? (parseCierre asume 23:59
// cuando no hay hora, por eso solo mostramos la hora si venía en el origen.)
// Acepta año de 4 o de 2 dígitos ("27-07-26 11:30").
function cierreTraeHora(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  return /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}[ T]\d{1,2}:\d{2}/.test(s) || /\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(s);
}

// Fecha con hora opcional (24h). Si conHora es false, solo la fecha.
function fmtFechaHora(v, conHora) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const fecha = d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (!conHora) return fecha;
  const hora = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fecha} ${hora}`;
}

/* Respaldo de la vista del explorador entre navegaciones. El resultado de una
   búsqueda manual vivía solo en el estado de la pantalla: con salir a otra
   sección y volver, 4 minutos de búsqueda desaparecían. sessionStorage
   sobrevive a la navegación y a un F5, y muere solo con la pestaña del
   navegador — justo el ciclo de vida que uno espera de una búsqueda. */
const MP_VISTA_CACHE = "exploracionMpVista";
const MP_VISTA_CACHE_MS = 6 * 3600 * 1000; // más vieja que esto ya no informa

function leerVistaExploracion() {
  try {
    const j = JSON.parse(sessionStorage.getItem(MP_VISTA_CACHE) || "null");
    if (!j || Date.now() - (j.ts || 0) > MP_VISTA_CACHE_MS) return null;
    return j;
  } catch {
    return null;
  }
}

/* Tiempo restante en palabras. Redondeado a propósito: es una estimación que
   se recalcula con el ritmo real de las tandas ya respondidas, no un
   cronómetro. (Mismo formato que usa la sincronización del Análisis.) */
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

// Interpreta la fecha de "Cierre" que viene del xlsx (datos.cierre). Acepta
// "DD-MM-YYYY[ HH:mm]", "DD-MM-YY HH:mm" (año de 2 dígitos, formato actual
// del portal), "DD/MM/YYYY", ISO "YYYY-MM-DD..." y timestamps.
// Devuelve un Date o null si no se puede interpretar.
function parseCierre(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // DD-MM-YYYY o DD-MM-YY (también con "/"), con hora opcional.
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh = "23", mi = "59"] = m;
    const anio = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(anio, Number(mm) - 1, Number(dd), Number(hh), Number(mi));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Día local en formato AAAA-MM-DD, para comparar contra los valores que
// entrega el selector de fechas. No sirve `toISOString()`: pasa a UTC y en
// Chile adelanta el día para cualquier cierre desde las 21:00.
function diaLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Una postulación está "vigente" si su cierre aún no pasa (o si no tiene fecha
// de cierre registrada, para no ocultarla por falta de dato). Si el cierre
// trae hora, la vigencia respeta la hora exacta; sin hora, dura hasta las
// 23:59 de ese día (default de parseCierre).
function estaVigente(row) {
  const cierre = parseCierre(row?.datos?.cierre);
  if (!cierre) return true;
  return cierre.getTime() >= Date.now();
}

// Nombre legible de quien tomó una postulación. El correo completo no cabe en
// la columna de estado y se cortaba a la mitad, que era justo lo que había que
// leer: quién la tiene.
function nombreDe(email) {
  const usuario = String(email || "").split("@")[0];
  if (!usuario) return "";
  return usuario
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// Regiones de la API de Mercado Público (código 1-16).
const MP_REGIONES = [
  [13, "Metropolitana"], [1, "Tarapacá"], [2, "Antofagasta"], [3, "Atacama"],
  [4, "Coquimbo"], [5, "Valparaíso"], [6, "O'Higgins"], [7, "Maule"],
  [8, "Biobío"], [9, "Araucanía"], [10, "Los Lagos"], [11, "Aysén"],
  [12, "Magallanes y Antártica"], [14, "Los Ríos"], [15, "Arica y Parinacota"], [16, "Ñuble"],
];

// Keywords sugeridas para el rubro. La API busca por PALABRA COMPLETA en
// nombre/descripción; el backend agrega solo la variante singular/plural de
// cada keyword (dental → dentales), así que deben ser palabras reales.
// Fallback del catálogo de palabras clave, usado solo si la tabla mp_keywords
// no está disponible (migración sin aplicar). El catálogo real vive en la base
// y se administra desde esta misma pantalla.
const MP_KEYWORDS_FALLBACK = ["dental", "odontología", "insumos dentales", "resina", "anestesia", "ortodoncia", "implante", "fresas"]
  .map((texto, i) => ({ id: `fb-${i}`, texto }));

export default function LicitacionesDisponibles({ embedded = false }) {
  const navigate = useNavigate();
  const { rol, user, perfil } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  // Ver y "tomar" está disponible para todo el equipo. La gestión (subir
  // listado, desmarcar, eliminar) queda para administración y jefatura de ventas.
  const esGestor = ["admin", "administrador", "jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const currentEmail = (user?.email || "").toString().trim().toLowerCase();
  const MAX_TOMADAS = 3;

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("pendientes"); // pendientes | mias | cargadas | caducadas | no_aplica | todas
  const [filtroTipo, setFiltroTipo] = useState(""); // tipo de licitación (datos.tipo del xlsx)
  const [dispon, setDispon] = useState("vigentes"); // vigentes | vencidas | todas (por fecha de cierre)
  // Orden por fecha de cierre. null = orden natural (mis tomadas primero, ver
  // el efecto de abajo); "asc" = las que cierran antes arriba, que es lo útil
  // para priorizar qué postular; "desc" = al revés.
  const [ordenCierre, setOrdenCierre] = useState(null);
  const [fechaDesde, setFechaDesde] = useState(""); // filtro por fecha de carga del archivo
  const [fechaHasta, setFechaHasta] = useState("");
  // Filtro por la fecha de CIERRE del portal (datos.cierre), distinta de la de
  // carga: sirve para ver "qué cierra esta semana" y priorizar.
  const [cierreDesde, setCierreDesde] = useState("");
  const [cierreHasta, setCierreHasta] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [progresoVerif, setProgresoVerif] = useState(null); // { revisadas, restantes }
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [loadSeq, setLoadSeq] = useState(0); // se incrementa en cada carga (no en cada toma)
  const [confirmTomar, setConfirmTomar] = useState(null); // fila a confirmar antes de tomar
  const [confirmNoAplica, setConfirmNoAplica] = useState(null); // fila a confirmar antes de marcar "No Aplica"
  const [confirmBorrarTodas, setConfirmBorrarTodas] = useState(false);
  const [creadasHoy, setCreadasHoy] = useState(0); // cotizaciones creadas hoy por el usuario
  // Botón junto al ID: abre la ficha del proceso en mercadopublico.cl (nueva
  // pestaña), usando la columna "URL Ficha" que trae el xlsx del portal.
  function abrirPortalMP(row) {
    const url = String(row?.datos?.url_ficha || "").trim();
    if (/^https?:\/\//i.test(url)) {
      window.open(url, "_blank", "noopener");
      return;
    }
    setToast({
      type: "error",
      message: "Esta postulación no trae la URL de la ficha; vuelve a subir el listado con la columna \"URL Ficha\" del portal.",
    });
  }

  // Click en el ID: popup con la ficha completa consultada en vivo a Mercado
  // Público (API Licitaciones v1 para LE/LP/LQ, API Compra Ágil v2 para COT;
  // el ticket vive en el backend, env MERCADO_PUBLICO_TICKET).
  const [mpFicha, setMpFicha] = useState(null); // { codigo, urlFicha, loading, data, error }
  const [descargandoFicha, setDescargandoFicha] = useState(false);

  // ── Sección "Explorar Mercado Público": búsqueda en vivo vía la API ──
  const [vista, setVista] = useState("listado"); // listado | explorar
  // todas = Compra Ágil + Licitaciones en una sola tabla (por defecto: es la
  // vista completa del mercado y cada fila indica su tipo).
  const [mpFuente, setMpFuente] = useState("todas"); // todas | agil | licitaciones
  const [mpQ, setMpQ] = useState("");
  const [mpRegion, setMpRegion] = useState("");
  const [mpEstado, setMpEstado] = useState("publicada");
  // Rango por fecha de publicación (igual que el buscador del portal, para
  // poder comparar búsquedas y obtener los mismos resultados).
  const [mpDesde, setMpDesde] = useState("");
  const [mpHasta, setMpHasta] = useState("");
  // { items, paginacion, por_keyword, actualizado } — arranca con lo que haya
  // respaldado en la sesión, así volver a esta pantalla no borra la búsqueda.
  const [mpRes, setMpRes] = useState(() => leerVistaExploracion()?.res || null);
  // Catálogo de palabras clave y búsquedas guardadas (tablas mp_keywords /
  // mp_busquedas). Arrancan vacíos y se pueblan al montar.
  const [mpCatalogo, setMpCatalogo] = useState([]);
  const [mpBusquedas, setMpBusquedas] = useState([]);
  const [mpKeywordsOpen, setMpKeywordsOpen] = useState(false);
  const [mpPrompt, setMpPrompt] = useState(null);            // modal de texto (reemplaza window.prompt)
  const [confirmGenerico, setConfirmGenerico] = useState(null); // confirmación (reemplaza window.confirm)
  const [mpBuscando, setMpBuscando] = useState(false);
  // Avance de la búsqueda por tandas: { hechas, total } en palabras clave.
  const [mpProgreso, setMpProgreso] = useState(null);
  /* La búsqueda manual gasta ~90 consultas de la cuota diaria de la API, así
     que quedó restringida (lo dice el backend, según MP_EXPLORAR_EMAILS). Para
     el resto del equipo la exploración se genera sola a las 14:00 y 23:00 y
     acá solo se lee el resultado guardado. */
  // null = aún no se sabe (la respuesta viene en camino): el botón se muestra
  // y el backend igual rechaza a quien no corresponde. Solo `false` lo oculta.
  const [mpPuedeBuscar, setMpPuedeBuscar] = useState(null);
  // { actualizado_at, motivo } si lo mostrado viene de la corrida automática.
  const [mpAuto, setMpAuto] = useState(() => leerVistaExploracion()?.auto || null);

  // Cada cambio de la vista se respalda. Si la cuota de sessionStorage se
  // llena, se pierde el respaldo pero no la vista: por eso el try vacío.
  useEffect(() => {
    if (!mpRes) return;
    try {
      sessionStorage.setItem(MP_VISTA_CACHE, JSON.stringify({ res: mpRes, auto: mpAuto, ts: Date.now() }));
    } catch { /* sin respaldo, la pantalla sigue funcionando */ }
  }, [mpRes, mpAuto]);
  // Identidad de la búsqueda en curso: si el usuario lanza otra (o cambia de
  // vista), las tandas de la anterior que sigan llegando se descartan en vez
  // de mezclarse con los resultados nuevos.
  const mpBusquedaRef = useRef(0);
  const [agregandoCodigo, setAgregandoCodigo] = useState(null);

  function qpBase(fuente, pagina) {
    const qp = new URLSearchParams({ fuente, pagina: String(pagina), tamano: "15" });
    if (fuente === "agil" || fuente === "todas") {
      if (mpRegion) qp.set("region", mpRegion);
      if (mpEstado) qp.set("estado", mpEstado);
      if (mpDesde) qp.set("desde", mpDesde);
      if (mpHasta) qp.set("hasta", mpHasta);
    } else if (mpDesde) {
      // En Licitaciones el backend interpreta `desde` como el día exacto de
      // publicación: la API v1 no soporta rangos.
      qp.set("desde", mpDesde);
    }
    return qp;
  }

  /* La búsqueda va POR TANDAS de palabras clave, no en una sola petición.

     Medido con el catálogo real (80 palabras → 90 términos con las variantes
     singular/plural): la API tarda ~15 s por consulta y no tolera más de 6 en
     paralelo, así que la búsqueda completa son ~4 minutos. En una sola request
     eso era un spinner de 4 minutos sin nada que mirar —parecía colgado— y si
     algo se cortaba a mitad se perdía todo.

     En tandas de 5 palabras (≈6 términos = una oleada del backend), la primera
     pintura llega a los ~15 s y de ahí la tabla crece tanda a tanda, con una
     barra que dice por dónde va. Lo que ya llegó no se pierde aunque el resto
     falle. El costo total contra la API es el mismo. */
  async function buscarMP(pagina = 1, qOverride = null) {
    if (mpBuscando) return;
    // El backend igual lo rechaza (403): este corte temprano solo evita el
    // viaje para mostrar el mismo mensaje.
    if (mpPuedeBuscar === false) {
      setToast({ type: "info", message: "La búsqueda manual está restringida. El listado se actualiza solo a las 14:00 y 23:00." });
      return;
    }
    const idBusqueda = ++mpBusquedaRef.current;
    const vigente = () => mpBusquedaRef.current === idBusqueda;
    setMpBuscando(true);
    setMpProgreso(null);
    // Lo que se muestre desde ahora ya no es la exploración automática.
    setMpAuto(null);
    try {
      const q = (qOverride ?? mpQ).trim();
      const kws = q.split(",").map((s) => s.trim()).filter(Boolean);

      // Cero o una palabra: una sola consulta con paginación real de la API.
      if (kws.length <= 1) {
        const qp = qpBase(mpFuente, pagina);
        if (q) qp.set("q", q);
        const data = await api.get(`/licitaciones/mercado-publico/buscar?${qp.toString()}`);
        if (vigente()) setMpRes(data);
        return;
      }

      const TANDA = 5;
      const grupos = [];
      for (let i = 0; i < kws.length; i += TANDA) grupos.push(kws.slice(i, i + TANDA));
      const inicio = Date.now();
      setMpProgreso({ hechas: 0, total: kws.length, etaMs: null });

      // Acumuladores de la mezcla entre tandas.
      const vistos = new Set();
      let items = [];
      let porKeyword = [];
      let extras = {};

      /* El contador «X de Compra Ágil · Y licitaciones» se cuenta de las FILAS
         acumuladas, no de lo que informe cada tanda: solo la fuente combinada
         trae conteo, y sumar tandas parciales dejó una vez «30 de Compra Ágil»
         sobre una tabla con 314 filas. Contar lo que se muestra no miente. */
      const publicar = () => {
        setMpRes({
          fuente: mpFuente,
          items: [...items],
          paginacion: { numero_pagina: 1, total_paginas: 1, total_resultados: items.length },
          por_keyword: porKeyword,
          conteo_fuente: {
            compra_agil: items.filter((x) => x.tipo_familia === "compra_agil").length,
            licitaciones: items.filter((x) => x.tipo_familia !== "compra_agil").length,
          },
          ...extras,
        });
      };
      const mezclar = (nuevos) => {
        for (const it of nuevos || []) {
          const clave = it.codigo || `${it.nombre}|${it.fecha_publicacion}`;
          if (vistos.has(clave)) {
            // Ya estaba (lo trajo otra tanda): se le suman las palabras que
            // también calzaron, para que el detalle del match quede completo.
            const previo = items.find((x) => (x.codigo || `${x.nombre}|${x.fecha_publicacion}`) === clave);
            if (previo && Array.isArray(it.match_keywords)) {
              previo.match_keywords = [...new Set([...(previo.match_keywords || []), ...it.match_keywords])];
            }
            continue;
          }
          vistos.add(clave);
          items.push(it);
        }
        items.sort((a, b) => String(b.fecha_publicacion || "").localeCompare(String(a.fecha_publicacion || "")));
      };

      /* Las Licitaciones (API v1) van en UNA consulta aparte con TODAS las
         palabras: es una sola llamada cacheada que se filtra en memoria, así
         que cuesta lo mismo con 5 palabras que con 80. Cuando iban dentro de
         la primera tanda, solo las 5 primeras palabras veían licitaciones —
         las demás perdían esa fuente entera sin aviso. */
      if (mpFuente === "todas" || mpFuente === "licitaciones") {
        try {
          const qp = qpBase("licitaciones", 1);
          qp.set("q", kws.join(", "));
          // TODO el listado, no la primera página: con el tamano=15 de qpBase
          // esta consulta traía 15 licitaciones mientras la exploración
          // automática guardaba 67 — mismos criterios, contadores distintos.
          qp.set("tamano", "1000");
          const data = await api.get(`/licitaciones/mercado-publico/buscar?${qp.toString()}`);
          if (!vigente()) return;
          mezclar(data?.items);
          if (data?.actualizado) extras.actualizado = data.actualizado;
          publicar();
        } catch (e) {
          extras.error_licitaciones = String(e?.message || e).slice(0, 140);
        }
      }

      // Compra Ágil: una consulta por palabra contra la API v2 — esto es lo
      // caro, y por eso va por tandas con avance visible.
      if (mpFuente === "todas" || mpFuente === "agil") {
        for (let g = 0; g < grupos.length; g++) {
          if (!vigente()) return; // llegó otra búsqueda: esta ya no manda
          const qp = qpBase("agil", 1);
          qp.set("q", grupos[g].join(", "));
          let data;
          try {
            data = await api.get(`/licitaciones/mercado-publico/buscar?${qp.toString()}`);
          } catch (e) {
            // Una tanda caída no bota la búsqueda: sus palabras quedan anotadas
            // como fallidas en el detalle y se sigue con la siguiente. El avance
            // igual se registra — para el medidor, una tanda fallida también es
            // tiempo transcurrido y trabajo hecho.
            porKeyword = [...porKeyword, ...grupos[g].map((kw) => ({ q: kw, total: 0, traidos: 0, error: String(e?.message || e).slice(0, 140) }))];
            const hechas = Math.min(kws.length, (g + 1) * TANDA);
            const etaMs = hechas > 0 ? ((Date.now() - inicio) / hechas) * (kws.length - hechas) : null;
            setMpProgreso({ hechas, total: kws.length, etaMs });
            continue;
          }
          if (!vigente()) return;
          mezclar(data?.items);
          porKeyword = [...porKeyword, ...(data?.por_keyword || [])];
          const hechas = Math.min(kws.length, (g + 1) * TANDA);
          // Lo que falta, al ritmo REAL de esta búsqueda: la latencia de la API
          // cambia mucho según la hora (medido: 13 a 30 s por tanda), así que se
          // estima con lo ya transcurrido y no con una constante que mentiría.
          const etaMs = hechas > 0 ? ((Date.now() - inicio) / hechas) * (kws.length - hechas) : null;
          setMpProgreso({ hechas, total: kws.length, etaMs });
          publicar();
        }
      } else {
        publicar();
      }
    } catch (e) {
      if (vigente()) setToast({ type: "error", message: e?.message || "No se pudo buscar en Mercado Público." });
    } finally {
      if (vigente()) { setMpBuscando(false); setMpProgreso(null); }
    }
  }

  // Keywords activas (separadas por coma en el campo de búsqueda).
  const mpKeywords = mpQ.split(",").map((s) => s.trim()).filter(Boolean);
  // Clic en una sugerencia: la agrega a la búsqueda (o la quita si ya está).
  function toggleKeywordMP(k) {
    const kws = [...mpKeywords];
    const idx = kws.findIndex((x) => x.toLowerCase() === k.toLowerCase());
    if (idx >= 0) kws.splice(idx, 1); else kws.push(k);
    const nq = kws.join(", ");
    setMpQ(nq);
    buscarMP(1, nq);
  }

  /* ── Catálogo de palabras clave y búsquedas guardadas ────────────────── */
  async function cargarCatalogoMp() {
    try {
      const d = await api.get("/licitaciones/mercado-publico/keywords");
      setMpCatalogo(Array.isArray(d?.keywords) && d.keywords.length ? d.keywords : MP_KEYWORDS_FALLBACK);
      setMpBusquedas(Array.isArray(d?.busquedas) ? d.busquedas : []);
    } catch {
      // Migración sin aplicar o error de red: se sigue trabajando con las fijas.
      setMpCatalogo(MP_KEYWORDS_FALLBACK);
      setMpBusquedas([]);
    }
  }

  useEffect(() => { cargarCatalogoMp(); }, []);

  /* Cada vez que se entra a «Explorar»: la última exploración automática. Se
     relee al cambiar de pestaña —y no solo al montar— para que una sesión que
     lleva horas abierta reciba la corrida de las 14:00/23:00 sin recargar la
     página; leerla no consulta la API, es una fila guardada. De paso el
     backend dice si este usuario puede lanzar búsquedas a mano. */
  useEffect(() => {
    if (vista !== "explorar" || mpBuscando) return;
    // No pisar una búsqueda manual que el usuario esté mirando: solo se
    // refresca si lo que hay en pantalla es la automática (o nada).
    if (mpRes && !mpAuto) return;
    let activo = true;
    (async () => {
      try {
        const d = await api.get("/licitaciones/mercado-publico/exploracion");
        if (!activo) return;
        setMpPuedeBuscar(!!d?.puede_buscar);
        if (Array.isArray(d?.items)) {
          setMpRes(d);
          setMpAuto({ actualizado_at: d.actualizado_at, motivo: d.motivo });
        }
      } catch {
        // Migración sin aplicar o error de red: la pestaña queda vacía y quien
        // tenga permiso puede buscar a mano igual.
      }
    })();
    return () => { activo = false; };
  }, [vista]);

  // Alta de palabra y guardado de búsqueda usan un modal propio en vez de
  // window.prompt: el diálogo nativo del navegador rompe el estilo y no se
  // puede validar mientras se escribe.
  function agregarKeywordMp() {
    setMpPrompt({
      titulo: "Nueva palabra clave",
      ayuda: "Se agrega al catálogo y queda disponible para todo el equipo.",
      placeholder: "Ej: Fresa diamante troncocónica",
      confirmar: "Agregar",
      onConfirmar: async (texto) => {
        await api.post("/licitaciones/mercado-publico/keywords", { texto });
        await cargarCatalogoMp();
        setToast({ type: "success", message: `"${texto}" agregada al catálogo.` });
      },
    });
  }

  async function eliminarKeywordMp(k) {
    setConfirmGenerico({
      title: "Quitar palabra clave",
      message: `¿Quitar "${k.texto}" del catálogo? Deja de estar disponible para todo el equipo.`,
      onConfirm: async () => {
        try {
          await api.delete(`/licitaciones/mercado-publico/keywords/${k.id}`);
          await cargarCatalogoMp();
        } catch (e) {
          setToast({ type: "error", message: e?.message || "No se pudo quitar la palabra." });
        }
      },
    });
  }

  // Selección masiva desde el administrador. No dispara la búsqueda: con
  // decenas de términos sería una consulta enorme (y truncada a 8) por cada
  // clic. El usuario elige y después aprieta Buscar.
  function seleccionarKeywordsMp(textos, seleccionar) {
    const kws = [...mpKeywords];
    for (const t of textos) {
      const idx = kws.findIndex((x) => x.toLowerCase() === t.toLowerCase());
      if (seleccionar && idx < 0) kws.push(t);
      if (!seleccionar && idx >= 0) kws.splice(idx, 1);
    }
    setMpQ(kws.join(", "));
  }

  function guardarBusquedaMp() {
    const kws = [...mpKeywords];
    setMpPrompt({
      titulo: "Guardar búsqueda rápida",
      ayuda: `${kws.length} palabra${kws.length === 1 ? "" : "s"}: ${kws.slice(0, 6).join(", ")}${kws.length > 6 ? `… y ${kws.length - 6} más` : ""}`,
      placeholder: "Ej: Fresas y discos",
      confirmar: "Guardar",
      onConfirmar: async (nombre) => {
        await api.post("/licitaciones/mercado-publico/busquedas", { nombre, keywords: kws });
        await cargarCatalogoMp();
        setToast({ type: "success", message: `Búsqueda "${nombre}" guardada.` });
      },
    });
  }

  async function eliminarBusquedaMp(b) {
    setConfirmGenerico({
      title: "Eliminar búsqueda guardada",
      message: `¿Eliminar la búsqueda "${b.nombre}"? Las palabras clave se mantienen en el catálogo.`,
      onConfirm: async () => {
        try {
          await api.delete(`/licitaciones/mercado-publico/busquedas/${b.id}`);
          await cargarCatalogoMp();
        } catch (e) {
          setToast({ type: "error", message: e?.message || "No se pudo eliminar la búsqueda." });
        }
      },
    });
  }

  // Copia el proceso encontrado al listado interno de Postulaciones (mismo
  // flujo de siempre: tomar → crear borrador). La API no permite ofertar:
  // eso se hace con sesión en mercadopublico.cl.
  async function agregarAPostulaciones(item) {
    setAgregandoCodigo(item.codigo);
    try {
      const res = await api.post("/licitaciones/disponibles/bulk", {
        rows: [{
          id_licitacion: item.codigo,
          nombre: item.nombre,
          datos: {
            organismo: item.organismo || "",
            region: item.region || "",
            monto: item.monto_clp != null ? `$${Number(item.monto_clp).toLocaleString("es-CL")}` : "",
            cierre: item.fecha_cierre || "",
            publicacion: item.fecha_publicacion || "",
            // El tipo sale del código del propio proceso, no de la fuente
            // elegida: en la vista combinada conviven ambos.
            tipo: item.tipo_familia === "compra_agil" ? "Compra Ágil" : "Licitación",
          },
        }],
      });
      if (res?.insertados > 0) {
        setToast({ type: "success", message: `${item.codigo} agregada al listado de Postulaciones.` });
        cargar();
      } else {
        setToast({ type: "error", message: `${item.codigo} ya estaba en el listado.` });
      }
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo agregar al listado." });
    } finally {
      setAgregandoCodigo(null);
    }
  }

  /* Tomar directo desde la exploración: la agrega al Listado (si no estaba) y
     la deja tomada por quien pulsó, en un solo gesto. Pasa por los MISMOS
     endpoints que el flujo manual, así que respeta todo: el cupo de 3, el
     dueño si otro la tomó antes, el aviso al chat grupal. */
  async function tomarDesdeExploracion(item) {
    if (agregandoCodigo) return;
    setAgregandoCodigo(item.codigo);
    try {
      // 1) Asegurarla en el Listado. Idempotente: si ya estaba, insertados=0.
      await api.post("/licitaciones/disponibles/bulk", {
        rows: [{
          id_licitacion: item.codigo,
          nombre: item.nombre,
          datos: {
            organismo: item.organismo || "",
            region: item.region || "",
            monto: item.monto_clp != null ? `$${Number(item.monto_clp).toLocaleString("es-CL")}` : "",
            cierre: item.fecha_cierre || "",
            publicacion: item.fecha_publicacion || "",
            tipo: item.tipo_familia === "compra_agil" ? "Compra Ágil" : "Licitación",
          },
        }],
      });
      // 2) Ubicar su fila (el bulk no devuelve ids).
      const lista = await api.get("/licitaciones/disponibles");
      const row = (Array.isArray(lista) ? lista : []).find(
        (l) => String(l.id_licitacion || "").trim().toLowerCase() === String(item.codigo).trim().toLowerCase(),
      );
      if (!row) throw new Error("No se encontró la postulación recién agregada al Listado.");
      const dueno = (row.tomada_por || "").toLowerCase();
      if (dueno && dueno !== currentEmail) {
        setToast({ type: "error", message: `${item.codigo} ya está tomada por ${row.tomada_por}.` });
        return;
      }
      // 3) Tomarla (valida cupo y vigencia en el backend, y avisa al chat).
      if (!dueno) await api.put(`/licitaciones/disponibles/${row.id}/tomar`, { tomar: true });
      setToast({ type: "success", message: `${item.codigo} tomada y en el Listado. Queda avisado en el chat.` });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo tomar la postulación." });
    } finally {
      setAgregandoCodigo(null);
    }
  }

  // Descarga la ficha del popup como PDF vectorial con identidad Amsodent.
  async function descargarFichaPDF() {
    if (!mpFicha?.data || descargandoFicha) return;
    setDescargandoFicha(true);
    try {
      const { descargarFichaMercadoPublicoPDF } = await import("../lib/fichaMercadoPublicoPDF");
      await descargarFichaMercadoPublicoPDF(mpFicha.data, { urlFicha: mpFicha.urlFicha });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo generar el PDF de la ficha." });
    } finally {
      setDescargandoFicha(false);
    }
  }

  /* `itemExplorar`: cuando la ficha se abre desde un resultado de la
     exploración viaja el item completo, y con él el pie de la ficha ofrece
     «Crear cotización (borrador)». Desde el Listado NO se ofrece a propósito:
     ahí la cotización se crea con «Cargar», que reserva el cupo y deja la
     postulación marcada; un atajo aquí saltaría ese control. */
  async function verFichaMP(row, itemExplorar = null) {
    const codigo = String(row.id_licitacion || "").trim();
    if (!codigo) return;
    const urlFicha = String(row?.datos?.url_ficha || "").trim();
    setMpFicha({ codigo, urlFicha, loading: true, data: null, error: "", itemExplorar });
    try {
      const data = await api.get(`/licitaciones/mercado-publico/${encodeURIComponent(codigo)}`);
      setMpFicha((prev) => (prev?.codigo === codigo ? { ...prev, loading: false, data } : prev));
    } catch (e) {
      setMpFicha((prev) => (prev?.codigo === codigo
        ? { ...prev, loading: false, error: e?.message || "No se pudo consultar Mercado Público." }
        : prev));
    }
  }

  // Confirma contra Mercado Público, en tandas, cuáles de nuestras
  // postulaciones ya figuran con oferta enviada. Va por tandas porque la API
  // tarda ~25 s por proceso y hay que poder ver el avance.
  async function verificarPostulaciones() {
    if (verificando) return;
    setVerificando(true);
    setProgresoVerif({ revisadas: 0, restantes: null });
    let revisadas = 0;
    let confirmadas = 0;
    let sinDato = 0;
    let errores = 0;
    try {
      for (let i = 0; i < 40; i++) {
        const r = await api.post("/licitaciones/disponibles/verificar-postulacion", { lote: 24 });
        revisadas += r.revisadas || 0;
        confirmadas += r.con_postulacion || 0;
        sinDato += r.sin_dato || 0;
        errores += r.errores?.length || 0;
        setProgresoVerif({ revisadas, restantes: r.restantes ?? 0 });
        if (!r.restantes || !r.revisadas) break;
      }
      await cargar();
      const partes = [`${revisadas} revisada${revisadas === 1 ? "" : "s"}`];
      if (confirmadas) partes.push(`${confirmadas} con postulación confirmada`);
      if (sinDato) partes.push(`${sinDato} sin dato (Mercado Público aún no publica los oferentes)`);
      if (errores) partes.push(`${errores} con error`);
      setToast({ type: confirmadas ? "success" : "info", message: partes.join(" · ") + "." });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo verificar contra Mercado Público." });
    } finally {
      setVerificando(false);
      setProgresoVerif(null);
    }
  }

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/licitaciones/disponibles");
      setLista(Array.isArray(data) ? data : []);
      setLoadSeq((s) => s + 1);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo cargar el listado. ¿Está aplicada la migración?" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  // KPI: cotizaciones que YO creé hoy (licitaciones con mi correo y fecha de hoy).
  useEffect(() => {
    if (!currentEmail) return;
    let activo = true;
    (async () => {
      try {
        const data = await api.get("/licitaciones/with-fields?fields=id,creado_por,fecha");
        const h = new Date();
        const hoyStr = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
        const n = (data || []).filter((l) =>
          (l.creado_por || "").toLowerCase() === currentEmail &&
          String(l.fecha || "").slice(0, 10) === hoyStr,
        ).length;
        if (activo) setCreadasHoy(n);
      } catch (e) {
        console.error("Error contando cotizaciones de hoy:", e);
      }
    })();
    return () => { activo = false; };
  }, [currentEmail, loadSeq]);

  // Tipos de licitación presentes en el listado (columna Tipo del xlsx).
  const tiposDisponibles = useMemo(
    () => [...new Set(lista.map((l) => String(l?.datos?.tipo || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es")),
    [lista],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const arr = lista.filter((l) => {
      // "No aplica": descartadas por el equipo. Solo se ven en su propio filtro
      // o en "Todas"; el resto de las vistas las oculta.
      if (l.no_aplica) {
        if (filtro !== "no_aplica" && filtro !== "todas") return false;
      } else if (filtro === "no_aplica") {
        return false;
      }
      // "Pendientes" es lo que queda POR HACER: una cerrada por vencimiento ya
      // no lo es, aunque nunca se haya cargado.
      if (filtro === "pendientes" && (l.cargada || l.cerrada)) return false;
      if (filtro === "cargadas" && !l.cargada) return false;
      if (filtro === "mias" && (l.tomada_por || "").toLowerCase() !== currentEmail) return false;
      // «Ya postuladas»: hay cotización nuestra con ese código, o Mercado
      // Público confirmó nuestra oferta entre los cotizantes.
      const yaPostulada = !!l.cotizacion_propia || l?.datos?.postulamos === true;
      if (filtro === "postuladas" && !yaPostulada) return false;
      // «Sin postular»: lo que de verdad queda por hacer y aún está en plazo.
      if (filtro === "sin_postular" && (yaPostulada || l.cargada || l.cerrada || !estaVigente(l))) return false;
      // "Caducadas": no alcanzaron a cargarse antes de la fecha de cierre.
      // Ignora el filtro de Disponibilidad (una caducada es siempre vencida).
      if (filtro === "caducadas") {
        if (l.cargada || (!l.cerrada && estaVigente(l))) return false;
      } else if (dispon !== "todas") {
        // Disponibilidad según la fecha de Cierre del portal (datos.cierre).
        const vig = estaVigente(l);
        if (dispon === "vigentes" && !vig) return false;
        if (dispon === "vencidas" && vig) return false;
      }
      if (filtroTipo && String(l?.datos?.tipo || "").trim() !== filtroTipo) return false;
      // Rango por FECHA DE CIERRE del portal. Se compara por día local con el
      // Date ya interpretado, no con el texto crudo: `datos.cierre` llega en
      // formatos distintos según el origen ("2026-08-08 17:50" del buscador y
      // "11-08-26 10:00" del xlsx), así que comparar cadenas daría cualquier
      // cosa. Las que no traen fecha quedan fuera al filtrar por rango: no se
      // puede afirmar que caigan dentro.
      if (cierreDesde || cierreHasta) {
        const fCierre = diaLocal(parseCierre(l?.datos?.cierre));
        if (!fCierre) return false;
        if (cierreDesde && fCierre < cierreDesde) return false;
        if (cierreHasta && fCierre > cierreHasta) return false;
      }
      const fCarga = String(l.created_at || "").slice(0, 10);
      if (fechaDesde && fCarga && fCarga < fechaDesde) return false;
      if (fechaHasta && fCarga && fCarga > fechaHasta) return false;
      if (!q) return true;
      return (
        String(l.id_licitacion || "").toLowerCase().includes(q) ||
        String(l.nombre || "").toLowerCase().includes(q)
      );
    });
    // Sin orden explícito NO se reordena aquí: el orden "tomadas primero" se
    // aplica solo al cargar (ver efecto abajo), para que marcar/desmarcar no
    // mueva las filas de golpe.
    if (!ordenCierre) return arr;
    // Orden por cierre pedido por el usuario. Las que no traen fecha van
    // siempre al final, en cualquier sentido: no tener dato no es "cerrar
    // primero" ni "cerrar último", es simplemente desconocido.
    const signo = ordenCierre === "asc" ? 1 : -1;
    return [...arr].sort((a, b) => {
      const ta = parseCierre(a?.datos?.cierre)?.getTime();
      const tb = parseCierre(b?.datos?.cierre)?.getTime();
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return (ta - tb) * signo;
    });
  }, [lista, busqueda, filtro, filtroTipo, dispon, fechaDesde, fechaHasta, cierreDesde, cierreHasta, currentEmail, ordenCierre]);

  const stats = useMemo(() => ({
    total: lista.length,
    // Las cerradas por vencimiento salen de «Pendientes»: el contador decía
    // que quedaba trabajo por hacer sobre postulaciones a las que ya no se
    // podía postular.
    pendientes: lista.filter((l) => !l.cargada && !l.no_aplica && !l.cerrada && estaVigente(l)).length,
    cargadas: lista.filter((l) => l.cargada).length,
    cerradas: lista.filter((l) => !l.cargada && !l.no_aplica && (l.cerrada || !estaVigente(l))).length,
  }), [lista]);

  // Postulaciones que el usuario actual tiene tomadas y aún pendientes (cupo /3).
  const misTomadas = useMemo(
    () => lista.filter((l) => (l.tomada_por || "").toLowerCase() === currentEmail && !l.cargada).length,
    [lista, currentEmail],
  );

  // Ordena "mis tomadas pendientes" al inicio, SOLO al (re)cargar el listado o
  // cuando ya se conoce el usuario. No corre al marcar/desmarcar, así las filas
  // no se mueven de golpe (eso confundía).
  useEffect(() => {
    if (!currentEmail) return;
    setLista((prev) => {
      const rank = (l) => ((l.tomada_por || "").toLowerCase() === currentEmail && !l.cargada ? 0 : 1);
      const conIdx = prev.map((l, i) => [l, i]);
      conIdx.sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1]));
      return conIdx.map((x) => x[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSeq, currentEmail]);

  function cargarLicitacion(row) {
    // Solo abre la Nueva Cotización prellenada. La fila NO se marca como
    // "cargada" aquí: eso ocurre cuando la cotización se GUARDA (el guardado
    // llama al endpoint /cargar con este disponibleId).
    navigate("/crear", {
      state: { prefillLicitacion: {
        idLicitacionInput: row.id_licitacion || "",
        nombre: row.nombre || "",
        disponibleId: row.id,
        datos: row.datos || {}, // organismo, región, monto, cierre, etc. del xlsx
      } },
    });
  }

  /* Réplica de un resultado de la EXPLORACIÓN a una cotización nueva (queda en
     borrador hasta que se guarde, igual que «Cargar» en el Listado). Mismo
     mecanismo de prellenado; la diferencia es que aquí no hay `disponibleId`
     —el proceso no pasó por el Listado— así que no reserva cupo ni marca nada. */
  function cotizarDesdeExploracion(item) {
    navigate("/crear", {
      state: { prefillLicitacion: {
        idLicitacionInput: item.codigo || "",
        nombre: item.nombre || "",
        datos: {
          descripcion: item.convocatoria || "",
          organismo: item.organismo || "",
          region: item.region || "",
          monto: item.monto_clp != null ? String(item.monto_clp) : "",
          cierre: item.fecha_cierre || "",
          publicacion: item.fecha_publicacion || "",
        },
      } },
    });
  }

  async function desmarcar(row) {
    if (!esGestor) return;
    try {
      await api.put(`/licitaciones/disponibles/${row.id}/descargar`, {});
      setLista((prev) => prev.map((l) => l.id === row.id ? { ...l, cargada: false, cargada_por: null, cargada_at: null } : l));
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo desmarcar." });
    }
  }

  // Marca / desmarca "No Aplica" (descartada por el equipo). Sale del listado de
  // pendientes; se puede revertir desde el filtro "No aplica".
  async function toggleNoAplica(row) {
    if (!esGestor) return;
    const noAplica = !row.no_aplica;
    const prev = { no_aplica: row.no_aplica ?? false, no_aplica_por: row.no_aplica_por ?? null, no_aplica_at: row.no_aplica_at ?? null };
    setLista((ls) => ls.map((l) => (l.id === row.id
      ? { ...l, no_aplica: noAplica, no_aplica_por: noAplica ? currentEmail : null, no_aplica_at: noAplica ? new Date().toISOString() : null }
      : l)));
    try {
      await api.put(`/licitaciones/disponibles/${row.id}/no-aplica`, { noAplica });
      setToast({ type: "success", message: noAplica ? "Marcada como No Aplica." : "Restaurada al listado." });
    } catch (e) {
      console.error(e);
      setLista((ls) => ls.map((l) => (l.id === row.id ? { ...l, ...prev } : l)));
      setToast({ type: "error", message: e?.message || "No se pudo actualizar. ¿Está aplicada la migración?" });
    }
  }

  async function eliminar(row) {
    if (!esGestor) return;
    try {
      await api.delete(`/licitaciones/disponibles/${row.id}`);
      setLista((prev) => prev.filter((l) => l.id !== row.id));
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo eliminar." });
    }
  }

  async function borrarTodas() {
    if (!esGestor) return;
    try {
      await api.delete("/licitaciones/disponibles/todas");
      setLista([]);
      setConfirmBorrarTodas(false);
      setToast({ type: "success", message: "Se borró todo el listado." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo borrar el listado." });
    }
  }

  // Al marcar: si es una toma nueva, pide confirmación; liberar es directo.
  function pedirTomar(row) {
    const mia = (row.tomada_por || "").toLowerCase() === currentEmail;
    if (mia) { toggleTomar(row); return; } // liberar (desmarcar) sin confirmar
    // No se puede tomar una postulación vencida (fuera de la fecha de cierre).
    if (!estaVigente(row)) {
      setToast({ type: "error", message: "Esta postulación está vencida (fuera de la fecha de cierre) y no se puede tomar." });
      return;
    }
    if (misTomadas >= MAX_TOMADAS) {
      setToast({ type: "error", message: `Máximo ${MAX_TOMADAS} tomadas. Crea la cotización de alguna para liberar un cupo.` });
      return;
    }
    setConfirmTomar(row);
  }

  // Publica en el Chat del equipo (sala general) que se tomó una postulación.
  // Best-effort: si falla (RLS, sin sala), no interrumpe la toma.
  async function publicarTomaEnChat(row) {
    try {
      const { data: salas } = await supabase
        .from("chat_salas")
        .select("id, es_general")
        .order("es_general", { ascending: false })
        .limit(1);
      const salaId = salas?.[0]?.id;
      if (!salaId) return;
      const autorNombre = perfil?.nombre || user?.email || "—";
      // Se publica como TARJETA de licitación (mismo formato probado que ya usa
      // el chat), más visible que un texto plano.
      const { error } = await supabase.from("chat_mensajes").insert({
        autor_email: currentEmail,
        autor_nombre: autorNombre,
        tipo: "licitacion",
        sala_id: salaId,
        texto: row.nombre || null,
        licitacion_id: row.id_licitacion,
        licitacion_estado: "Tomada",
      });
      if (error) throw error;
      // El aviso se inserta directo en la tabla, así que hay que reenviarlo al
      // grupo de WhatsApp explícitamente. Como tarjeta no viaja: se manda el
      // texto equivalente, con el ID para poder buscar la postulación.
      if (salas?.[0]?.es_general) {
        const ficha = [row.nombre, row.id_licitacion && `ID ${row.id_licitacion}`]
          .filter(Boolean)
          .join(" · ");
        replicarEnWhatsApp({
          autor: autorNombre,
          texto: `📌 Tomó una postulación${ficha ? `: ${ficha}` : ""}`,
        });
      }
      setToast({ type: "success", message: "Aviso publicado en el Chat del equipo (sala General) 📌" });
    } catch (e) {
      console.error("No se pudo publicar en el chat:", e);
      setToast({ type: "error", message: "Se tomó la postulación, pero no se pudo avisar en el chat." });
    }
  }

  async function toggleTomar(row) {
    const mia = (row.tomada_por || "").toLowerCase() === currentEmail;
    const tomar = !mia;
    // Validaciones antes de llamar al backend (mejor UX).
    if (tomar && row.tomada_por && !mia) {
      setToast({ type: "error", message: `Ya la tomó ${row.tomada_por}.` });
      return;
    }
    if (tomar && misTomadas >= MAX_TOMADAS) {
      setToast({ type: "error", message: `Máximo ${MAX_TOMADAS} tomadas. Crea la cotización de alguna para liberar un cupo.` });
      return;
    }
    const prevTom = { tomada_por: row.tomada_por ?? null, tomada_at: row.tomada_at ?? null };
    // Optimista.
    setLista((prev) => prev.map((l) => (l.id === row.id
      ? { ...l, tomada_por: tomar ? currentEmail : null, tomada_at: tomar ? new Date().toISOString() : null }
      : l)));
    try {
      const actualizado = await api.put(`/licitaciones/disponibles/${row.id}/tomar`, { tomar });
      // Refleja el valor autoritativo que devolvió el backend.
      if (actualizado && typeof actualizado === "object") {
        setLista((prev) => prev.map((l) => (l.id === row.id
          ? { ...l, tomada_por: actualizado.tomada_por ?? (tomar ? currentEmail : null), tomada_at: actualizado.tomada_at ?? null }
          : l)));
      }
      // Al TOMAR (no al liberar) se publica el ID en el chat del equipo.
      if (tomar) publicarTomaEnChat(row);
    } catch (e) {
      console.error(e);
      setLista((prev) => prev.map((l) => (l.id === row.id ? { ...l, ...prevTom } : l)));
      setToast({ type: "error", message: e?.message || "No se pudo tomar la postulación. ¿Está aplicada la migración?" });
    }
  }

  return (
    <div className={embedded ? "" : "page"}>
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          {!embedded && (
            <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ClipboardList size={20} /> Postulaciones disponibles
            </h1>
          )}
          <p className="page-subtitle" style={embedded ? { marginTop: 0 } : undefined}>Toma hasta {MAX_TOMADAS} postulaciones; se liberan al crear su cotización.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setFiltro("mias")}
            title="Ver solo las que tomaste"
            style={{
              fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
              background: misTomadas >= MAX_TOMADAS ? "#fef2f2" : "#eef2ff",
              color: misTomadas >= MAX_TOMADAS ? "#b91c1c" : "#3730a3",
              border: `1px solid ${misTomadas >= MAX_TOMADAS ? "#fecaca" : "#c7d2fe"}`,
            }}
          >
            Mis tomadas: {misTomadas}/{MAX_TOMADAS}
          </button>
          {esGestor && (
            <>
              {/* Confirmación oficial contra Mercado Público. Es aparte del
                  cruce con nuestras cotizaciones —que ya viene calculado— porque
                  gasta cuota de la API y solo da respuesta en los procesos ya
                  resueltos: antes de que el comprador elija proveedor, la lista
                  de oferentes viene vacía. */}
              <button
                className="btn btn-secondary"
                onClick={verificarPostulaciones}
                disabled={verificando}
                title="Pregunta a Mercado Público si nuestro RUT figura entre los oferentes. Solo responde en procesos ya adjudicados: antes de eso no publica quién ofertó."
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Check size={15} />
                {verificando
                  ? `Revisando… ${progresoVerif?.revisadas || 0}${progresoVerif?.restantes ? ` · faltan ${progresoVerif.restantes}` : ""}`
                  : "Confirmar postulaciones"}
              </button>
              <button className="btn btn-primary" onClick={() => setUploadOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Upload size={15} /> Subir listado (xlsx)
              </button>
              {lista.length > 0 && (
                <button className="btn btn-secondary" onClick={() => setConfirmBorrarTodas(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--danger)" }} title="Borrar todo el listado">
                  <Trash2 size={15} /> Borrar todas
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Pestañas: listado interno / explorador en vivo de Mercado Público
          (visible también en modo embedded, p. ej. dentro del Chat Grupal). */}
      <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 14 }}>
        {[["listado", `Listado (${lista.length})`], ["explorar", "Explorar Mercado Público"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setVista(key)}
            style={{
              padding: "7px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
              background: vista === key ? "var(--primary)" : "var(--surface)",
              color: vista === key ? "#fff" : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {vista === "listado" && (
      <>
      {/* Stats. `stats-5` porque son cinco: sin ella la grilla base son cuatro
          columnas y «Creadas hoy» caía sola a una segunda fila. La clase ya
          trae los cortes responsivos (5 → 3 → 2 → 1). */}
      <div className="stats-row stats-5">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-sub">en el listado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{stats.pendientes}</div>
          <div className="stat-sub">dentro de plazo</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cargadas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.cargadas}</div>
          <div className="stat-sub">ya tomadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cerradas</div>
          <div className="stat-value" style={{ color: "var(--text-muted)" }}>{stats.cerradas}</div>
          <div className="stat-sub">venció el plazo</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Creadas hoy</div>
          <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{creadasHoy}</div>
          <div className="stat-sub">cotizaciones que creaste hoy</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="ID o nombre de la postulación…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ minWidth: 150 }}>
            <option value="pendientes">Pendientes</option>
            <option value="mias">Mis tomadas</option>
            <option value="cargadas">Cargadas</option>
            <option value="postuladas">Ya postuladas</option>
            <option value="sin_postular">Sin postular</option>
            <option value="caducadas">Caducadas</option>
            <option value="no_aplica">No aplica</option>
            <option value="todas">Todas</option>
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo</label>
          <select className="input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ minWidth: 130 }} title="Tipo de licitación (columna Tipo del portal)">
            <option value="">Todos</option>
            {tiposDisponibles.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Disponibilidad</label>
          <select className="input" value={dispon} onChange={(e) => setDispon(e.target.value)} style={{ minWidth: 160 }} title="Según la fecha de cierre del portal">
            <option value="vigentes">Vigentes (dentro de plazo)</option>
            <option value="vencidas">Vencidas (fuera de plazo)</option>
            <option value="todas">Todas</option>
          </select>
        </div>
        {/* Dos rangos de fecha distintos y fáciles de confundir: «Cargado» es
            cuándo entró la postulación a NUESTRO listado; «Cierre» es el plazo
            del portal para postular. De ahí los títulos explícitos. */}
        <div className="filter-field">
          <label className="filter-label">Cierra desde</label>
          <DateFilter
            value={cierreDesde}
            onChange={setCierreDesde}
            placeholder="Desde…"
            maxDate={cierreHasta ? new Date(`${cierreHasta}T00:00:00`) : undefined}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Cierra hasta</label>
          <DateFilter
            value={cierreHasta}
            onChange={setCierreHasta}
            placeholder="Hasta…"
            minDate={cierreDesde ? new Date(`${cierreDesde}T00:00:00`) : undefined}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Cargado desde</label>
          <DateFilter value={fechaDesde} onChange={setFechaDesde} placeholder="Desde…" maxDate={fechaHasta ? new Date(`${fechaHasta}T00:00:00`) : undefined} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Cargado hasta</label>
          <DateFilter value={fechaHasta} onChange={setFechaHasta} placeholder="Hasta…" minDate={fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : undefined} />
        </div>
      </div>

      {/* Tabla */}
      <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
        {loading ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Cargando…</div>
        ) : filtradas.length === 0 ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
            {lista.length === 0 ? "No hay postulaciones en el listado. Sube un xlsx para comenzar." : "Sin resultados para el filtro."}
          </div>
        ) : (
          // El ancho mínimo es la suma de las columnas fijas MÁS un mínimo
          // razonable para «Nombre». Con 1180 las fijas sumaban 1162 y a
          // «Nombre» le quedaban 18px: el título de la licitación —lo primero
          // que se lee— era la columna más apretada de la tabla.
          <table className="data-table table-clip" style={{ width: "100%", minWidth: 1320, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "center", width: 56 }}>Tomar</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 140 }}>ID Licitación</th>
                <th style={{ textAlign: "left", minWidth: 240 }}>Nombre</th>
                <th style={{ textAlign: "left", width: 170 }}>Organismo</th>
                <th style={{ textAlign: "left", width: 130 }}>Región</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap", width: 110 }}>Monto</th>
                <th style={{ textAlign: "left", width: 90 }}>Tipo</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 140 }}>
                  <button
                    type="button"
                    onClick={() => setOrdenCierre((o) => (o === "asc" ? "desc" : o === "desc" ? null : "asc"))}
                    title={
                      ordenCierre === "asc" ? "Cierran antes primero · clic para invertir"
                      : ordenCierre === "desc" ? "Cierran después primero · clic para quitar el orden"
                      : "Ordenar por fecha de cierre"
                    }
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none",
                      padding: 0, font: "inherit", color: ordenCierre ? "var(--primary-dark)" : "inherit", cursor: "pointer",
                    }}
                  >
                    Cierre
                    {ordenCierre === "asc" ? <ArrowUp size={12} />
                      : ordenCierre === "desc" ? <ArrowDown size={12} />
                      : <ArrowUpDown size={12} style={{ opacity: 0.35 }} />}
                  </button>
                </th>
                <th style={{ textAlign: "left", width: 132 }}>Estado</th>
                <th style={{ textAlign: "left", width: 112 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((row) => {
                const mia = (row.tomada_por || "").toLowerCase() === currentEmail;
                const deOtro = !!row.tomada_por && !mia;
                // `cerrada` la persiste el backend al pasar el plazo; el
                // cálculo al vuelo se mantiene como respaldo, para que la fila
                // se vea correcta aunque la migración no esté aplicada todavía.
                const vencida = row.cerrada || !estaVigente(row);
                // Se bloquea marcar si la tomó otro o si está vencida (salvo que
                // sea propia, para poder liberarla).
                const bloqueada = deOtro || (vencida && !mia) || row.no_aplica;
                // Caducada: se venció sin llegar a cargarse (no se pudo tomar a tiempo).
                const caducada = vencida && !row.cargada && !row.no_aplica;
                return (
                <tr key={row.id} style={{ background: mia ? "#eef2ff" : undefined }}>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!row.tomada_por}
                      disabled={bloqueada}
                      onChange={() => pedirTomar(row)}
                      title={deOtro ? `Tomada por ${row.tomada_por}` : vencida && !mia ? "Vencida: fuera de la fecha de cierre" : mia ? "Liberar postulación" : "Tomar postulación"}
                      style={{ width: 17, height: 17, cursor: bloqueada ? "not-allowed" : "pointer", accentColor: mia ? "#4f46e5" : bloqueada ? "#94a3b8" : undefined }}
                    />
                  </td>
                  {/* Click en el ID → popup con la ficha en vivo; el botón del
                      costado abre la ficha en mercadopublico.cl. Sigue siendo
                      seleccionable: si hay texto seleccionado, no se abre nada.
                      El borrador se crea desde Acciones. */}
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                      <span
                        title="Ver ficha del proceso"
                        onClick={() => { if (!String(window.getSelection?.() || "").length) verFichaMP(row); }}
                        style={{ cursor: "pointer", color: "var(--primary-dark)", textDecoration: "underline", textUnderlineOffset: 2, overflow: "hidden", textOverflow: "ellipsis", userSelect: "text" }}
                      >
                        {row.id_licitacion}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Abrir en Mercado Público"
                        onClick={(e) => { e.stopPropagation(); abrirPortalMP(row); }}
                        style={{ padding: 3, lineHeight: 0, flexShrink: 0, color: "var(--text-muted)" }}
                      >
                        <ExternalLink size={13} />
                      </button>
                    </div>
                  </td>
                  <td style={{ whiteSpace: "normal", wordBreak: "break-word", userSelect: "text" }}>{row.nombre || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td title={row?.datos?.organismo || ""} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{row?.datos?.organismo || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td title={row?.datos?.region || ""} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{row?.datos?.region || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600 }}>{row?.datos?.monto || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{row?.datos?.tipo || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                    {(() => {
                      const c = parseCierre(row?.datos?.cierre);
                      if (!c) return <span style={{ color: "var(--text-muted)" }}>—</span>;
                      const vig = estaVigente(row);
                      const conHora = cierreTraeHora(row?.datos?.cierre);
                      return (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: vig ? "var(--text)" : "var(--danger)", fontWeight: vig ? 500 : 700 }}>
                          {fmtFechaHora(c, conHora)}
                          {!vig && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c" }}>Vencida</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    {/* «Ya postulamos» — se muestra ANTES que cualquier otro
                        estado porque es lo que evita el trabajo repetido: si ya
                        existe una cotización nuestra con ese código, da lo mismo
                        que la fila figure como pendiente. */}
                    {(row.cotizacion_propia || row?.datos?.postulamos === true) && (
                      <div style={{ marginBottom: 4 }}>
                        <span
                          title={
                            row?.datos?.postulamos === true
                              ? `Confirmado en Mercado Público: nuestra oferta figura entre ${row.datos.postulamos_ofertas || "las"} recibidas` +
                                (row.datos.postulamos_monto ? ` · $${Number(row.datos.postulamos_monto).toLocaleString("es-CL")}` : "")
                              : `Ya existe una cotización nuestra con este código${row.cotizacion_propia?.vendedor_nombre ? " · " + row.cotizacion_propia.vendedor_nombre : ""}${row.cotizacion_propia?.estado ? " · " + row.cotizacion_propia.estado : ""}`
                          }
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", minWidth: 0,
                            fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                            background: row?.datos?.postulamos === true ? "#dbeafe" : "#ede9fe",
                            color: row?.datos?.postulamos === true ? "#1d4ed8" : "#6d28d9",
                          }}
                        >
                          {/* Solo la etiqueta: la columna mide 132px y el
                              nombre del vendedor se cortaba a la mitad. El
                              detalle completo va en el tooltip. */}
                          <Check size={12} style={{ flexShrink: 0 }} />
                          <span className="truncar">
                            {row?.datos?.postulamos === true ? "Postulada" : "Ya cotizada"}
                          </span>
                        </span>
                      </div>
                    )}
                    {row.no_aplica ? (
                      <span
                        title={`No aplica${row.no_aplica_por ? " · " + row.no_aplica_por : ""}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#e5e7eb", color: "#4b5563" }}
                      >
                        <Ban size={12} /> No aplica
                      </span>
                    ) : row.cargada ? (
                      <span
                        title={`Cargada por ${row.cargada_por || "—"}${row.cargada_at ? " · " + fmtFecha(row.cargada_at) : ""}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, maxWidth: "100%", minWidth: 0, background: "#dcfce7", color: "#15803d" }}
                      >
                        <Check size={12} style={{ flexShrink: 0 }} />
                        <span className="truncar">Cargada{row.cargada_por ? ` · ${nombreDe(row.cargada_por)}` : ""}</span>
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                        {caducada ? (
                          <span
                            title="Se venció sin llegar a cargarse (fuera de la fecha de cierre)"
                            style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c" }}
                          >
                            Caducada
                          </span>
                        ) : (
                          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef9c3", color: "#a16207" }}>
                            Pendiente
                          </span>
                        )}
                        {row.tomada_por && (
                          <span
                            title={`Tomada por ${row.tomada_por}`}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                              maxWidth: "100%", minWidth: 0,
                              background: mia ? "#dcfce7" : "#e0e7ff", color: mia ? "#15803d" : "#3730a3",
                            }}
                          >
                            <Check size={11} style={{ flexShrink: 0 }} />
                            {/* El texto va en su propio elemento: los puntos
                                suspensivos no funcionan sobre el hijo suelto de
                                un contenedor flex, y antes se cortaba en seco. */}
                            <span className="truncar">
                              {mia ? "Tomada por ti" : nombreDe(row.tomada_por)}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 4 }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={(e) => { e.stopPropagation(); cargarLicitacion(row); }}
                        title="Crear borrador de cotización con los datos de esta postulación"
                        style={{ padding: 6, lineHeight: 0, color: "var(--primary-dark)" }}
                      >
                        <FilePlus2 size={14} />
                      </button>
                      {esGestor && row.cargada && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={(e) => { e.stopPropagation(); desmarcar(row); }}
                          title="Desmarcar (volver a pendiente)"
                          style={{ padding: 6, lineHeight: 0 }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                      {esGestor && !row.cargada && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={(e) => { e.stopPropagation(); if (row.no_aplica) toggleNoAplica(row); else setConfirmNoAplica(row); }}
                          title={row.no_aplica ? "Restaurar al listado" : "Marcar «No Aplica»"}
                          style={{ padding: 6, lineHeight: 0, color: row.no_aplica ? "#a16207" : "var(--text-muted)" }}
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      {esGestor && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={(e) => { e.stopPropagation(); eliminar(row); }}
                          title="Quitar del listado"
                          style={{ padding: 6, lineHeight: 0 }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}

      {/* ── Explorar Mercado Público: búsqueda en vivo vía la API ── */}
      {vista === "explorar" && (
      <>
      <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* `.filter-field` es flex:1 con min-width 140: sin fijar el ancho al
            contenido, los tres botones se apretujan y las etiquetas se parten
            en dos líneas. */}
        <div className="filter-field" style={{ flex: "0 0 auto", minWidth: 0 }}>
          <label className="filter-label">Fuente</label>
          <div className="segmentado">
            {[
              ["todas", "Todas", "Compra Ágil y licitaciones en una sola tabla"],
              ["agil", "Compra Ágil", "Solo órdenes de Compra Ágil (procesos COT)"],
              ["licitaciones", "Licitaciones", "Solo licitaciones públicas activas (LE, LP, LQ…)"],
            ].map(([key, label, ayuda]) => (
              <button
                key={key}
                type="button"
                title={ayuda}
                className={mpFuente === key ? "activo" : undefined}
                onClick={() => { setMpFuente(key); setMpRes(null); }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
          <label className="filter-label">Palabra clave</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder={mpFuente === "agil" ? "Una o varias, separadas por coma… (ej: dental, resina, fresas)" : "Filtra por nombre o código; varias keywords separadas por coma…"}
              value={mpQ}
              onChange={(e) => setMpQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") buscarMP(1); }}
            />
          </div>
        </div>
        {(mpFuente === "agil" || mpFuente === "todas") && (
          <>
            <div className="filter-field">
              <label className="filter-label">Región</label>
              <select className="input" value={mpRegion} onChange={(e) => setMpRegion(e.target.value)} style={{ minWidth: 150 }}>
                <option value="">Todas</option>
                {MP_REGIONES.map(([cod, nombre]) => (
                  <option key={cod} value={cod}>{nombre}</option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label className="filter-label">Estado</label>
              <select className="input" value={mpEstado} onChange={(e) => setMpEstado(e.target.value)} style={{ minWidth: 170 }}>
                <option value="publicada">Publicadas (abiertas)</option>
                <option value="cerrada">Cerradas</option>
                <option value="proveedor_seleccionado">Proveedor seleccionado</option>
                <option value="desierta">Desiertas</option>
                <option value="">Todos</option>
              </select>
            </div>
            <div className="filter-field">
              <label className="filter-label">Publicada desde</label>
              <input type="date" className="input" value={mpDesde} max={mpHasta || undefined}
                onChange={(e) => setMpDesde(e.target.value)} style={{ width: 150 }} />
            </div>
            <div className="filter-field">
              <label className="filter-label">Publicada hasta</label>
              <input type="date" className="input" value={mpHasta} min={mpDesde || undefined}
                onChange={(e) => setMpHasta(e.target.value)} style={{ width: 150 }} />
            </div>
          </>
        )}
        {/* La API de Licitaciones (v1) solo acepta un día exacto de
            publicación: no hace rangos, no filtra por región y no admite otros
            estados. De ahí que aquí haya un único campo de fecha. */}
        {mpFuente === "licitaciones" && (
          <div className="filter-field">
            <label className="filter-label">Publicada el</label>
            <input type="date" className="input" value={mpDesde}
              title="Un día exacto. Vacío = todas las licitaciones activas."
              onChange={(e) => setMpDesde(e.target.value)} style={{ width: 150 }} />
          </div>
        )}
        {mpPuedeBuscar !== false && (
          <button
            className="btn btn-primary"
            onClick={() => buscarMP(1)}
            disabled={mpBuscando}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38 }}
          >
            <Search size={14} />
            {mpBuscando
              ? mpProgreso
                ? `${mpProgreso.hechas} de ${mpProgreso.total} palabras…`
                : "Buscando…"
              : "Buscar"}
          </button>
        )}
      </div>

      {/* De dónde vienen los resultados que se están mirando. Para quien no
          puede buscar a mano es LA información clave: sabe qué tan fresca es
          la foto y cuándo llega la próxima. */}
      {(mpAuto || mpPuedeBuscar === false) && !mpBuscando && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--text-soft)" }}>
          {mpAuto?.actualizado_at && (
            <span>
              Exploración automática del{" "}
              <b>{new Date(mpAuto.actualizado_at).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</b>
              {mpAuto.motivo ? ` (${mpAuto.motivo})` : ""}.
            </span>
          )}
          <span style={{ color: "var(--text-muted)" }}>
            Se actualiza sola a las 14:00 y 23:00
            {mpPuedeBuscar === false ? "; la búsqueda manual está restringida porque consume la cuota diaria de la API." : "."}
          </span>
        </div>
      )}

      {/* Avance de la búsqueda por tandas: los resultados van apareciendo en la
          tabla a medida que llegan (~15 s por tanda de 5 palabras), así que se
          puede empezar a revisar sin esperar el final. */}
      {mpBuscando && mpProgreso && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text-soft)", marginBottom: 4 }}>
            <span>
              Consultando Mercado Público: <b>{mpProgreso.hechas}</b> de {mpProgreso.total} palabras clave
              <span style={{ color: "var(--text-muted)" }}> · los resultados aparecen abajo a medida que llegan</span>
            </span>
            <span style={{ fontWeight: 700, color: restanteAprox(mpProgreso.etaMs) ? "var(--primary-dark)" : "var(--text-muted)" }}>
              {restanteAprox(mpProgreso.etaMs) ? `Queda ${restanteAprox(mpProgreso.etaMs)} aprox.` : "Calculando cuánto falta…"}
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: "var(--neutral-bg)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.min(100, (mpProgreso.hechas / Math.max(1, mpProgreso.total)) * 100)}%`,
              background: "var(--primary)",
              borderRadius: 999,
              transition: "width .4s ease",
            }} />
          </div>
        </div>
      )}

      {/* Búsquedas guardadas: combinaciones de palabras con nombre. Existen
          porque la API solo admite 8 términos por consulta y el catálogo tiene
          decenas: sin agruparlas habría que re-elegirlas a mano cada vez. */}
      {mpBusquedas.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Búsquedas guardadas:</span>
          {mpBusquedas.map((b) => (
            <span key={b.id} className={`chip-doble chip-guardada${esGestor ? "" : " chip-solo"}`}>
              <button
                type="button"
                className="chip-texto"
                onClick={() => setMpQ((b.keywords || []).join(", "))}
                title={`Aplicar: ${(b.keywords || []).join(", ")}`}
              >
                {b.nombre}
              </button>
              {esGestor && (
                <button
                  type="button"
                  className="chip-quitar"
                  onClick={() => eliminarBusquedaMp(b)}
                  aria-label={`Eliminar la búsqueda guardada "${b.nombre}"`}
                  title="Eliminar esta búsqueda guardada"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Palabras SELECCIONADAS + acceso al administrador. El catálogo completo
          no se lista acá: con decenas de términos tapaba la pantalla. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <button type="button" onClick={() => setMpKeywordsOpen(true)} className="btn btn-sm btn-secondary"
          title="Ver, agregar y quitar palabras clave"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
          <ClipboardList size={13} /> Palabras clave ({mpCatalogo.length})
        </button>
        {mpKeywords.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Ninguna seleccionada — ábrelas para elegir, o usa una búsqueda guardada.
          </span>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Buscando por:</span>
            {mpKeywords.map((k) => (
              <button key={k} type="button" onClick={() => toggleKeywordMP(k)} title="Quitar de la búsqueda"
                style={{
                  fontSize: 12, fontWeight: 600, padding: "3px 11px", borderRadius: 999, cursor: "pointer",
                  border: "1px solid var(--border)", background: "var(--primary)", color: "#fff",
                }}>
                {k} ×
              </button>
            ))}
            {esGestor && (
              <button type="button" onClick={guardarBusquedaMp} className="btn btn-sm btn-ghost"
                title="Guardar estas palabras como una búsqueda rápida"
                style={{ fontSize: 12, fontWeight: 700 }}>
                Guardar como búsqueda
              </button>
            )}
          </>
        )}
      </div>

      {mpKeywords.length > 20 && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 11px" }}>
          {mpKeywords.length > 80
            ? <>Seleccionaste {mpKeywords.length} palabras y el máximo por búsqueda es 80: las {mpKeywords.length - 80} últimas no se van a consultar.</>
            : <>Buscando por {mpKeywords.length} palabras: son unas {mpKeywords.length * 2} consultas a Mercado Público (cada palabra se busca en singular y plural), así que puede tardar cerca de un minuto y consume cuota diaria del ticket.</>}
        </div>
      )}

      {mpPrompt && (
        <PromptModal
          {...mpPrompt}
          onCancelar={() => setMpPrompt(null)}
          onError={(m) => setToast({ type: "error", message: m })}
          onListo={() => setMpPrompt(null)}
        />
      )}

      <ConfirmModal
        open={!!confirmGenerico}
        title={confirmGenerico?.title || ""}
        message={confirmGenerico?.message || ""}
        confirmText="Sí, quitar"
        onCancel={() => setConfirmGenerico(null)}
        onConfirm={() => { const f = confirmGenerico?.onConfirm; setConfirmGenerico(null); f?.(); }}
      />

      {mpKeywordsOpen && (
        <AdminKeywordsModal
          catalogo={mpCatalogo}
          seleccionadas={mpKeywords}
          esGestor={esGestor}
          onToggle={toggleKeywordMP}
          onAgregar={agregarKeywordMp}
          onEliminar={eliminarKeywordMp}
          onSeleccionarVarias={seleccionarKeywordsMp}
          onClose={() => setMpKeywordsOpen(false)}
        />
      )}

      {mpRes?.conteo_fuente && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <b>{mpRes.conteo_fuente.compra_agil}</b> de Compra Ágil · <b>{mpRes.conteo_fuente.licitaciones}</b> licitaciones activas.
          {mpRes.error_licitaciones && (
            <span style={{ color: "#b45309" }}> · No se pudo consultar licitaciones: {mpRes.error_licitaciones}</span>
          )}
        </div>
      )}

      {/* Una sola línea. El detalle de las limitaciones de cada API vive en los
          tooltips: es información que se consulta una vez y después estorba. */}
      <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
        Datos en vivo de Mercado Público · para ofertar entra a mercadopublico.cl ·{" "}
        <span
          style={{ cursor: "help", textDecoration: "underline dotted" }}
          title={
            "Compra Ágil: busca en el nombre y la descripción, por palabra completa (cada término se consulta también en singular y plural).\n\n" +
            "Licitaciones: la API antigua solo entrega código, nombre, estado y cierre — por eso organismo y monto van vacíos y no hay filtro de región, estado ni rango de fechas. A cambio busca por coincidencia parcial.\n\n" +
            "Pincha el código para ver la ficha completa."
          }
        >
          cómo funciona la búsqueda
        </span>
      </div>

      {/* Resultados. Alto acotado con scroll propio: la vista combinada
          devuelve todo en una sola página (89 filas con "dental", cientos con
          términos amplios como "insumo") y sin esto la página crece sin fin. */}
      <div className="surface" style={{ marginTop: 14, overflow: "auto", maxHeight: "62vh" }}>
        {/* El cartel de espera solo mientras NO haya nada que mostrar: la
            búsqueda va por tandas y la tabla se llena en vivo; taparla hasta el
            final era quedarse mirando un letrero con los resultados ya abajo. */}
        {mpBuscando && !(mpRes?.items || []).length ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Consultando Mercado Público…</div>
        ) : !mpRes ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
            Busca por palabra clave (o presiona Buscar sin filtros para ver lo más reciente).
          </div>
        ) : (mpRes.items || []).length === 0 ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
            {mpBuscando ? "Consultando Mercado Público…" : "Sin resultados para esa búsqueda."}
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%", minWidth: 1100 }}>
            {/* Encabezado fijo al hacer scroll dentro de la tabla. */}
            <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface)", boxShadow: "0 1px 0 var(--border)" }}>
              <tr>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 160 }}>Código</th>
                <th style={{ textAlign: "left", width: 70 }} title="Tipo de proceso según el código: Ágil = Compra Ágil; LE/LP/LQ… = licitación pública por tramo de monto">Tipo</th>
                <th style={{ textAlign: "left" }}>Nombre</th>
                <th style={{ textAlign: "left", width: 200 }}>Organismo</th>
                <th style={{ textAlign: "left", width: 120 }}>Región</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap", width: 110 }}>Monto (CLP)</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 130 }}>Cierre</th>
                <th style={{ textAlign: "left", width: 130 }}>Estado</th>
                <th style={{ textAlign: "center", width: 64 }}>Ofertas</th>
                <th style={{ textAlign: "left", width: 100 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {mpRes.items.map((item) => {
                const ec = String(item.estado_codigo || "");
                const tono = ec === "publicada" || ec === "5"
                  ? { bg: "#dcfce7", fg: "#15803d" }
                  : ec === "proveedor_seleccionado" || ec === "8"
                  ? { bg: "#dbeafe", fg: "#1d4ed8" }
                  : ec === "cerrada" || ec === "6"
                  ? { bg: "#fef3c7", fg: "#b45309" }
                  : { bg: "#f1f5f9", fg: "#64748b" };
                const cierre = item.fecha_cierre ? fmtFechaHora(new Date(item.fecha_cierre), true) : "—";
                // Toda la fila abre la ficha, igual que en el Listado. El guard
                // de getSelection deja seleccionar texto sin disparar el modal.
                return (
                  <tr
                    key={item.codigo}
                    title="Ver ficha del proceso"
                    onClick={() => { if (!String(window.getSelection?.() || "").length) verFichaMP({ id_licitacion: item.codigo, datos: {} }, item); }}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ fontWeight: 600, whiteSpace: "nowrap", color: "var(--primary-dark)", textDecoration: "underline", textUnderlineOffset: 2 }}>
                      {item.codigo}
                    </td>
                    {/* Tipo de proceso deducido del sufijo del código (COT,
                        LE, LP…). Distingue de un vistazo una Compra Ágil de una
                        licitación pública, y de qué tramo de monto es. */}
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span
                        title={item.tipo_sigla ? `${item.tipo_sigla} · ${item.tipo_label}` : "Tipo no reconocido"}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                          background: item.tipo_familia === "compra_agil" ? "#ecfeff" : "#f5f3ff",
                          color: item.tipo_familia === "compra_agil" ? "#0e7490" : "#6d28d9",
                          border: `1px solid ${item.tipo_familia === "compra_agil" ? "#a5f3fc" : "#ddd6fe"}`,
                        }}
                      >
                        {item.tipo_familia === "compra_agil" ? "Ágil" : (item.tipo_sigla || "—")}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal", wordBreak: "break-word", fontSize: 12.5 }}>
                      {item.nombre || "—"}
                      {/* Por qué está en la lista: la(s) palabra(s) clave que
                          calzaron. Trazabilidad pedida cuando aparecían
                          procesos ajenos y no se sabía por cuál palabra. */}
                      {Array.isArray(item.match_keywords) && item.match_keywords.length > 0 && (
                        <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-muted)" }}
                          title={`Palabras clave que calzaron: ${item.match_keywords.join(", ")}`}>
                          <Search size={10} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                          {item.match_keywords.slice(0, 3).join(" · ")}
                          {item.match_keywords.length > 3 ? ` · +${item.match_keywords.length - 3}` : ""}
                        </div>
                      )}
                    </td>
                    <td title={item.organismo} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5, maxWidth: 200 }}>{item.organismo || "—"}</td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{item.region || "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, fontSize: 12.5 }}>
                      {item.monto_clp != null ? `$${Number(item.monto_clp).toLocaleString("es-CL")}` : "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>{cierre}</td>
                    <td>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: tono.bg, color: tono.fg, whiteSpace: "nowrap" }}>
                        {item.estado || "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center", fontSize: 12.5 }}>{item.ofertas ?? "—"}</td>
                    {/* stopPropagation: los botones no deben abrir la ficha
                        de la fila al hacer clic. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Agregar al Listado de Postulaciones (sin tomarla)"
                        disabled={agregandoCodigo === item.codigo}
                        onClick={() => agregarAPostulaciones(item)}
                        style={{ padding: 6, lineHeight: 0, color: "var(--primary-dark)" }}
                      >
                        <ClipboardList size={15} />
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Tomarla: la agrega al Listado, ocupa uno de tus 3 cupos y avisa al chat grupal"
                        disabled={agregandoCodigo === item.codigo}
                        onClick={() => tomarDesdeExploracion(item)}
                        style={{ padding: 6, lineHeight: 0, color: "var(--success)" }}
                      >
                        <Check size={15} />
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Crear una cotización en borrador con los datos de este proceso (sin pasar por el Listado)"
                        onClick={() => cotizarDesdeExploracion(item)}
                        style={{ padding: 6, lineHeight: 0, color: "#6d28d9" }}
                      >
                        <FilePlus2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {mpRes && (mpRes.items || []).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {Number(mpRes.paginacion?.total_resultados || 0).toLocaleString("es-CL")} resultado(s) ·
              página {mpRes.paginacion?.numero_pagina || 1} de {mpRes.paginacion?.total_paginas || 1}
              {mpRes.actualizado && ` · listado actualizado ${fmtFechaHora(new Date(mpRes.actualizado), true)}`}
              {Array.isArray(mpRes.por_keyword) && mpRes.por_keyword.length > 0 && (
                <>
                  {" · "}
                  {mpRes.por_keyword.map((k, i) => (
                    <span key={k.q}>
                      {i > 0 && " · "}
                      {/* El motivo del fallo va en el tooltip: decir solo
                          "error" obligaba a adivinar si era cuota, timeout o
                          un problema de la propia palabra. */}
                      <b>{k.q}</b>: {k.error
                        ? <span style={{ color: "#b91c1c", cursor: "help", textDecoration: "underline dotted" }} title={k.error}>error</span>
                        : k.total > k.traidos ? `${k.traidos} de ${Number(k.total).toLocaleString("es-CL")}` : k.total}
                    </span>
                  ))}
                </>
              )}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn btn-sm btn-secondary"
                disabled={mpBuscando || (mpRes.paginacion?.numero_pagina || 1) <= 1}
                onClick={() => buscarMP((mpRes.paginacion?.numero_pagina || 1) - 1)}
              >
                ← Anterior
              </button>
              <button
                className="btn btn-sm btn-secondary"
                disabled={mpBuscando || (mpRes.paginacion?.numero_pagina || 1) >= (mpRes.paginacion?.total_paginas || 1)}
                onClick={() => buscarMP((mpRes.paginacion?.numero_pagina || 1) + 1)}
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      <ConfirmModal
        open={!!confirmTomar}
        title="Tomar postulación"
        message={`¿Tomar la postulación ${confirmTomar?.id_licitacion || ""}? Quedará reservada a tu nombre (máximo ${MAX_TOMADAS}). Se libera al crear su cotización.`}
        confirmText="Tomar"
        cancelText="Cancelar"
        confirmTone="primary"
        onConfirm={() => { const r = confirmTomar; setConfirmTomar(null); if (r) toggleTomar(r); }}
        onCancel={() => setConfirmTomar(null)}
      />

      <ConfirmModal
        open={!!confirmNoAplica}
        title="Marcar «No Aplica»"
        message={`¿Marcar la postulación ${confirmNoAplica?.id_licitacion || ""} como «No Aplica»? Saldrá del listado de pendientes. Podrás restaurarla luego desde el filtro «No aplica».`}
        confirmText="Marcar No Aplica"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={() => { const r = confirmNoAplica; setConfirmNoAplica(null); if (r) toggleNoAplica(r); }}
        onCancel={() => setConfirmNoAplica(null)}
      />

      <ConfirmModal
        open={confirmBorrarTodas}
        title="Borrar todo el listado"
        message={`¿Eliminar TODAS las postulaciones del listado (${lista.length})? Esta acción no se puede deshacer.`}
        confirmText="Borrar todas"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={borrarTodas}
        onCancel={() => setConfirmBorrarTodas(false)}
      />

      {uploadOpen && (
        <ModalSubirListado
          onClose={() => setUploadOpen(false)}
          onDone={(res) => {
            setUploadOpen(false);
            setToast({ type: "success", message: `Listado cargado: ${res.insertados} nueva(s), ${res.duplicados} ya existían.` });
            cargar();
          }}
          onToast={setToast}
        />
      )}

      {/* Popup: ficha del proceso consultada en vivo a Mercado Público */}
      {mpFicha && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setMpFicha(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: 680, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <ClipboardList size={17} style={{ color: "var(--primary)" }} /> Ficha · {mpFicha.codigo}
              </h3>
              <button className="btn btn-ghost" onClick={() => setMpFicha(null)} style={{ padding: 6 }}><X size={16} /></button>
            </div>

            {mpFicha.loading ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                Consultando Mercado Público…
              </div>
            ) : mpFicha.error ? (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, marginBottom: 12 }}>
                {mpFicha.error}
              </div>
            ) : mpFicha.data ? (() => {
              const d = mpFicha.data;
              const TONOS = {
                green: { bg: "#dcfce7", fg: "#15803d" },
                blue: { bg: "#dbeafe", fg: "#1d4ed8" },
                amber: { bg: "#fef3c7", fg: "#b45309" },
                red: { bg: "#fee2e2", fg: "#b91c1c" },
                gray: { bg: "#f1f5f9", fg: "#64748b" },
              };
              const tono = TONOS[d.tono] || TONOS.gray;
              const conAdjudicacion = (d.productos || []).some((p) => p.adjudicacion);
              return (
                <>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: tono.bg, color: tono.fg }}>{d.estado}</span>
                    {(d.chips || []).map((c) => (
                      <span key={c} style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#eef2ff", color: "#3730a3" }}>{c}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{d.nombre}</div>
                  {d.descripcion && d.descripcion !== d.nombre && (
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10 }}>{d.descripcion}</div>
                  )}

                  {(d.productos || []).length > 0 && (
                    <div style={{ margin: "12px 0" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Productos o servicios ({d.productos.length})</div>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "left" }}>
                              <th style={{ padding: "6px 10px", width: 26 }}>#</th>
                              <th style={{ padding: "6px 10px" }}>Producto</th>
                              <th style={{ padding: "6px 10px", textAlign: "right", width: 90 }}>Cantidad</th>
                              {conAdjudicacion && <th style={{ padding: "6px 10px" }}>Adjudicación</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {d.productos.map((p, i) => (
                              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                                <td style={{ padding: "6px 10px", color: "var(--text-muted)" }}>{i + 1}</td>
                                <td style={{ padding: "6px 10px" }}>
                                  <div style={{ fontWeight: 600 }}>{p.nombre}{p.codigo ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · Cod: {p.codigo}</span> : null}</div>
                                  {p.descripcion && <div style={{ color: "var(--text-muted)", whiteSpace: "normal" }}>{p.descripcion}</div>}
                                </td>
                                <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>
                                  {Number(p.cantidad || 0).toLocaleString("es-CL")} {p.unidad}
                                </td>
                                {conAdjudicacion && (
                                  <td style={{ padding: "6px 10px", whiteSpace: "normal", fontSize: 11.5 }}>
                                    {p.adjudicacion || <span style={{ color: "var(--text-muted)" }}>—</span>}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {(d.secciones || []).map((s) => (
                    <div key={s.titulo} style={{ margin: "12px 0" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{s.titulo}</div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                        <tbody>
                          {s.filas.map(([k, v], i) => (
                            <tr key={k} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                              <td style={{ padding: "6px 12px", color: "var(--text-muted)", whiteSpace: "nowrap", verticalAlign: "top", width: 190 }}>{k}</td>
                              <td style={{ padding: "6px 12px", fontWeight: 600, wordBreak: "break-word" }}>{String(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                    Fuente: {d.fuente} · consultado en vivo desde Mercado Público.
                  </div>
                </>
              );
            })() : null}

            {/* Por qué apareció en la búsqueda: las palabras clave que calzaron. */}
            {Array.isArray(mpFicha.itemExplorar?.match_keywords) && mpFicha.itemExplorar.match_keywords.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 12, fontSize: 12, color: "var(--text-soft)" }}>
                <span style={{ fontWeight: 700 }}>Calzó con:</span>
                {mpFicha.itemExplorar.match_keywords.map((k) => (
                  <span key={k} style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: "var(--neutral-bg)", border: "1px solid var(--border)" }}>
                    {k}
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {/* Solo cuando la ficha viene de la exploración: desde el Listado
                  la cotización se crea con «Cargar», que reserva el cupo. */}
              {mpFicha.itemExplorar && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => { const it = mpFicha.itemExplorar; setMpFicha(null); tomarDesdeExploracion(it); }}
                    disabled={agregandoCodigo === mpFicha.itemExplorar.codigo}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    title="La agrega al Listado, ocupa uno de tus 3 cupos y avisa al chat grupal"
                  >
                    <Check size={14} /> Tomar
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { const it = mpFicha.itemExplorar; setMpFicha(null); cotizarDesdeExploracion(it); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <FilePlus2 size={14} /> Crear cotización (borrador)
                  </button>
                </>
              )}
              {mpFicha.data && (
                <button
                  className={mpFicha.itemExplorar ? "btn btn-secondary" : "btn btn-primary"}
                  onClick={descargarFichaPDF}
                  disabled={descargandoFicha}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <FileDown size={14} /> {descargandoFicha ? "Generando…" : "Descargar PDF"}
                </button>
              )}
              {mpFicha.data?.url_acta && (
                <a className="btn btn-secondary" href={mpFicha.data.url_acta} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ExternalLink size={14} /> Acta de adjudicación
                </a>
              )}
              {mpFicha.urlFicha && (
                <a className="btn btn-secondary" href={mpFicha.urlFicha} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ExternalLink size={14} /> Abrir en Mercado Público
                </a>
              )}
              <button className="btn btn-secondary" onClick={() => setMpFicha(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: "fixed", bottom: 22, right: 22, zIndex: 12000, cursor: "pointer",
            background: toast.type === "error" ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${toast.type === "error" ? "#fecaca" : "#bbf7d0"}`,
            color: toast.type === "error" ? "#b91c1c" : "#15803d",
            padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "var(--shadow-lg)", maxWidth: 380,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

/* ── Modal: subir xlsx (ID + Nombre) ──────────────────────────────────── */
function ModalSubirListado({ onClose, onDone, onToast }) {
  const inputRef = useRef(null);
  const [filas, setFilas] = useState([]);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [parsing, setParsing] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function manejarArchivo(file) {
    if (!file) return;
    setNombreArchivo(file.name);
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      // Trae TODAS las columnas del portal (ID, Nombre, Descripción, Organismo,
      // Tipo, Región, Monto, Cierre, Publicación, URL Ficha, Líneas de negocio) y
      // también cualquier columna extra no prevista. El match de encabezados es
      // tolerante a acentos y a problemas de codificación (ej. "DescripciÃ³n"):
      // se compara sobre un esqueleto ASCII y por prefijos cortos previos al
      // primer acento, así "Región"/"RegiÃ³n" caen ambos en "regi". Solo ID es
      // obligatorio.
      const normKey = (k) =>
        String(k || "")
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "") // quita tildes combinantes
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ") // colapsa símbolos raros de encoding
          .trim();
      const slug = (k) => normKey(k).replace(/\s+/g, "_");
      const norm = [];
      const vistos = new Set();
      for (const row of raw) {
        const o = { id_licitacion: "", nombre: "", datos: {} };
        for (const [k, v] of Object.entries(row)) {
          const key = normKey(k);
          if (!key) continue;
          const val = typeof v === "string" ? v.trim() : (v == null ? "" : String(v));
          if (key === "id" || key.startsWith("id ")) o.id_licitacion = o.id_licitacion || val;
          else if (key.startsWith("nombre")) o.nombre = val;
          else if (key.startsWith("descrip")) o.datos.descripcion = val;
          else if (key.startsWith("organ")) o.datos.organismo = val;
          else if (key.startsWith("tipo")) o.datos.tipo = val;
          else if (key.startsWith("regi")) o.datos.region = val;
          else if (key.startsWith("monto")) o.datos.monto = val;
          else if (key.startsWith("cierre")) o.datos.cierre = val;
          else if (key.startsWith("public")) o.datos.publicacion = val;
          else if (key.includes("url") || key.includes("ficha")) o.datos.url_ficha = val;
          else if (key.includes("negocio") || key.includes("linea") || key.includes("laneas")) o.datos.lineas_negocio = val;
          // Cualquier otra columna se guarda igual, para no perder nada.
          else o.datos[slug(k)] = val;
        }
        if (!o.id_licitacion) continue;
        const dedup = o.id_licitacion.toLowerCase();
        if (vistos.has(dedup)) continue;
        vistos.add(dedup);
        norm.push(o);
      }
      setFilas(norm);
      if (!norm.length) onToast?.({ type: "error", message: "No se encontraron filas con columna 'ID'." });
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: "No se pudo leer el archivo. ¿Es un .xlsx válido?" });
      setFilas([]);
    } finally {
      setParsing(false);
    }
  }

  async function enviar() {
    if (!filas.length) return;
    setEnviando(true);
    try {
      const res = await api.post("/licitaciones/disponibles/bulk", { rows: filas });
      onDone?.(res || { insertados: 0, duplicados: 0 });
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: "No se pudo subir el listado." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: 520, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <FileSpreadsheet size={18} /> Subir listado de postulaciones
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 14 }}>
          Solo <strong>ID</strong> es obligatorio. Se importan todas las columnas del portal
          (Nombre, Descripción, Organismo, Tipo, Región, Monto, Cierre, Publicación, URL Ficha,
          Líneas de negocio y cualquier otra). Las postulaciones ya existentes (mismo ID) se omiten.
        </p>

        <div
          onClick={() => inputRef.current?.click()}
          style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: "22px 16px", textAlign: "center", cursor: "pointer", background: "var(--bg)" }}
        >
          <Upload size={22} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {nombreArchivo ? <strong>{nombreArchivo}</strong> : "Haz clic para elegir un archivo .xlsx / .xls / .csv"}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: "none" }}
            onChange={(e) => manejarArchivo(e.target.files?.[0])}
          />
        </div>

        {parsing && <p style={{ fontSize: 12.5, marginTop: 10 }}>Leyendo archivo…</p>}
        {!parsing && filas.length > 0 && (
          <p style={{ fontSize: 13, marginTop: 12, color: "var(--text)" }}>
            <strong>{filas.length}</strong> postulación(es) detectada(s) en el archivo.
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={enviar} disabled={enviando || parsing || filas.length === 0}>
            {enviando ? "Subiendo…" : `Subir ${filas.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Administrador de palabras clave de Explorar Mercado Público
   ─ Vive en un modal y no en la barra porque el catálogo tiene
     decenas de términos: en línea tapaba la pantalla.
   ─ El buscador de arriba filtra la lista, no la base.
   ─ Agregar/quitar del catálogo es solo para gestores; elegir
     cuáles se buscan lo puede hacer cualquiera.
============================================================ */
function AdminKeywordsModal({ catalogo, seleccionadas, esGestor, onToggle, onAgregar, onEliminar, onSeleccionarVarias, onClose }) {
  const [filtro, setFiltro] = useState("");

  const q = filtro.trim().toLowerCase();
  const visibles = q
    ? catalogo.filter((k) => k.texto.toLowerCase().includes(q))
    : catalogo;
  const estaActiva = (texto) => seleccionadas.some((x) => x.toLowerCase() === texto.toLowerCase());

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 9999,
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#fff", borderRadius: 12, width: "min(860px, 100%)", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ClipboardList size={18} /> Palabras clave ({catalogo.length})
          </h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>
        {/* El texto decía "la API admite hasta 8 por consulta", que era de
            cuando las palabras estaban fijas en el código. La API acepta UN
            término por llamada y el backend hace una llamada por palabra: el
            tope de 80 es nuestro, para no vaciar la cuota diaria del ticket. */}
        <p style={{ fontSize: 12.5, color: "#64748b", marginTop: 0 }}>
          Clic en una palabra para incluirla o sacarla de la búsqueda. Cada palabra es una consulta aparte
          a Mercado Público, así que mientras más elijas, más se demora y más cuota diaria consume;
          el máximo por búsqueda es <strong>80</strong>.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              className="input"
              style={{ paddingLeft: 30, width: "100%" }}
              placeholder="Filtrar palabras…"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              autoFocus
            />
          </div>
          {esGestor && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onAgregar} style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
              + Agregar palabra
            </button>
          )}
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          fontSize: 12, fontWeight: 700, marginBottom: 6,
          color: seleccionadas.length > 80 ? "#b45309" : "var(--text-muted)",
        }}>
          <span>
            {seleccionadas.length} seleccionada{seleccionadas.length === 1 ? "" : "s"}
            {seleccionadas.length > 80 ? ` · solo se consultarán las primeras 80` : ""}
          </span>
          {/* Con filtro activo, seleccionar/deseleccionar aplica solo a lo que
              está a la vista: así se puede filtrar "fresa" y tomar todas de una. */}
          <span style={{ display: "inline-flex", gap: 4 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSeleccionarVarias(visibles.map((k) => k.texto), true)}
              disabled={visibles.length === 0 || visibles.every((k) => estaActiva(k.texto))}
              style={{ fontSize: 12 }}
            >
              {q ? `Seleccionar las ${visibles.length} visibles` : "Seleccionar todas"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSeleccionarVarias(visibles.map((k) => k.texto), false)}
              disabled={!visibles.some((k) => estaActiva(k.texto))}
              style={{ fontSize: 12 }}
            >
              {q ? "Deseleccionar visibles" : "Deseleccionar todas"}
            </button>
          </span>
        </div>

        <div style={{
          maxHeight: "52vh", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10,
          display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start",
        }}>
          {visibles.length === 0 && (
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {catalogo.length === 0
                ? "El catálogo está vacío. Falta aplicar la migración 20260810_mp_keywords_busquedas.sql."
                : `Ninguna palabra coincide con "${filtro}".`}
            </span>
          )}
          {visibles.map((k) => {
            const activa = estaActiva(k.texto);
            return (
              <span
                key={k.id}
                className={`chip-doble${activa ? " activa" : ""}${esGestor ? "" : " chip-solo"}`}
              >
                <button
                  type="button"
                  className="chip-texto"
                  onClick={() => onToggle(k.texto)}
                  aria-pressed={activa}
                  title={activa ? `Sacar "${k.texto}" de la búsqueda` : `Incluir "${k.texto}" en la búsqueda`}
                >
                  {activa ? `${k.texto} ✓` : k.texto}
                </button>
                {esGestor && (
                  <button
                    type="button"
                    className="chip-quitar"
                    onClick={() => onEliminar(k)}
                    aria-label={`Quitar "${k.texto}" del catálogo`}
                    title={`Quitar "${k.texto}" del catálogo`}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ============================================================
   Modal de texto — reemplaza window.prompt
   El diálogo nativo del navegador rompe el estilo de la app y no
   permite validar mientras se escribe ni mostrar contexto.
============================================================ */
function PromptModal({ titulo, ayuda, placeholder, confirmar = "Guardar", onConfirmar, onCancelar, onListo, onError }) {
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function aceptar() {
    const v = valor.trim();
    if (!v || guardando) return;
    setGuardando(true);
    try {
      await onConfirmar(v);
      onListo?.();
    } catch (e) {
      onError?.(e?.message || "No se pudo guardar.");
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !guardando) onCancelar(); }}
    >
      <div style={{ background: "#fff", borderRadius: 12, width: "min(460px, 100%)", padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <h3 style={{ margin: "0 0 4px" }}>{titulo}</h3>
        {ayuda && <p style={{ fontSize: 12.5, color: "#64748b", margin: "0 0 12px" }}>{ayuda}</p>}
        <input
          className="input"
          style={{ width: "100%" }}
          placeholder={placeholder}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") aceptar();
            if (e.key === "Escape" && !guardando) onCancelar();
          }}
          autoFocus
          disabled={guardando}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={aceptar} disabled={!valor.trim() || guardando}>
            {guardando ? "Guardando…" : confirmar}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
