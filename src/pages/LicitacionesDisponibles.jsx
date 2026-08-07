// LicitacionesDisponibles.jsx
// Listado de licitaciones "disponibles" (publicadas) que se sube por xlsx
// (columnas ID + Nombre). Los ejecutivos ven el listado y "cargan" cada
// licitación, lo que abre una Nueva Cotización prellenada y marca la fila.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import DateFilter from "../components/DateFilter";
import ConfirmModal from "../components/ConfirmModal";
import { Upload, Search, FileSpreadsheet, Trash2, X, ClipboardList, Check, RotateCcw, Ban, FilePlus2, ExternalLink, FileDown } from "lucide-react";

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

// Una postulación está "vigente" si su cierre aún no pasa (o si no tiene fecha
// de cierre registrada, para no ocultarla por falta de dato). Si el cierre
// trae hora, la vigencia respeta la hora exacta; sin hora, dura hasta las
// 23:59 de ese día (default de parseCierre).
function estaVigente(row) {
  const cierre = parseCierre(row?.datos?.cierre);
  if (!cierre) return true;
  return cierre.getTime() >= Date.now();
}

// Regiones de la API de Mercado Público (código 1-16).
const MP_REGIONES = [
  [13, "Metropolitana"], [1, "Tarapacá"], [2, "Antofagasta"], [3, "Atacama"],
  [4, "Coquimbo"], [5, "Valparaíso"], [6, "O'Higgins"], [7, "Maule"],
  [8, "Biobío"], [9, "Araucanía"], [10, "Los Lagos"], [11, "Aysén"],
  [12, "Magallanes y Antártica"], [14, "Los Ríos"], [15, "Arica y Parinacota"], [16, "Ñuble"],
];

