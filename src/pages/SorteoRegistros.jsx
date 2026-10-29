import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import * as XLSX from "xlsx";
import html2canvas from "html2canvas";
import Toast from "../components/Toast";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DateFilter from "../components/DateFilter";
import DropdownSelect from "../components/ui/DropdownSelect";
import QRCustom, { useDataUrl, LOGO_QR } from "../components/QRCustom";
import {
  construirQR,
  svgAPng,
  svgADataUrl,
  descargarArchivo,
  nombreArchivo,
  ESTILOS_QR,
} from "../lib/qrCustom";
import useAuth from "../hooks/useAuth";
import { azar } from "./SorteoRegistro";
import {
  Gift,
  Users,
  Search,
  Download,
  Shuffle,
  Crown,
  Trash2,
  RefreshCw,
  Mail,
  Send,
  Calendar,
  AlertTriangle,
  GraduationCap,
  QrCode,
  Plus,
  Pencil,
  Copy,
  ExternalLink,
  Lock,
  LockOpen,
  Trophy,
  Building2,
  Image as ImageIcon,
  FileCode2,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  UserX,
} from "lucide-react";

/* ============================================================
   Sorteos (admin + ventas_especial): /sorteo-registros.
   (2026-10-29) Sorteos múltiples: cada sorteo tiene su QR custom,
   su formulario público /sorteo/<slug>, sus participantes y su
   ganador elegido al azar. Antes era un único sorteo global.
============================================================ */

