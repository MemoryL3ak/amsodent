// LicitacionesDisponibles.jsx
// Listado de licitaciones "disponibles" (publicadas) que se sube por xlsx
// (columnas ID + Nombre). Los ejecutivos ven el listado y "cargan" cada
// licitación, lo que abre una Nueva Cotización prellenada y marca la fila.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import DateFilter from "../components/DateFilter";
import { Upload, Search, FileSpreadsheet, Trash2, X, ClipboardList, Check, RotateCcw } from "lucide-react";

function fmtFecha(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function LicitacionesDisponibles() {
  const navigate = useNavigate();
  const { rol, user, cargando } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  // Módulo restringido solo a administración.
  const esGestor = ["admin", "administrador"].includes(rolNorm);

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("pendientes"); // pendientes | cargadas | todas
  const [fechaDesde, setFechaDesde] = useState(""); // filtro por fecha de carga del archivo
  const [fechaHasta, setFechaHasta] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState(null);

  async function cargar() {
    setLoading(true);
    try {
      const data = await api.get("/licitaciones/disponibles");
      setLista(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo cargar el listado. ¿Está aplicada la migración?" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lista.filter((l) => {
      if (filtro === "pendientes" && l.cargada) return false;
      if (filtro === "cargadas" && !l.cargada) return false;
      const fCarga = String(l.created_at || "").slice(0, 10);
      if (fechaDesde && fCarga && fCarga < fechaDesde) return false;
      if (fechaHasta && fCarga && fCarga > fechaHasta) return false;
      if (!q) return true;
      return (
        String(l.id_licitacion || "").toLowerCase().includes(q) ||
        String(l.nombre || "").toLowerCase().includes(q)
      );
    });
  }, [lista, busqueda, filtro, fechaDesde, fechaHasta]);

  const stats = useMemo(() => ({
    total: lista.length,
    pendientes: lista.filter((l) => !l.cargada).length,
    cargadas: lista.filter((l) => l.cargada).length,
  }), [lista]);

  function cargarLicitacion(row) {
    // Solo abre la Nueva Cotización prellenada. La fila NO se marca como
    // "cargada" aquí: eso ocurre cuando la cotización se GUARDA (el guardado
    // llama al endpoint /cargar con este disponibleId).
    navigate("/crear", {
      state: { prefillLicitacion: { idLicitacionInput: row.id_licitacion || "", nombre: row.nombre || "", disponibleId: row.id } },
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

  if (!cargando && !esGestor) {
    return (
      <div className="page">
        <div className="surface"><div className="surface-body" style={{ color: "var(--danger)" }}>
          Acceso restringido: las licitaciones disponibles son solo para administración.
        </div></div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardList size={20} /> Licitaciones disponibles
          </h1>
          <p className="page-subtitle">Toma una licitación del listado para crear su cotización.</p>
        </div>
        {esGestor && (
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={15} /> Subir listado (xlsx)
          </button>
        )}
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
      </div>

      {/* Filtros */}
      <div className="filter-bar" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="filter-field" style={{ flex: 2, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="ID o nombre de la licitación…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ minWidth: 150 }}>
            <option value="pendientes">Pendientes</option>
            <option value="cargadas">Cargadas</option>
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
            {lista.length === 0 ? "No hay licitaciones en el listado. Sube un xlsx para comenzar." : "Sin resultados para el filtro."}
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 150 }}>ID Licitación</th>
                <th style={{ textAlign: "left" }}>Nombre</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap", width: 110 }}>Fecha carga</th>
                <th style={{ textAlign: "left", width: 120 }}>Estado</th>
                <th style={{ textAlign: "right", width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => cargarLicitacion(row)}
                  style={{ cursor: "pointer" }}
                  title="Crear cotización desde esta licitación"
                >
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={row.id_licitacion}>{row.id_licitacion}</td>
                  <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{row.nombre || <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
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
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef9c3", color: "#a16207" }}>
                        Pendiente
                      </span>
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
              ))}
            </tbody>
          </table>
        )}
      </div>

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
      // Acepta encabezados "ID" y "Nombre" (case-insensitive) y variantes.
      const norm = [];
      const vistos = new Set();
      for (const row of raw) {
        let idl = "", nombre = "";
        for (const [k, v] of Object.entries(row)) {
          const key = String(k).trim().toLowerCase();
          const val = typeof v === "string" ? v.trim() : (v == null ? "" : String(v));
          if (key === "id" || key === "id licitacion" || key === "id_licitacion") idl = val;
          else if (key === "nombre" || key === "nombre licitacion") nombre = val;
        }
        if (!idl) continue;
        const dedup = idl.toLowerCase();
        if (vistos.has(dedup)) continue;
        vistos.add(dedup);
        norm.push({ id_licitacion: idl, nombre });
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
            <FileSpreadsheet size={18} /> Subir listado de licitaciones
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, marginBottom: 14 }}>
          El archivo debe tener dos columnas: <strong>ID</strong> y <strong>Nombre</strong>. Las licitaciones ya existentes (mismo ID) se omiten.
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
            <strong>{filas.length}</strong> licitación(es) detectada(s) en el archivo.
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
