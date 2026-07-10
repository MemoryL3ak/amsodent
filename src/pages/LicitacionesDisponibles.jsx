// LicitacionesDisponibles.jsx
// Listado de licitaciones "disponibles" (publicadas) que se sube por xlsx
// (columnas ID + Nombre). Los ejecutivos ven el listado y "cargan" cada
// licitación, lo que abre una Nueva Cotización prellenada y marca la fila.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import DateFilter from "../components/DateFilter";
import ConfirmModal from "../components/ConfirmModal";
import { Upload, Search, FileSpreadsheet, Trash2, X, ClipboardList, Check, RotateCcw } from "lucide-react";

function fmtFecha(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Interpreta la fecha de "Cierre" que viene del xlsx (datos.cierre). Acepta
// formatos "DD-MM-YYYY[ HH:mm]", "DD/MM/YYYY", ISO "YYYY-MM-DD..." y timestamps.
// Devuelve un Date o null si no se puede interpretar.
function parseCierre(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // DD-MM-YYYY o DD/MM/YYYY, con hora opcional.
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yyyy, hh = "23", mi = "59"] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Una postulación está "vigente" si su fecha de cierre es hoy o futura (o si no
// tiene fecha de cierre registrada, para no ocultarla por falta de dato).
function estaVigente(row) {
  const cierre = parseCierre(row?.datos?.cierre);
  if (!cierre) return true;
  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const cierreDia = new Date(cierre.getFullYear(), cierre.getMonth(), cierre.getDate());
  return cierreDia.getTime() >= inicioHoy.getTime();
}

export default function LicitacionesDisponibles({ embedded = false }) {
  const navigate = useNavigate();
  const { rol, user } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  // Ver y "tomar" está disponible para todo el equipo. La gestión (subir
  // listado, desmarcar, eliminar) queda para administración y jefatura de ventas.
  const esGestor = ["admin", "administrador", "jefe_ventas", "jefe ventas", "jefe-ventas", "jefe de ventas", "jefe_ventas_especial"].includes(rolNorm);
  const currentEmail = (user?.email || "").toString().trim().toLowerCase();
  const MAX_TOMADAS = 3;

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("pendientes"); // pendientes | cargadas | todas
  const [dispon, setDispon] = useState("vigentes"); // vigentes | vencidas | todas (por fecha de cierre)
  const [fechaDesde, setFechaDesde] = useState(""); // filtro por fecha de carga del archivo
  const [fechaHasta, setFechaHasta] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [loadSeq, setLoadSeq] = useState(0); // se incrementa en cada carga (no en cada toma)
  const [confirmTomar, setConfirmTomar] = useState(null); // fila a confirmar antes de tomar
  const [confirmBorrarTodas, setConfirmBorrarTodas] = useState(false);
  const [creadasHoy, setCreadasHoy] = useState(0); // cotizaciones creadas hoy por el usuario

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

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const arr = lista.filter((l) => {
      if (filtro === "pendientes" && l.cargada) return false;
      if (filtro === "cargadas" && !l.cargada) return false;
      if (filtro === "mias" && (l.tomada_por || "").toLowerCase() !== currentEmail) return false;
      // Disponibilidad según la fecha de Cierre del portal (datos.cierre).
      if (dispon !== "todas") {
        const vig = estaVigente(l);
        if (dispon === "vigentes" && !vig) return false;
        if (dispon === "vencidas" && vig) return false;
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
    // NO se reordena aquí: el orden "tomadas primero" se aplica solo al cargar
    // (ver efecto abajo), para que marcar/desmarcar no mueva las filas de golpe.
    return arr;
  }, [lista, busqueda, filtro, dispon, fechaDesde, fechaHasta, currentEmail]);

  const stats = useMemo(() => ({
    total: lista.length,
    pendientes: lista.filter((l) => !l.cargada).length,
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
            <option value="todas">Todas</option>
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
          <table className="data-table" style={{ width: "100%", minWidth: 1280, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "center", width: 64 }}>Tomar</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 150 }}>ID Licitación</th>
                <th style={{ textAlign: "left" }}>Nombre</th>
                <th style={{ textAlign: "left", width: 190 }}>Organismo</th>
                <th style={{ textAlign: "left", width: 150 }}>Región</th>
                <th style={{ textAlign: "right", whiteSpace: "nowrap", width: 120 }}>Monto</th>
                <th style={{ textAlign: "left", width: 100 }}>Tipo</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 125 }}>Cierre</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 105 }}>Fecha carga</th>
                <th style={{ textAlign: "left", width: 120 }}>Estado</th>
                <th style={{ textAlign: "left", width: 90 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((row) => {
                const mia = (row.tomada_por || "").toLowerCase() === currentEmail;
                const deOtro = !!row.tomada_por && !mia;
                const vencida = !estaVigente(row);
                // Se bloquea marcar si la tomó otro o si está vencida (salvo que
                // sea propia, para poder liberarla).
                const bloqueada = deOtro || (vencida && !mia);
                const abrirBorrador = () => cargarLicitacion(row);
                const celdaLink = { cursor: "pointer", color: "var(--primary-dark)", textDecoration: "underline", textUnderlineOffset: 2 };
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
                  <td onClick={abrirBorrador} title="Crear cotización desde esta postulación" style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...celdaLink }}>{row.id_licitacion}</td>
                  <td onClick={abrirBorrador} title="Crear cotización desde esta postulación" style={{ whiteSpace: "normal", wordBreak: "break-word", ...celdaLink }}>{row.nombre || <span style={{ color: "var(--text-muted)", textDecoration: "none" }}>—</span>}</td>
                  <td title={row?.datos?.organismo || ""} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{row?.datos?.organismo || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td title={row?.datos?.region || ""} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{row?.datos?.region || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600 }}>{row?.datos?.monto || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{row?.datos?.tipo || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                    {(() => {
                      const c = parseCierre(row?.datos?.cierre);
                      if (!c) return <span style={{ color: "var(--text-muted)" }}>—</span>;
                      const vig = estaVigente(row);
                      return (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: vig ? "var(--text)" : "var(--danger)", fontWeight: vig ? 500 : 700 }}>
                          {fmtFecha(c)}
                          {!vig && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "#fee2e2", color: "#b91c1c" }}>Vencida</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 12.5 }}>{fmtFecha(row.created_at) || "—"}</td>
                  <td>
                    {row.cargada ? (
                      <span
                        title={`${row.cargada_por || ""}${row.cargada_at ? " · " + fmtFecha(row.cargada_at) : ""}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#15803d" }}
                      >
                        <Check size={12} /> Cargada{row.cargada_por ? ` · ${row.cargada_por}` : ""}
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef9c3", color: "#a16207" }}>
                          Pendiente
                        </span>
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