const COLORES = ["#28aeb1", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981", "#0f172a"];
const ACENTOS = ["#f59e0b", "#fb7185", "#10b981", "#0ea5e9", "#8b5cf6", "#0f172a"];
const POR_PAGINA = 12;
const CLAVE_SEL = "sorteo.seleccionado";

// Espejo de slugify del backend (solo para previsualizar el enlace).
function slugify(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Los registros del formulario antiguo (abril 2026) traen tipo_perfil en vez de es_estudiante.
const esEstudianteDe = (p) =>
  p.es_estudiante === true || (p.es_estudiante == null && p.tipo_perfil === "estudiante");
const anioDe = (p) => p.anio || (p.tipo_perfil === "egresado" ? "Egresado" : "");

// El backend manda `url` (PUBLIC_APP_URL); si faltara, se arma con el origen actual.
const urlDe = (s) => s?.url || `${window.location.origin}/sorteo/${s?.slug || ""}`;

// "29-10-26 11:22": corto y en una línea (toLocaleString agrega "a. m." y parte la celda).
const fechaCorta = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function SorteoRegistros() {
  const { rol } = useAuth();
  const esAdmin = String(rol || "").trim().toLowerCase() === "admin";

  const [sorteos, setSorteos] = useState([]);
  const [cargandoSorteos, setCargandoSorteos] = useState(true);
  const [errorSorteos, setErrorSorteos] = useState("");
  const [sorteoId, setSorteoId] = useState(null);

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [soloGanador, setSoloGanador] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [toast, setToast] = useState(null);

  // Ganador animado
  const [sorteando, setSorteando] = useState(false);
  const [ganador, setGanador] = useState(null);
  const [rolling, setRolling] = useState(null);
  const [mostrarModalGanador, setMostrarModalGanador] = useState(false);

  const [confirmar, setConfirmar] = useState(null);
  const [mostrarMailing, setMostrarMailing] = useState(false);
  const [editor, setEditor] = useState(null); // { modo: "nuevo" } | { modo: "editar", sorteo }
  const [mostrarQR, setMostrarQR] = useState(false);

  const sorteo = useMemo(() => sorteos.find((s) => s.id === sorteoId) || null, [sorteos, sorteoId]);

  useEffect(() => {
    cargarSorteos();
  }, []);

  async function cargarSorteos(preferirId) {
    setCargandoSorteos(true);
    setErrorSorteos("");
    try {
      const rows = (await api.get("/sorteo/sorteos")) || [];
      setSorteos(rows);
      setSorteoId((actual) => {
        const candidatos = [preferirId, actual, Number(sessionStorage.getItem(CLAVE_SEL))];
        for (const c of candidatos) if (c && rows.some((s) => s.id === c)) return c;
        return (rows.find((s) => s.activo) || rows[0])?.id ?? null;
      });
    } catch (e) {
      setErrorSorteos(e.message || "No se pudieron cargar los sorteos.");
    } finally {
      setCargandoSorteos(false);
    }
  }

  useEffect(() => {
    if (!sorteoId) {
      setData([]);
      return;
    }
    try {
      sessionStorage.setItem(CLAVE_SEL, String(sorteoId));
    } catch {
      /* sin sessionStorage */
    }
    setPagina(1);
    setSoloGanador(false);
    cargarParticipantes(sorteoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorteoId]);

  async function cargarParticipantes(id = sorteoId) {
    if (!id) return;
    setLoading(true);
    try {
      const rows = await api.get(`/sorteo/participantes?sorteo_id=${id}`);
      setData(rows || []);
    } catch (e) {
      setToast({ type: "error", message: e.message || "Error cargando participantes." });
    } finally {
      setLoading(false);
    }
  }

  // Actualiza los contadores del selector sin volver a pedir todo.
  function ajustarResumen(id, delta) {
    setSorteos((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              participantes: Math.max(0, (s.participantes || 0) + (delta.participantes || 0)),
              ganadores: Math.max(0, (s.ganadores || 0) + (delta.ganadores || 0)),
            }
          : s
      )
    );
  }

  const filtrada = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    const desde = fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : null;
    const hasta = fechaHasta ? new Date(`${fechaHasta}T23:59:59.999`) : null;
    return data.filter((p) => {
      if (soloGanador && !p.ganador) return false;
      if (q) {
        const hay = [p.nombre, p.email, p.anio, p.universidad_clinica].map((x) => String(x || "").toLowerCase());
        if (!hay.some((s) => s.includes(q))) return false;
      }
      if (desde || hasta) {
        const created = p.created_at ? new Date(p.created_at) : null;
        if (!created) return false;
        if (desde && created < desde) return false;
        if (hasta && created > hasta) return false;
      }
      return true;
    });
  }, [data, filtro, fechaDesde, fechaHasta, soloGanador]);

  const totalPaginas = Math.max(1, Math.ceil(filtrada.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const enPagina = filtrada.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const hoyIso = new Date().toISOString().slice(0, 10);
  const totalRegistros = data.length;
  const totalHoy = data.filter((p) => p.created_at && p.created_at.slice(0, 10) === hoyIso).length;
  const totalEstudiantes = data.filter(esEstudianteDe).length;
  const totalNoEstudiantes = totalRegistros - totalEstudiantes;
  const ganadores = useMemo(
    () =>
      data
        .filter((p) => p.ganador)
        .sort((a, b) => String(a.fecha_ganador || "").localeCompare(String(b.fecha_ganador || ""))),
    [data]
  );
  const ordenGanador = (p) => ganadores.findIndex((g) => g.id === p.id) + 1;
  const yaGanador = ganadores.length > 0;
  const totalParticipantesGlobal = sorteos.reduce((acc, s) => acc + (s.participantes || 0), 0);

  async function sortearGanador() {
    if (sorteando || !sorteo) return;
    const elegibles = data.filter((p) => p.acepta_uso_datos && !p.ganador);
    if (elegibles.length === 0) {
      setToast({ type: "error", message: "No hay participantes elegibles para sortear." });
      return;
    }

    setSorteando(true);
    setGanador(null);
    setMostrarModalGanador(true);

    // Ruleta local de ~5 s mientras el backend elige de verdad.
    let i = 0;
    const totalFrames = 50;
    const frameMs = 100;
    const interval = setInterval(() => {
      setRolling(elegibles[Math.floor(Math.random() * elegibles.length)]);
      i += 1;
      if (i >= totalFrames) clearInterval(interval);
    }, frameMs);

    try {
      const [elegido] = await Promise.all([
        api.post("/sorteo/sortear", { sorteo_id: sorteo.id }),
        new Promise((r) => setTimeout(r, totalFrames * frameMs + 200)),
      ]);
      setRolling(null);
      setGanador(elegido);
      setData((prev) =>
        prev.map((p) => (p.id === elegido.id ? { ...p, ganador: true, fecha_ganador: elegido.fecha_ganador } : p))
      );
      ajustarResumen(sorteo.id, { ganadores: 1 });
    } catch (e) {
      clearInterval(interval);
      setMostrarModalGanador(false);
      setToast({ type: "error", message: e.message || "No se pudo sortear." });
    } finally {
      setSorteando(false);
    }
  }

  function pedirResetGanadores() {
    if (!sorteo) return;
    setConfirmar({
      title: "Reiniciar ganadores",
      message: `Los ganadores de «${sorteo.titulo}» volverán a quedar elegibles para un nuevo sorteo. ¿Continuar?`,
      confirmText: "Reiniciar",
      tone: "warning",
      onConfirm: async () => {
        try {
          await api.post("/sorteo/reset-ganadores", { sorteo_id: sorteo.id });
          setData((prev) => prev.map((p) => ({ ...p, ganador: false, fecha_ganador: null })));
          ajustarResumen(sorteo.id, { ganadores: -ganadores.length });
          setToast({ type: "success", message: "Ganadores reiniciados." });
        } catch (e) {
          setToast({ type: "error", message: e.message || "Error al reiniciar." });
        }
      },
    });
  }

  function pedirEliminar(p) {
    setConfirmar({
      title: "Eliminar participante",
      message: `Se eliminará a ${p.nombre} del sorteo. Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      tone: "danger",
      onConfirm: async () => {
        try {
          await api.delete(`/sorteo/participantes/${p.id}`);
          setData((prev) => prev.filter((x) => x.id !== p.id));
          ajustarResumen(p.sorteo_id, { participantes: -1, ganadores: p.ganador ? -1 : 0 });
          setToast({ type: "success", message: "Participante eliminado." });
        } catch (e) {
          setToast({ type: "error", message: e.message || "Error al eliminar." });
        }
      },
    });
  }

  function pedirEliminarSorteo() {
    if (!sorteo) return;
    setConfirmar({
      title: "Eliminar sorteo",
      message: `Se eliminará «${sorteo.titulo}» con sus ${sorteo.participantes || 0} participantes. El QR impreso dejará de funcionar. Esta acción no se puede deshacer.`,
      confirmText: "Eliminar sorteo",
      tone: "danger",
      onConfirm: async () => {
        try {
          await api.delete(`/sorteo/sorteos/${sorteo.id}`);
          setToast({ type: "success", message: "Sorteo eliminado." });
          setSorteoId(null);
          await cargarSorteos();
        } catch (e) {
          setToast({ type: "error", message: e.message || "Error al eliminar el sorteo." });
        }
      },
    });
  }

  async function alternarInscripciones() {
    if (!sorteo) return;
    try {
      const actualizado = await api.put(`/sorteo/sorteos/${sorteo.id}`, { ...sorteo, activo: !sorteo.activo });
      setSorteos((prev) => prev.map((s) => (s.id === sorteo.id ? { ...s, ...actualizado } : s)));
      setToast({
        type: "success",
        message: actualizado.activo ? "Inscripciones abiertas." : "Inscripciones cerradas: el formulario ya no acepta registros.",
      });
    } catch (e) {
      setToast({ type: "error", message: e.message || "No se pudo cambiar el estado." });
    }
  }

  async function guardarSorteo(valores) {
    if (editor?.modo === "editar") {
      const actualizado = await api.put(`/sorteo/sorteos/${editor.sorteo.id}`, valores);
      setSorteos((prev) => prev.map((s) => (s.id === actualizado.id ? { ...s, ...actualizado } : s)));
      setToast({ type: "success", message: "Sorteo actualizado." });
    } else {
      const creado = await api.post("/sorteo/sorteos", valores);
      setSorteos((prev) => [creado, ...prev]);
      setSorteoId(creado.id);
      setToast({ type: "success", message: "Sorteo creado. Ya puedes descargar su QR." });
      setMostrarQR(true);
    }
    setEditor(null);
  }

  function copiarLink() {
    if (!sorteo) return;
    navigator.clipboard?.writeText(urlDe(sorteo)).then(
      () => setToast({ type: "success", message: "Enlace copiado al portapapeles." }),
      () => setToast({ type: "error", message: "No se pudo copiar el enlace." })
    );
  }

  function exportarXLSX() {
    const rows = filtrada.map((p) => ({
      ID: p.id,
      Sorteo: sorteo?.titulo || "",
      Nombre: p.nombre,
      Email: p.email,
      Estudiante: esEstudianteDe(p) ? "Sí" : "No",
      Año: anioDe(p) || "",
      "Acepta uso datos": p.acepta_uso_datos ? "Sí" : "No",
      "Acepta comunicaciones": p.acepta_comunicaciones ? "Sí" : "No",
      Ganador: p.ganador ? `Sí (${ordenGanador(p)}°)` : "No",
      "Fecha registro": p.created_at ? new Date(p.created_at).toLocaleString("es-CL") : "",
      "IP origen": p.ip_origen || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Participantes");
    XLSX.writeFile(wb, `sorteo-${nombreArchivo(sorteo?.slug, "participantes")}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const hayFiltros = filtro !== "" || fechaDesde !== "" || fechaHasta !== "" || soloGanador;
  function limpiarFiltros() {
    setFiltro("");
    setFechaDesde("");
    setFechaHasta("");
    setSoloGanador(false);
    setPagina(1);
  }

  const opcionesSorteo = sorteos.map((s) => ({
    value: s.id,
    label: s.titulo,
    color: s.activo ? "#10b981" : "#94a3b8",
    detalle: `${s.participantes || 0} participante${s.participantes === 1 ? "" : "s"} · ${s.activo ? "abierto" : "cerrado"}`,
  }));

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Gift size={22} style={{ color: "var(--primary)" }} />
            Sorteos
          </h1>
          <p className="page-subtitle">
            {sorteos.length} sorteo{sorteos.length !== 1 ? "s" : ""} · {totalParticipantesGlobal} participante
            {totalParticipantesGlobal !== 1 ? "s" : ""} en total
          </p>
        </div>
        <div className="page-actions sorteo-header-actions">
          {sorteos.length > 0 && (
            <DropdownSelect
              value={sorteoId ?? ""}
              onChange={(v) => setSorteoId(Number(v))}
              options={opcionesSorteo}
              placeholder="Elige un sorteo…"
              minWidth={240}
              title="Sorteo que se muestra"
            />
          )}
          <button className="btn btn-primary" onClick={() => setEditor({ modo: "nuevo" })}>
            <Plus size={15} />
            Nuevo sorteo
          </button>
        </div>
      </div>

      {errorSorteos && (
        <div className="sorteo-aviso-error">
          <AlertTriangle size={16} />
          <span>{errorSorteos}</span>
          <button className="btn btn-sm btn-secondary" onClick={() => cargarSorteos()}>
            Reintentar
          </button>
        </div>
      )}

      {!cargandoSorteos && !errorSorteos && sorteos.length === 0 && (
        <div className="surface sorteo-vacio">
          <div className="sorteo-vacio-icon">
            <QrCode size={34} />
          </div>
          <h2>Crea tu primer sorteo</h2>
          <p>
            Cada sorteo tiene su propio QR y formulario: la gente lo escanea, deja su nombre, correo, si es
            estudiante y en qué año va, y desde aquí eliges al ganador al azar.
          </p>
          <button className="btn btn-primary" onClick={() => setEditor({ modo: "nuevo" })}>
            <Plus size={15} />
            Nuevo sorteo
          </button>
        </div>
      )}

      {sorteo && (
        <>
          {/* Ficha del sorteo seleccionado */}
          <div className="surface sorteo-ficha" style={{ "--sorteo-color": sorteo.color || "#28aeb1" }}>
            <div className="sorteo-ficha-color" />
            <div className="sorteo-ficha-info">
              <div className="sorteo-ficha-titulo">
                <h2>{sorteo.titulo}</h2>
                <span className={`sorteo-estado-chip ${sorteo.activo ? "is-abierto" : "is-cerrado"}`}>
                  {sorteo.activo ? <LockOpen size={11} /> : <Lock size={11} />}
                  {sorteo.activo ? "Inscripciones abiertas" : "Inscripciones cerradas"}
                </span>
              </div>
              {sorteo.subtitulo && <p className="sorteo-ficha-sub">{sorteo.subtitulo}</p>}
              <div className="sorteo-ficha-meta">
                {sorteo.universidad && (
                  <span>
                    <Building2 size={13} /> {sorteo.universidad}
                  </span>
                )}
                {sorteo.premio && (
                  <span>
                    <Trophy size={13} /> {sorteo.premio}
                  </span>
                )}
                <a href={urlDe(sorteo)} target="_blank" rel="noreferrer" className="sorteo-ficha-link" title="Abrir el formulario público">
                  <ExternalLink size={13} /> {urlDe(sorteo).replace(/^https?:\/\//, "")}
                </a>
                <button type="button" className="sorteo-ficha-copiar" onClick={copiarLink} title="Copiar enlace">
                  <Copy size={13} /> Copiar
                </button>
              </div>
            </div>
            <div className="sorteo-ficha-acciones">
              <button className="btn btn-primary" onClick={() => setMostrarQR(true)}>
                <QrCode size={15} />
                QR del sorteo
              </button>
              <button className="btn btn-secondary" onClick={() => setEditor({ modo: "editar", sorteo })}>
                <Pencil size={14} />
                Editar
              </button>
              <button
                className="btn btn-secondary"
                onClick={alternarInscripciones}
                title={sorteo.activo ? "El formulario dejará de aceptar registros" : "El formulario volverá a aceptar registros"}
              >
                {sorteo.activo ? <Lock size={14} /> : <LockOpen size={14} />}
                {sorteo.activo ? "Cerrar inscripciones" : "Abrir inscripciones"}
              </button>
              <button className="btn btn-ghost sorteo-btn-peligro" onClick={pedirEliminarSorteo} title="Eliminar el sorteo y sus participantes">
                <Trash2 size={14} />
                Eliminar
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="sorteo-stats">
            <StatCard icon={<Users size={18} />} label="Inscritos" value={totalRegistros} tone="blue" />
            <StatCard icon={<Calendar size={18} />} label="Inscritos hoy" value={totalHoy} tone="violet" />
            <StatCard icon={<GraduationCap size={18} />} label="Estudiantes" value={totalEstudiantes} tone="green" />
            <StatCard icon={<UserX size={18} />} label="No estudiantes" value={totalNoEstudiantes} tone="gold" />
          </div>

          {/* Filtros y acciones sobre los participantes */}
          <div className="sorteo-admin-toolbar">
            <div className="sorteo-filters-left">
              <div className="sorteo-search">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Buscar por nombre, correo o año…"
                  value={filtro}
                  onChange={(e) => {
                    setFiltro(e.target.value);
                    setPagina(1);
                  }}
                />
              </div>

              <div className="sorteo-date-range">
                <span className="sorteo-date-label">Desde</span>
                <DateFilter
                  value={fechaDesde}
                  onChange={(v) => {
                    setFechaDesde(v);
                    setPagina(1);
                  }}
                  maxDate={fechaHasta ? new Date(`${fechaHasta}T00:00:00`) : undefined}
                />
                <span className="sorteo-date-label">Hasta</span>
                <DateFilter
                  value={fechaHasta}
                  onChange={(v) => {
                    setFechaHasta(v);
                    setPagina(1);
                  }}
                  minDate={fechaDesde ? new Date(`${fechaDesde}T00:00:00`) : undefined}
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  setSoloGanador((v) => !v);
                  setPagina(1);
                }}
                disabled={!yaGanador}
                className={soloGanador ? "btn btn-primary" : "btn btn-secondary"}
                title={yaGanador ? "Ver solo a los ganadores" : "Aún no hay ganador"}
              >
                <Crown size={14} />
                {soloGanador ? "Mostrando ganadores" : "Solo ganadores"}
              </button>
              <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
            </div>

            <div className="sorteo-filters-right">
              <button className="btn btn-secondary" onClick={() => cargarParticipantes()} disabled={loading} title="Actualizar">
                <RefreshCw size={14} />
                Actualizar
              </button>
              <button className="btn btn-secondary" onClick={exportarXLSX} disabled={filtrada.length === 0}>
                <Download size={14} />
                Exportar
              </button>
              {esAdmin && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setMostrarMailing(true)}
                  disabled={totalRegistros === 0}
                  title="Enviar correo a los participantes de este sorteo"
                >
                  <Send size={14} />
                  Enviar correo
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={pedirResetGanadores}
                disabled={!yaGanador || sorteando}
                title={yaGanador ? "Limpiar ganadores y volver a sortear" : "No hay ganador para limpiar"}
              >
                <RefreshCw size={14} />
                Limpiar ganador
              </button>
              <button className="sorteo-admin-btn-win" onClick={sortearGanador} disabled={sorteando || totalRegistros === 0}>
                <Shuffle size={16} />
                {sorteando ? "Sorteando…" : "Elegir ganador"}
              </button>
            </div>
          </div>

          {/* Tabla */}
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="data-table tabla-compacta tabla-texto">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th style={{ width: 118 }}>Estudiante</th>
                    <th style={{ width: 96 }}>Año</th>
                    <th style={{ width: 138 }}>Registro</th>
                    <th style={{ width: 70 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 30, opacity: 0.6 }}>
                        Cargando participantes…
                      </td>
                    </tr>
                  ) : enPagina.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 40, opacity: 0.6 }}>
                        {hayFiltros
                          ? "Sin resultados para el filtro."
                          : "Aún no hay participantes. Comparte el QR del sorteo para que la gente se inscriba."}
                      </td>
                    </tr>
                  ) : (
                    enPagina.map((p) => (
                      <tr key={p.id} className={p.ganador ? "sorteo-row-winner" : ""}>
                        <td style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>{p.id}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                          {p.ganador && (
                            <span className="sorteo-winner-chip">
                              <Crown size={11} /> GANADOR{ganadores.length > 1 ? ` ${ordenGanador(p)}°` : ""}
                            </span>
                          )}
                        </td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
                            <Mail size={12} style={{ color: "var(--primary)", flex: "0 0 auto" }} />
                            {p.email}
                          </span>
                        </td>
                        <td>
                          {esEstudianteDe(p) ? (
                            <span className="badge badge-primary">
                              <GraduationCap size={11} style={{ marginRight: 3 }} />
                              Sí
                            </span>
                          ) : (
                            <span className="badge badge-neutral">No</span>
                          )}
                        </td>
                        <td style={{ fontSize: 13 }}>{anioDe(p) || <span style={{ color: "var(--text-soft)" }}>—</span>}</td>
                        <td style={{ fontSize: 12.5, color: "var(--text-soft)" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <Calendar size={12} style={{ flex: "0 0 auto" }} />
                            {fechaCorta(p.created_at)}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => pedirEliminar(p)} title="Eliminar">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filtrada.length > POR_PAGINA && (
              <div className="sorteo-pagin">
                <span>
                  {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtrada.length)} de {filtrada.length}
                </span>
                <div>
                  <button className="btn btn-sm btn-secondary" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>
                    <ChevronLeft size={14} />
                  </button>
                  <span className="sorteo-pagin-num">
                    {paginaActual} / {totalPaginas}
                  </span>
                  <button className="btn btn-sm btn-secondary" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(paginaActual + 1)}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {mostrarModalGanador && (
        <GanadorModal
          rolling={rolling}
          ganador={ganador}
          sorteo={sorteo}
          onClose={() => {
            setMostrarModalGanador(false);
            setGanador(null);
            setRolling(null);
          }}
        />
      )}

      {confirmar && <ConfirmarModal {...confirmar} onCancel={() => setConfirmar(null)} onDone={() => setConfirmar(null)} />}

      {mostrarMailing && sorteo && (
        <MailingModal
          sorteo={sorteo}
          onClose={() => setMostrarMailing(false)}
          onSent={(resumen) => {
            setMostrarMailing(false);
            setToast({
              type: resumen.fallidos > 0 ? "warning" : "success",
              message: `Enviados ${resumen.enviados} de ${resumen.totalDestinatarios}${
                resumen.fallidos > 0 ? ` (${resumen.fallidos} fallidos)` : ""
              }.`,
            });
          }}
        />
      )}

      {editor && (
        <SorteoEditorModal
          modo={editor.modo}
          sorteo={editor.sorteo}
          baseUrl={urlDe(sorteos[0]).replace(/\/sorteo\/.*$/, "")}
          onClose={() => setEditor(null)}
          onSave={guardarSorteo}
        />
      )}

      {mostrarQR && sorteo && <QRModal sorteo={sorteo} onClose={() => setMostrarQR(false)} onCopiar={copiarLink} setToast={setToast} />}

      <style>{ADMIN_STYLES}</style>
    </div>
  );
}

/* ──────────────────────────────── Sub-componentes ──────────────────────────────── */

function StatCard({ icon, label, value, tone = "blue" }) {
  const tones = {
    blue: { bg: "var(--primary-light)", fg: "var(--primary-dark)" },
    green: { bg: "linear-gradient(135deg,#ecfdf5,#d1fae5)", fg: "#047857" },
    violet: { bg: "linear-gradient(135deg,#e8f7f7,#b2e4e5)", fg: "#1e9295" },
    gold: { bg: "linear-gradient(135deg,#fefce8,#fef3c7)", fg: "#b45309" },
  };
  const t = tones[tone] || tones.blue;
  return (
    <div className="sorteo-stat">
      <div className="sorteo-stat-icon" style={{ background: t.bg, color: t.fg }}>
        {icon}
      </div>
      <div>
        <div className="sorteo-stat-value">{value}</div>
        <div className="sorteo-stat-label">{label}</div>
      </div>
    </div>
  );
}

function ConfirmarModal({ title, message, confirmText, tone = "danger", onConfirm, onCancel, onDone }) {
  const [trabajando, setTrabajando] = useState(false);
  const tones = {
    danger: { iconBg: "#fee2e2", iconFg: "#dc2626", btnClass: "sorteo-confirm-btn-danger" },
    warning: { iconBg: "#fef3c7", iconFg: "#d97706", btnClass: "sorteo-confirm-btn-warning" },
  };
  const t = tones[tone] || tones.danger;

  async function ejecutar() {
    if (trabajando) return;
    setTrabajando(true);
    try {
      await onConfirm?.();
      onDone?.();
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="sorteo-modal-back" onClick={trabajando ? undefined : onCancel}>
      <div className="sorteo-confirm-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-labelledby="sorteo-confirm-title">
        <div className="sorteo-confirm-icon" style={{ background: t.iconBg, color: t.iconFg }}>
          <AlertTriangle size={26} />
        </div>
        <h3 id="sorteo-confirm-title" className="sorteo-confirm-title">
          {title}
        </h3>
        <p className="sorteo-confirm-message">{message}</p>
        <div className="sorteo-confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={trabajando}>
            Cancelar
          </button>
          <button className={t.btnClass} onClick={ejecutar} disabled={trabajando}>
            {trabajando ? "Procesando…" : confirmText || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GanadorModal({ rolling, ganador, sorteo, onClose }) {
  const confettiPieces = useMemo(() => {
    const colors = [sorteo?.color || "#28aeb1", "#1e9295", "#b2e4e5", sorteo?.color_acento || "#f59e0b", "#fde68a", "#fb7185"];
    const semilla = Number(ganador?.id) || 1;
    return Array.from({ length: 90 }).map((_, i) => ({
      left: `${azar(i + semilla, 1) * 100}%`,
      delay: `${azar(i + semilla, 2) * 0.8}s`,
      duration: `${1.8 + azar(i + semilla, 3) * 2.2}s`,
      color: colors[i % colors.length],
      rotate: `${azar(i + semilla, 4) * 360}deg`,
    }));
  }, [ganador?.id, sorteo?.color, sorteo?.color_acento]);

  return (
    <div className="sorteo-modal-back" onClick={ganador ? onClose : undefined}>
      <div className="sorteo-modal-card" onClick={(e) => e.stopPropagation()}>
        {ganador && (
          <div className="sorteo-modal-confetti" aria-hidden>
            {confettiPieces.map((p, i) => (
              <span
                key={i}
                style={{
                  left: p.left,
                  background: p.color,
                  animationDelay: p.delay,
                  animationDuration: p.duration,
                  transform: `rotate(${p.rotate})`,
                }}
              />
            ))}
          </div>
        )}

        <div className={`sorteo-modal-crown ${ganador ? "is-revealed" : ""}`}>
          <Crown size={42} />
        </div>

        <h2 className="sorteo-modal-title">{ganador ? "¡Tenemos ganador!" : "Sorteando…"}</h2>
        {sorteo && <div className="sorteo-modal-sorteo">{sorteo.titulo}</div>}

        <div className={`sorteo-reel ${ganador ? "is-revealed" : ""}`}>
          <div className="sorteo-reel-name">{ganador ? ganador.nombre : rolling?.nombre || "—"}</div>
          <div className="sorteo-reel-email">{ganador ? ganador.email : rolling?.email || ""}</div>
        </div>

        {ganador && (
          <>
            <div className="sorteo-modal-details">
              <div>
                <GraduationCap size={12} />{" "}
                {esEstudianteDe(ganador) ? `Estudiante${anioDe(ganador) ? ` · ${anioDe(ganador)}` : ""}` : "No estudiante"}
              </div>
              {sorteo?.premio && (
                <div>
                  <Trophy size={12} /> {sorteo.premio}
                </div>
              )}
              <div>
                <Calendar size={12} /> {fechaCorta(ganador.fecha_ganador || new Date().toISOString())}
              </div>
            </div>
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 18 }}>
              Cerrar
            </button>
          </>
        )}

        {!ganador && <div className="sorteo-modal-hint">Eligiendo al azar entre los participantes elegibles…</div>}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Editor de sorteo ──────────────────────────────── */

function SorteoEditorModal({ modo, sorteo, baseUrl, onClose, onSave }) {
  const editar = modo === "editar";
  const [form, setForm] = useState({
    titulo: sorteo?.titulo || "",
    subtitulo: sorteo?.subtitulo || "",
    universidad: sorteo?.universidad || "",
    premio: sorteo?.premio || "",
    color: sorteo?.color || "#28aeb1",
    color_acento: sorteo?.color_acento || "#f59e0b",
    slug: sorteo?.slug || "",
    activo: sorteo ? !!sorteo.activo : true,
  });
  const [slugTocado, setSlugTocado] = useState(editar);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => {
    const v = e?.target ? e.target.value : e;
    setForm((p) => ({ ...p, [k]: v }));
    if (error) setError("");
  };

  const slugPreview = editar ? form.slug : slugTocado ? slugify(form.slug) : slugify(form.titulo);
  const urlPreview = `${baseUrl}/sorteo/${slugPreview || "…"}`;

  async function guardar(e) {
    e.preventDefault();
    if (!form.titulo.trim()) return setError("El sorteo necesita un título.");
    setGuardando(true);
    setError("");
    try {
      await onSave({
        titulo: form.titulo.trim(),
        subtitulo: form.subtitulo.trim(),
        universidad: form.universidad.trim(),
        premio: form.premio.trim(),
        color: form.color,
        color_acento: form.color_acento,
        activo: form.activo,
        ...(editar ? {} : { slug: slugPreview }),
      });
    } catch (err) {
      setError(err?.message || "No se pudo guardar el sorteo.");
      setGuardando(false);
    }
  }

  return (
    <div className="sorteo-modal-back" onClick={guardando ? undefined : onClose}>
      <form className="sorteo-editor" onClick={(e) => e.stopPropagation()} onSubmit={guardar} noValidate>
        <div className="sorteo-editor-head">
          <h3>
            {editar ? <Pencil size={17} /> : <Plus size={17} />}
            {editar ? "Editar sorteo" : "Nuevo sorteo"}
          </h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={guardando} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="sorteo-editor-grid">
          <div className="sorteo-editor-campos">
            <label className="sorteo-editor-campo">
              <span>Título *</span>
              <input className="input" value={form.titulo} onChange={set("titulo")} placeholder="Ej: Sorteo Semana Odontológica 2026" autoFocus maxLength={120} />
            </label>
            <label className="sorteo-editor-campo">
              <span>Subtítulo</span>
              <input className="input" value={form.subtitulo} onChange={set("subtitulo")} placeholder="Texto bajo el título del formulario" maxLength={240} />
            </label>
            <div className="sorteo-editor-dos">
              <label className="sorteo-editor-campo">
                <span>Universidad</span>
                <input className="input" value={form.universidad} onChange={set("universidad")} placeholder="Ej: Universidad de Valparaíso" maxLength={160} />
                <small>Aparece en la pregunta «¿Eres estudiante de …?»</small>
              </label>
              <label className="sorteo-editor-campo">
                <span>Premio</span>
                <input className="input" value={form.premio} onChange={set("premio")} placeholder="Ej: Kit de instrumental" maxLength={200} />
              </label>
            </div>

            <div className="sorteo-editor-campo">
              <span>Color principal</span>
              <Swatches valor={form.color} opciones={COLORES} onChange={set("color")} />
            </div>
            <div className="sorteo-editor-campo">
              <span>Color de acento</span>
              <Swatches valor={form.color_acento} opciones={ACENTOS} onChange={set("color_acento")} />
            </div>

            {!editar ? (
              <label className="sorteo-editor-campo">
                <span>Enlace del QR</span>
                <div className="sorteo-editor-slug">
                  <span>{baseUrl.replace(/^https?:\/\//, "")}/sorteo/</span>
                  <input
                    className="input"
                    value={slugTocado ? form.slug : slugPreview}
                    onChange={(e) => {
                      setSlugTocado(true);
                      set("slug")(e);
                    }}
                    placeholder="nombre-del-sorteo"
                    maxLength={60}
                  />
                </div>
                <small>Después de crearlo no se puede cambiar: los QR impresos apuntan a él.</small>
              </label>
            ) : (
              <div className="sorteo-editor-campo">
                <span>Inscripciones</span>
                <div className="sorteo-editor-toggle">
                  <button type="button" className={form.activo ? "is-on" : ""} onClick={() => set("activo")(true)}>
                    <LockOpen size={13} /> Abiertas
                  </button>
                  <button type="button" className={!form.activo ? "is-on" : ""} onClick={() => set("activo")(false)}>
                    <Lock size={13} /> Cerradas
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="sorteo-editor-preview">
            <div className="sorteo-editor-preview-titulo">Así se verá el QR</div>
            <QRCustom texto={urlPreview} color={form.color} acento={form.color_acento} tamano={170} />
            <div className="sorteo-editor-preview-url">{urlPreview.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>

        {error && <div className="sorteo-editor-error">{error}</div>}

        <div className="sorteo-editor-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            <Check size={15} />
            {guardando ? "Guardando…" : editar ? "Guardar cambios" : "Crear sorteo"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Swatches({ valor, opciones, onChange }) {
  // Mientras el hex escrito no es válido se muestra el borrador; al serlo se
  // aplica y vuelve a mostrarse el valor real.
  const [borrador, setBorrador] = useState(null);
  const hex = borrador ?? valor;
  return (
    <div className="sorteo-swatches">
      {opciones.map((c) => (
        <button
          key={c}
          type="button"
          className={`sorteo-swatch ${valor === c ? "is-on" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          title={c}
          aria-label={`Color ${c}`}
        >
          {valor === c && <Check size={13} />}
        </button>
      ))}
      <input
        className="input sorteo-swatch-hex"
        value={hex}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#[0-9a-f]{6}$/i.test(v)) {
            setBorrador(null);
            onChange(v.toLowerCase());
          } else {
            setBorrador(v);
          }
        }}
        onBlur={() => setBorrador(null)}
        placeholder="#28aeb1"
        maxLength={7}
        spellCheck={false}
      />
    </div>
  );
}

/* ──────────────────────────────── Modal QR ──────────────────────────────── */

function QRModal({ sorteo, onClose, onCopiar, setToast }) {
  const [estilo, setEstilo] = useState("fluido");
  const [conLogo, setConLogo] = useState(true);
  const [trabajando, setTrabajando] = useState("");
  const aficheRef = useRef(null);
  const logoData = useDataUrl(conLogo ? LOGO_QR : null);
  const base = nombreArchivo(`qr-${sorteo.slug}`);
  const url = urlDe(sorteo);

  const opciones = () => ({
    texto: url,
    estilo,
    color: sorteo.color || "#28aeb1",
    acento: sorteo.color_acento || "#f59e0b",
    logo: logoData,
    id: "qrexp",
  });

  async function descargarPNG() {
    setTrabajando("png");
    try {
      const png = await svgAPng(construirQR({ ...opciones(), tamano: 1600 }), 1600);
      descargarArchivo(`${base}.png`, png);
    } catch (e) {
      setToast({ type: "error", message: e.message || "No se pudo generar el PNG." });
    } finally {
      setTrabajando("");
    }
  }

  function descargarSVG() {
    descargarArchivo(`${base}.svg`, svgADataUrl(construirQR({ ...opciones(), tamano: 1000 })));
  }

  async function descargarAfiche() {
    if (!aficheRef.current) return;
    setTrabajando("afiche");
    try {
      const canvas = await html2canvas(aficheRef.current, { scale: 3, backgroundColor: null, useCORS: true, logging: false });
      descargarArchivo(`${base}-afiche.png`, canvas.toDataURL("image/png"));
    } catch (e) {
      setToast({ type: "error", message: e.message || "No se pudo generar el afiche." });
    } finally {
      setTrabajando("");
    }
  }

  const color = sorteo.color || "#28aeb1";
  const acento = sorteo.color_acento || "#f59e0b";

  return (
    <div className="sorteo-modal-back" onClick={onClose}>
      <div className="sorteo-qr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sorteo-editor-head">
          <h3>
            <QrCode size={17} /> QR del sorteo
          </h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div className="sorteo-qr-grid">
          {/* Afiche imprimible (lo que se descarga como imagen) */}
          <div className="sorteo-qr-afiche-wrap">
            <div className="qr-afiche" ref={aficheRef} style={{ "--qr-color": color, "--qr-acento": acento }}>
              <img src="/logo_superior_ficha.png" alt="AMSODENT" className="qr-afiche-logo" />
              <div className="qr-afiche-badge">
                <Gift size={12} /> SORTEO{sorteo.universidad ? ` · ${sorteo.universidad.toUpperCase()}` : ""}
              </div>
              <h2 className="qr-afiche-titulo">{sorteo.titulo}</h2>
              <p className="qr-afiche-sub">{sorteo.premio ? `Participa por ${sorteo.premio}` : "Escanea el código y déjanos tus datos"}</p>
              <div className="qr-afiche-qr">
                <QRCustom texto={url} estilo={estilo} color={color} acento={acento} conLogo={conLogo} tamano={236} />
              </div>
              <div className="qr-afiche-hint">
                <QrCode size={14} /> Apunta tu cámara aquí
              </div>
              <div className="qr-afiche-url">{url.replace(/^https?:\/\//, "")}</div>
            </div>
          </div>

          <div className="sorteo-qr-controles">
            <div className="sorteo-qr-seccion">
              <span className="filter-label">Estilo de los módulos</span>
              <div className="sorteo-editor-toggle">
                {ESTILOS_QR.map((e) => (
                  <button key={e.value} type="button" className={estilo === e.value ? "is-on" : ""} onClick={() => setEstilo(e.value)} title={e.detalle}>
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sorteo-qr-seccion">
              <span className="filter-label">Logo al centro</span>
              <div className="sorteo-editor-toggle">
                <button type="button" className={conLogo ? "is-on" : ""} onClick={() => setConLogo(true)}>
                  Con logo
                </button>
                <button type="button" className={!conLogo ? "is-on" : ""} onClick={() => setConLogo(false)}>
                  Sin logo
                </button>
              </div>
            </div>

            <div className="sorteo-qr-seccion">
              <span className="filter-label">Descargar</span>
              <div className="sorteo-qr-botones">
                <button className="btn btn-primary" onClick={descargarPNG} disabled={!!trabajando}>
                  <ImageIcon size={14} /> {trabajando === "png" ? "Generando…" : "QR en PNG (1600 px)"}
                </button>
                <button className="btn btn-secondary" onClick={descargarSVG} disabled={!!trabajando}>
                  <FileCode2 size={14} /> QR en SVG (vectorial)
                </button>
                <button className="btn btn-secondary" onClick={descargarAfiche} disabled={!!trabajando}>
                  <Download size={14} /> {trabajando === "afiche" ? "Generando…" : "Afiche completo (PNG)"}
                </button>
              </div>
            </div>

            <div className="sorteo-qr-seccion">
              <span className="filter-label">Enlace del formulario</span>
              <div className="sorteo-qr-link">{url}</div>
              <div className="sorteo-qr-botones">
                <button className="btn btn-secondary" onClick={onCopiar}>
                  <Copy size={14} /> Copiar enlace
                </button>
                <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Abrir formulario
                </a>
              </div>
            </div>
            <p className="sorteo-qr-nota">
              Imprímelo de al menos 5 × 5 cm. El código usa corrección de errores alta: se lee aunque el logo tape
              el centro o la impresión no sea perfecta.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────── Mailing Modal ──────────────────────────────── */

function MailingModal({ sorteo, onClose, onSent }) {
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [soloAceptaron, setSoloAceptaron] = useState(true);
  const [esEstudiante, setEsEstudiante] = useState(""); // "" | "si" | "no"
  const [emailsExtraStr, setEmailsExtraStr] = useState("");
  const [previewCount, setPreviewCount] = useState(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const emailsExtra = useMemo(
    () =>
      emailsExtraStr
        .split(/[\s,;\n]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes("@")),
    [emailsExtraStr]
  );

  const filtros = () => ({
    soloAceptaron,
    sorteoId: sorteo.id,
    esEstudiante: esEstudiante === "si" ? true : esEstudiante === "no" ? false : null,
    emailsExtra,
  });
  const filtrosKey = `${soloAceptaron ? "1" : "0"}|${esEstudiante}|${emailsExtra.join(",")}`;

  useEffect(() => {
    let cancelado = false;
    setCargandoPreview(true);
    setError("");
    api
      .post("/mailings/sorteo/preview", filtros())
      .then((r) => {
        if (!cancelado) setPreviewCount(Number(r?.total ?? 0));
      })
      .catch((e) => {
        if (!cancelado) {
          setPreviewCount(null);
          setError(e?.message || "No se pudo calcular destinatarios.");
        }
      })
      .finally(() => {
        if (!cancelado) setCargandoPreview(false);
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosKey]);

  async function enviar() {
    setError("");
    if (!asunto.trim()) return setError("Falta el asunto.");
    if (!cuerpo.trim()) return setError("Falta el cuerpo del correo.");
    if (!previewCount) return setError("No hay destinatarios.");

    setEnviando(true);
    try {
      const cuerpoHtml = cuerpo.includes("<")
        ? cuerpo
        : cuerpo
            .split(/\n\n+/)
            .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
            .join("");
      const resumen = await api.post("/mailings/sorteo", { asunto, cuerpoHtml, ...filtros() });
      onSent?.(resumen);
    } catch (e) {
      setError(e?.message || "No se pudo enviar el correo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="sorteo-modal-back"
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onClose?.();
      }}
    >
      <div className="sorteo-mailing">
        <div className="sorteo-editor-head">
          <h3>
            <Send size={17} /> Correo a participantes
          </h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={enviando} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <div className="sorteo-mailing-alcance">
          <Gift size={13} /> Solo a los inscritos en <strong>{sorteo.titulo}</strong>
        </div>
        <div className="sorteo-editor-dos" style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, paddingTop: 22 }}>
            <input type="checkbox" checked={soloAceptaron} onChange={(e) => setSoloAceptaron(e.target.checked)} />
            Sólo los que aceptaron comunicaciones
          </label>
          <div>
            <label className="filter-label">Perfil</label>
            <DropdownSelect
              value={esEstudiante}
              onChange={setEsEstudiante}
              options={[
                { value: "", label: "Todos" },
                { value: "si", label: "Estudiantes" },
                { value: "no", label: "No estudiantes" },
              ]}
              minWidth={160}
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label className="filter-label">Correos adicionales (opcional)</label>
          <textarea
            className="input"
            placeholder="Pega correos separados por coma, espacio o salto de línea"
            value={emailsExtraStr}
            onChange={(e) => setEmailsExtraStr(e.target.value)}
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
        </div>
        <div className="sorteo-mailing-conteo">
          {cargandoPreview
            ? "Calculando destinatarios…"
            : previewCount != null
            ? `${previewCount} destinatario${previewCount === 1 ? "" : "s"} recibirá${previewCount === 1 ? "" : "n"} este correo`
            : "—"}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label className="filter-label">Asunto</label>
          <input type="text" className="input" value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder="Asunto del correo" style={{ width: "100%" }} disabled={enviando} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label className="filter-label">Cuerpo (texto plano o HTML)</label>
          <textarea
            className="input"
            value={cuerpo}
            onChange={(e) => setCuerpo(e.target.value)}
            placeholder={"Hola,\n\nGracias por participar en el sorteo de AMSODENT…\n\nPuedes usar HTML si lo deseas (<b>, <a>, <p>, <img>)."}
            rows={9}
            style={{ width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            disabled={enviando}
          />
          <div style={{ fontSize: 11, color: "var(--text-soft)", marginTop: 4 }}>
            Si pegas HTML se respeta. Si es texto plano, los saltos de línea se convierten en párrafos.
          </div>
        </div>
        {error && <div className="sorteo-editor-error">{error}</div>}
        <div className="sorteo-editor-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={enviar} disabled={enviando || cargandoPreview || !previewCount}>
            <Send size={14} />
            {enviando ? "Enviando…" : `Enviar a ${previewCount ?? "—"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────── Estilos ──────────────────────────────── */

const ADMIN_STYLES = `
.sorteo-header-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

.sorteo-aviso-error {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; margin-bottom: 14px;
  border-radius: 10px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 13px;
}
.sorteo-aviso-error span { flex: 1; min-width: 200px; }

.sorteo-vacio { text-align: center; padding: 40px 24px; }
.sorteo-vacio-icon {
  display: inline-flex; padding: 16px; border-radius: 50%;
  background: var(--primary-light); color: var(--primary-dark); margin-bottom: 12px;
}
.sorteo-vacio h2 { margin: 0 0 6px; font-size: 18px; }
.sorteo-vacio p { margin: 0 auto 16px; max-width: 520px; color: var(--text-soft); font-size: 13.5px; line-height: 1.5; }

/* Ficha del sorteo */
.sorteo-ficha {
  position: relative; overflow: hidden;
  display: flex; flex-wrap: wrap; gap: 14px 20px; align-items: flex-start; justify-content: space-between;
  padding: 18px 20px 18px 24px; margin-bottom: 16px;
}
.sorteo-ficha-color { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: linear-gradient(180deg, var(--sorteo-color), color-mix(in srgb, var(--sorteo-color) 60%, #000)); }
.sorteo-ficha-info { flex: 1 1 320px; min-width: 0; }
.sorteo-ficha-titulo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sorteo-ficha-titulo h2 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.01em; overflow-wrap: anywhere; }
.sorteo-ficha-sub { margin: 4px 0 0; color: var(--text-soft); font-size: 13px; }
.sorteo-ficha-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 12.5px; color: var(--text-soft); align-items: center; }
.sorteo-ficha-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.sorteo-ficha-link { display: inline-flex; align-items: center; gap: 5px; color: var(--primary-dark); text-decoration: none; font-weight: 600; overflow-wrap: anywhere; }
.sorteo-ficha-link:hover { text-decoration: underline; }
.sorteo-ficha-copiar {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text-soft);
  border-radius: 999px; padding: 2px 9px; font-size: 11.5px; cursor: pointer; font-family: inherit;
}
.sorteo-ficha-copiar:hover { border-color: var(--primary); color: var(--primary-dark); }
.sorteo-ficha-acciones { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sorteo-estado-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .03em;
}
.sorteo-estado-chip.is-abierto { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.sorteo-estado-chip.is-cerrado { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.sorteo-btn-peligro { color: #b91c1c; }
.sorteo-btn-peligro:hover { background: #fef2f2; color: #991b1b; }

/* KPIs: 4 tarjetas, nunca una huérfana */
.sorteo-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 16px; }
@media (max-width: 900px) { .sorteo-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.sorteo-stat {
  display: flex; align-items: center; gap: 12px; padding: 14px;
  border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius);
  box-shadow: 0 1px 2px rgba(15,23,42,.03); min-width: 0;
}
.sorteo-stat-icon { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; }
.sorteo-stat-value { font-size: 22px; font-weight: 700; line-height: 1.1; }
.sorteo-stat-label { font-size: 12px; color: var(--text-soft); }

/* Barra de filtros y acciones */
.sorteo-admin-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px 12px; margin: 0 0 14px; flex-wrap: wrap; }
.sorteo-filters-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1 1 420px; }
.sorteo-filters-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sorteo-search {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 0 12px; height: 38px; flex: 1 1 220px; max-width: 360px; min-width: 180px;
}
.sorteo-search input { border: none; outline: none; background: transparent; flex: 1; min-width: 0; font-size: 13px; color: var(--text); }
.sorteo-date-range { display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
/* El datepicker global ocupa el 100 % (!important): aquí va angosto y en línea con su etiqueta. */
.sorteo-date-range .trazabilidad-datepicker { width: 132px !important; }
.sorteo-date-label { font-size: 12px; color: var(--text-soft); font-weight: 600; letter-spacing: .02em; }

.sorteo-admin-btn-win {
  position: relative; display: inline-flex; align-items: center; gap: 8px;
  padding: 0 16px; height: 38px; border: none; border-radius: 10px; cursor: pointer;
  color: #fff; font-weight: 600; font-size: 13.5px; font-family: inherit;
  background: linear-gradient(135deg,var(--primary-dark),var(--primary),#f59e0b);
  background-size: 200% 100%;
  box-shadow: 0 8px 20px -8px rgba(40,174,177,.6);
  transition: transform .18s, box-shadow .18s, background-position .6s;
  overflow: hidden;
}
.sorteo-admin-btn-win:hover:not(:disabled) { background-position: 100% 0; transform: translateY(-1px); }
.sorteo-admin-btn-win:disabled { opacity: .6; cursor: not-allowed; }

.sorteo-row-winner td { background: linear-gradient(90deg, #fef3c7 0%, #fffbeb 60%, transparent 100%); box-shadow: inset 3px 0 0 #f59e0b; }
.sorteo-winner-chip {
  display: inline-flex; align-items: center; gap: 3px; margin-top: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: .08em;
  background: linear-gradient(135deg,#fef3c7,#fde68a); color: #92400e; border: 1px solid #f59e0b55;
}

.sorteo-pagin { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; font-size: 12.5px; color: var(--text-soft); border-top: 1px solid var(--border); flex-wrap: wrap; }
.sorteo-pagin > div { display: inline-flex; align-items: center; gap: 6px; }
.sorteo-pagin-num { min-width: 52px; text-align: center; font-variant-numeric: tabular-nums; }

/* ---------- Modales ---------- */
.sorteo-modal-back {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(2,6,23,.72); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: sorteo-fade-in .25s ease both;
  overflow-y: auto;
}
@keyframes sorteo-fade-in { from { opacity: 0; } to { opacity: 1; } }
.sorteo-modal-card {
  position: relative; width: 100%; max-width: 480px;
  background: #fff; border-radius: 20px; padding: 36px 28px 28px; text-align: center;
  box-shadow: 0 40px 80px -20px rgba(0,0,0,.6); overflow: hidden;
  animation: sorteo-modal-in .45s cubic-bezier(.16,1,.3,1) both;
}
.sorteo-modal-sorteo { margin: -12px 0 16px; font-size: 12.5px; color: #64748b; font-weight: 600; letter-spacing: .02em; }

.sorteo-confirm-card {
  position: relative; width: 100%; max-width: 440px;
  background: #fff; border-radius: 18px; padding: 28px 26px 22px; text-align: center;
  box-shadow: 0 30px 70px -15px rgba(0,0,0,.45);
  animation: sorteo-modal-in .32s cubic-bezier(.16,1,.3,1) both;
}
.sorteo-confirm-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 50%; margin-bottom: 14px;
  animation: sorteo-pop-soft .4s cubic-bezier(.25,1.4,.45,1) both;
}
@keyframes sorteo-pop-soft { 0% { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
.sorteo-confirm-title { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--text, #1a1d23); letter-spacing: -.01em; }
.sorteo-confirm-message { margin: 0 0 22px; color: var(--text-soft, #6b7280); font-size: 14px; line-height: 1.55; }
.sorteo-confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
.sorteo-confirm-btn-danger, .sorteo-confirm-btn-warning {
  height: 38px; padding: 0 18px; border: none; border-radius: 10px; cursor: pointer;
  color: #fff; font-weight: 600; font-size: 13.5px; font-family: inherit;
  transition: transform .15s, box-shadow .15s, filter .15s;
}
.sorteo-confirm-btn-danger { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 8px 18px -8px rgba(220,38,38,.55); }
.sorteo-confirm-btn-warning { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 8px 18px -8px rgba(245,158,11,.55); }
.sorteo-confirm-btn-danger:hover:not(:disabled), .sorteo-confirm-btn-warning:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
.sorteo-confirm-btn-danger:disabled, .sorteo-confirm-btn-warning:disabled { opacity: .65; cursor: not-allowed; }
@keyframes sorteo-modal-in { from { opacity: 0; transform: translateY(20px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

.sorteo-modal-crown {
  display: inline-flex; padding: 14px; border-radius: 50%;
  background: linear-gradient(135deg,#fef3c7,#fde68a); color: #b45309; margin-bottom: 12px;
  animation: sorteo-spin-slow 2s linear infinite;
}
.sorteo-modal-crown.is-revealed { animation: sorteo-crown-pop .6s cubic-bezier(.25,1.4,.45,1) both; box-shadow: 0 0 0 6px rgba(245,158,11,.15), 0 0 40px rgba(245,158,11,.5); }
@keyframes sorteo-spin-slow { to { transform: rotate(360deg); } }
@keyframes sorteo-crown-pop { 0% { transform: scale(.3); } 70% { transform: scale(1.15); } 100% { transform: scale(1); } }
.sorteo-modal-title {
  margin: 0 0 18px; font-size: 22px; font-weight: 800;
  background: linear-gradient(135deg,var(--primary-dark),#f59e0b);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sorteo-reel { padding: 20px 14px; border-radius: 14px; background: linear-gradient(135deg,#f8fafc,#f1f5f9); border: 1.5px dashed #cbd5e1; margin-bottom: 4px; transition: all .4s; }
.sorteo-reel.is-revealed { background: linear-gradient(135deg,#fefce8,#fef3c7); border: 1.5px solid #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.15); animation: sorteo-reveal-pop .5s cubic-bezier(.25,1.4,.45,1) both; }
@keyframes sorteo-reveal-pop { 0% { transform: scale(.96); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }
.sorteo-reel-name { font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -.01em; animation: sorteo-reel-flip .12s ease; overflow-wrap: anywhere; }
.sorteo-reel.is-revealed .sorteo-reel-name { animation: none; font-size: 26px; }
.sorteo-reel-email { margin-top: 4px; font-size: 13px; color: #475569; overflow-wrap: anywhere; }
@keyframes sorteo-reel-flip { from { opacity: .4; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.sorteo-modal-details { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; color: #475569; font-size: 12.5px; }
.sorteo-modal-details > div { display: inline-flex; align-items: center; gap: 4px; }
.sorteo-modal-hint { margin-top: 14px; color: #64748b; font-size: 12.5px; font-style: italic; }
.sorteo-modal-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sorteo-modal-confetti span { position: absolute; top: -20px; width: 9px; height: 16px; border-radius: 2px; animation: sorteo-modal-fall linear forwards; }
@keyframes sorteo-modal-fall { to { transform: translateY(620px) rotate(720deg); opacity: 0; } }

/* Editor, QR y mailing: tarjeta ancha */
.sorteo-editor, .sorteo-qr-modal, .sorteo-mailing {
  width: 100%; max-width: 760px; background: var(--surface, #fff); border-radius: 16px; padding: 20px 22px 18px;
  box-shadow: 0 30px 70px -15px rgba(0,0,0,.45); animation: sorteo-modal-in .32s cubic-bezier(.16,1,.3,1) both;
  margin: auto;
}
.sorteo-qr-modal { max-width: 860px; }
.sorteo-mailing { max-width: 720px; }
.sorteo-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.sorteo-editor-head h3 { margin: 0; font-size: 17px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
.sorteo-editor-head h3 svg { color: var(--primary); }
.sorteo-editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; }
@media (max-width: 680px) { .sorteo-editor-grid { grid-template-columns: 1fr; } }
.sorteo-editor-campos { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.sorteo-editor-campo { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.sorteo-editor-campo > span { font-size: 12px; font-weight: 600; color: var(--text-soft); letter-spacing: .02em; }
.sorteo-editor-campo small { font-size: 11px; color: var(--text-muted, #94a3b8); }
.sorteo-editor-campo .input { width: 100%; }
.sorteo-editor-dos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 560px) { .sorteo-editor-dos { grid-template-columns: 1fr; } }
.sorteo-editor-slug { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sorteo-editor-slug > span { font-size: 12px; color: var(--text-soft); font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
.sorteo-editor-slug .input { flex: 1 1 160px; min-width: 0; font-family: ui-monospace, monospace; }
.sorteo-editor-toggle { display: inline-flex; gap: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); }
.sorteo-editor-toggle button {
  display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 12px;
  border: none; background: transparent; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--text-soft); font-family: inherit;
}
.sorteo-editor-toggle button + button { border-left: 1px solid var(--border); }
.sorteo-editor-toggle button.is-on { background: var(--primary); color: #fff; }
.sorteo-editor-preview { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px; border: 1px dashed var(--border); border-radius: 14px; background: #fafbfc; align-self: start; }
.sorteo-editor-preview-titulo { font-size: 11.5px; font-weight: 700; color: var(--text-soft); letter-spacing: .06em; text-transform: uppercase; }
.sorteo-editor-preview-url { font-size: 11px; color: var(--text-soft); text-align: center; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
.sorteo-editor-error { margin-top: 12px; background: #fee2e2; color: #b91c1c; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.sorteo-editor-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

.sorteo-swatches { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.sorteo-swatch {
  width: 28px; height: 28px; border-radius: 8px; border: 2px solid transparent; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: #fff; padding: 0;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
}
.sorteo-swatch.is-on { border-color: var(--text, #0f172a); transform: scale(1.08); }
.sorteo-swatch-hex { width: 96px !important; font-family: ui-monospace, monospace; font-size: 12.5px; height: 30px; }

/* Modal QR */
.sorteo-qr-grid { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 22px; align-items: start; }
@media (max-width: 760px) { .sorteo-qr-grid { grid-template-columns: 1fr; } }
.sorteo-qr-afiche-wrap { display: flex; justify-content: center; }
.qr-afiche {
  position: relative; width: 340px; max-width: 100%;
  background: #fff; border-radius: 26px; padding: 26px 22px 20px; text-align: center;
  border: 2px solid var(--qr-color); box-shadow: 0 24px 50px -18px color-mix(in srgb, var(--qr-color) 55%, transparent);
  color: #1a1d23; font-family: "Inter", system-ui, sans-serif;
}
.qr-afiche-logo { height: 44px; width: auto; margin-bottom: 10px; }
.qr-afiche-badge {
  display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
  padding: 5px 12px; border-radius: 999px; margin-bottom: 10px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--qr-color) 75%, #000), var(--qr-color));
  color: #fff; font-size: 10.5px; font-weight: 700; letter-spacing: .12em; overflow-wrap: anywhere;
}
.qr-afiche-titulo { margin: 0 0 4px; font-size: 20px; font-weight: 800; letter-spacing: -.015em; line-height: 1.15; overflow-wrap: anywhere; }
.qr-afiche-sub { margin: 0 0 14px; color: #6b7280; font-size: 12.5px; }
.qr-afiche-qr { display: flex; justify-content: center; padding: 10px; border-radius: 18px; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--qr-color) 25%, #fff); }
.qr-afiche-hint { margin-top: 12px; display: inline-flex; align-items: center; gap: 6px; color: color-mix(in srgb, var(--qr-color) 80%, #000); font-size: 12.5px; font-weight: 600; }
.qr-afiche-url { margin-top: 8px; font-size: 10.5px; color: #6b7280; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }

.sorteo-qr-controles { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.sorteo-qr-seccion { display: flex; flex-direction: column; gap: 6px; }
.sorteo-qr-botones { display: flex; flex-wrap: wrap; gap: 8px; }
.sorteo-qr-botones .btn { text-decoration: none; }
.sorteo-qr-link { font-size: 12px; color: var(--text-soft); overflow-wrap: anywhere; font-family: ui-monospace, monospace; background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; }
.sorteo-qr-nota { margin: 0; font-size: 11.5px; color: var(--text-soft); line-height: 1.5; }

.sorteo-mailing-alcance { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--primary-dark); background: var(--primary-light); padding: 6px 10px; border-radius: 8px; margin-bottom: 14px; }
.sorteo-mailing-conteo { background: var(--primary-light); color: var(--primary-dark); padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
`;