// Keywords sugeridas para el rubro (la API busca en nombre/descripción).
const MP_KEYWORDS = ["dental", "odontolog", "insumos dentales", "resina", "anestesia", "ortodoncia", "implante", "fresas"];

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
  const [fechaDesde, setFechaDesde] = useState(""); // filtro por fecha de carga del archivo
  const [fechaHasta, setFechaHasta] = useState("");
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
  const [mpFuente, setMpFuente] = useState("agil"); // agil | licitaciones
  const [mpQ, setMpQ] = useState("");
  const [mpRegion, setMpRegion] = useState("");
  const [mpEstado, setMpEstado] = useState("publicada");
  const [mpRes, setMpRes] = useState(null); // { items, paginacion, actualizado }
  const [mpBuscando, setMpBuscando] = useState(false);
  const [agregandoCodigo, setAgregandoCodigo] = useState(null);

  async function buscarMP(pagina = 1, qOverride = null) {
    if (mpBuscando) return;
    setMpBuscando(true);
    try {
      const qp = new URLSearchParams({ fuente: mpFuente, pagina: String(pagina), tamano: "15" });
      const q = (qOverride ?? mpQ).trim();
      if (q) qp.set("q", q);
      if (mpFuente === "agil") {
        if (mpRegion) qp.set("region", mpRegion);
        if (mpEstado) qp.set("estado", mpEstado);
      }
      const data = await api.get(`/licitaciones/mercado-publico/buscar?${qp.toString()}`);
      setMpRes(data);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo buscar en Mercado Público." });
    } finally {
      setMpBuscando(false);
    }
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
            tipo: mpFuente === "agil" ? "Compra Ágil" : "Licitación",
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

  async function verFichaMP(row) {
    const codigo = String(row.id_licitacion || "").trim();
    if (!codigo) return;
    const urlFicha = String(row?.datos?.url_ficha || "").trim();
    setMpFicha({ codigo, urlFicha, loading: true, data: null, error: "" });
    try {
      const data = await api.get(`/licitaciones/mercado-publico/${encodeURIComponent(codigo)}`);
      setMpFicha((prev) => (prev?.codigo === codigo ? { ...prev, loading: false, data } : prev));
    } catch (e) {
      setMpFicha((prev) => (prev?.codigo === codigo
        ? { ...prev, loading: false, error: e?.message || "No se pudo consultar Mercado Público." }
        : prev));
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
      if (filtro === "pendientes" && l.cargada) return false;
      if (filtro === "cargadas" && !l.cargada) return false;
      if (filtro === "mias" && (l.tomada_por || "").toLowerCase() !== currentEmail) return false;
      // "Caducadas": no alcanzaron a cargarse antes de la fecha de cierre.
      // Ignora el filtro de Disponibilidad (una caducada es siempre vencida).
      if (filtro === "caducadas") {
        if (l.cargada || estaVigente(l)) return false;
      } else if (dispon !== "todas") {
        // Disponibilidad según la fecha de Cierre del portal (datos.cierre).
        const vig = estaVigente(l);
        if (dispon === "vigentes" && !vig) return false;
        if (dispon === "vencidas" && vig) return false;
      }
      if (filtroTipo && String(l?.datos?.tipo || "").trim() !== filtroTipo) return false;
      const fCarga = String(l.created_at || "").slice(0, 10);
      if (fechaDesde && fCarga && fCarga < fechaDesde) return false;
      if (fechaHasta && fCarga && fCarga > fechaHasta) return false;
      if (!q) return true;
      return (
        String(l.id_licitacion || "").toLowerCase().includes(q) ||
        String(l.nombre || "").toLowerCase().includes(q)
      );
    });
    // NO se reordena aquí: el orden "tomadas primero" se aplica solo al cargar
    // (ver efecto abajo), para que marcar/desmarcar no mueva las filas de golpe.
    return arr;
  }, [lista, busqueda, filtro, filtroTipo, dispon, fechaDesde, fechaHasta, currentEmail]);

  const stats = useMemo(() => ({
    total: lista.length,
    pendientes: lista.filter((l) => !l.cargada && !l.no_aplica).length,
    cargadas: lista.filter((l) => l.cargada).length,
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
      // Se publica como TARJETA de licitación (mismo formato probado que ya usa
      // el chat), más visible que un texto plano.
      const { error } = await supabase.from("chat_mensajes").insert({
        autor_email: currentEmail,
        autor_nombre: perfil?.nombre || user?.email || "—",
        tipo: "licitacion",
        sala_id: salaId,
        texto: row.nombre || null,
        licitacion_id: row.id_licitacion,
        licitacion_estado: "Tomada",
      });
      if (error) throw error;
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
      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-sub">en el listado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{stats.pendientes}</div>
          <div className="stat-sub">por tomar</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cargadas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.cargadas}</div>
          <div className="stat-sub">ya tomadas</div>
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
          <table className="data-table" style={{ width: "100%", minWidth: 1180, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "center", width: 64 }}>Tomar</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 150 }}>ID Licitación</th>
                <th style={{ textAlign: "left" }}>Nombre</th>
                <th style={{ textAlign: "left", width: 190 }}>Organismo</th>
                <th style={{ textAlign: "left", width: 150 }}>Región</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap", width: 120 }}>Monto</th>
                <th style={{ textAlign: "left", width: 100 }}>Tipo</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 150 }}>Cierre</th>
                <th style={{ textAlign: "left", width: 120 }}>Estado</th>
                <th style={{ textAlign: "left", width: 118 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((row) => {
                const mia = (row.tomada_por || "").toLowerCase() === currentEmail;
                const deOtro = !!row.tomada_por && !mia;
                const vencida = !estaVigente(row);
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
                    {row.no_aplica ? (
                      <span
                        title={`No aplica${row.no_aplica_por ? " · " + row.no_aplica_por : ""}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#e5e7eb", color: "#4b5563" }}
                      >
                        <Ban size={12} /> No aplica
                      </span>
                    ) : row.cargada ? (
                      <span
                        title={`${row.cargada_por || ""}${row.cargada_at ? " · " + fmtFecha(row.cargada_at) : ""}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}
                      >
                        <Check size={12} /> Cargada{row.cargada_por ? ` · ${row.cargada_por}` : ""}
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
                              whiteSpace: "nowrap", maxWidth: 118, overflow: "hidden", textOverflow: "ellipsis",
                              background: mia ? "#dcfce7" : "#e0e7ff", color: mia ? "#15803d" : "#3730a3",
                            }}
                          >
                            <Check size={11} /> {mia ? "Tomada por ti" : `Tomada · ${row.tomada_por}`}
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
        <div className="filter-field">
          <label className="filter-label">Fuente</label>
          <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)", height: 38 }}>
            {[["agil", "Compra Ágil"], ["licitaciones", "Licitaciones (activas)"]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setMpFuente(key); setMpRes(null); }}
                style={{
                  padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none",
                  background: mpFuente === key ? "var(--primary)" : "var(--surface)",
                  color: mpFuente === key ? "#fff" : "var(--text-muted)",
                }}
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
              placeholder={mpFuente === "agil" ? "Busca en nombre y descripción… (ej: insumos dentales)" : "Filtra las licitaciones activas por nombre o código…"}
              value={mpQ}
              onChange={(e) => setMpQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") buscarMP(1); }}
            />
          </div>
        </div>
        {mpFuente === "agil" && (
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
          </>
        )}
        <button
          className="btn btn-primary"
          onClick={() => buscarMP(1)}
          disabled={mpBuscando}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38 }}
        >
          <Search size={14} /> {mpBuscando ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {/* Keywords sugeridas del rubro */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Sugerencias:</span>
        {MP_KEYWORDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => { setMpQ(k); buscarMP(1, k); }}
            style={{
              fontSize: 12, fontWeight: 600, padding: "3px 11px", borderRadius: 999, cursor: "pointer",
              border: "1px solid var(--border)", background: mpQ === k ? "var(--primary)" : "var(--surface)",
              color: mpQ === k ? "#fff" : "var(--text-muted)",
            }}
          >
            {k}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
        Resultados en vivo de la API de Mercado Público. Para <b>ofertar</b> debes ingresar con tu clave en
        mercadopublico.cl (la API es de solo lectura); desde aquí puedes ver la ficha, descargar el PDF y
        <b> agregar el proceso al Listado</b> para tomarlo y crear su cotización.
        {mpFuente === "licitaciones" && " Las licitaciones activas se listan con datos resumidos (la API v1 no entrega organismo ni montos en el listado); pincha el código para ver la ficha completa."}
      </div>

      {/* Resultados */}
      <div className="surface" style={{ marginTop: 14, overflowX: "auto" }}>
        {mpBuscando ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Consultando Mercado Público…</div>
        ) : !mpRes ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>
            Busca por palabra clave (o presiona Buscar sin filtros para ver lo más reciente).
          </div>
        ) : (mpRes.items || []).length === 0 ? (
          <div style={{ padding: "36px 24px", color: "var(--text-muted)" }}>Sin resultados para esa búsqueda.</div>
        ) : (
          <table className="data-table" style={{ width: "100%", minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 160 }}>Código</th>
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
                return (
                  <tr key={item.codigo}>
                    <td
                      title="Ver ficha del proceso"
                      onClick={() => verFichaMP({ id_licitacion: item.codigo, datos: {} })}
                      style={{ fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", color: "var(--primary-dark)", textDecoration: "underline", textUnderlineOffset: 2 }}
                    >
                      {item.codigo}
                    </td>
                    <td style={{ whiteSpace: "normal", wordBreak: "break-word", fontSize: 12.5 }}>{item.nombre || "—"}</td>
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
                    <td>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Agregar al Listado de Postulaciones (para tomarla y crear su cotización)"
                        disabled={agregandoCodigo === item.codigo}
                        onClick={() => agregarAPostulaciones(item)}
                        style={{ padding: 6, lineHeight: 0, color: "var(--primary-dark)" }}
                      >
                        <ClipboardList size={15} />
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
                      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {mpFicha.data && (
                <button
                  className="btn btn-primary"
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
