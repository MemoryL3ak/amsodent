import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Truck,
  UserPlus,
  KeyRound,
  RefreshCw,
  Power,
  Search,
  X,
  Copy,
  Eye,
  EyeOff,
  Plus,
  MapPin,
  Inbox,
  Phone,
  Mail,
  Pencil,
  ShieldCheck,
  ShieldOff,
  ChevronDown,
  Check,
  Package,
  BarChart3,
} from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import DateFilter from "../components/DateFilter";
import { cargarGoogleMaps } from "../lib/googleMaps";

/* ── Catálogos ──────────────────────────────────────────────────────── */
const ESTADOS_VIAJE = [
  { value: "Asignado", color: "#1d4ed8", bg: "#dbeafe" },
  { value: "En ruta", color: "#0d9488", bg: "#ccfbf1" },
  { value: "Entregado", color: "#15803d", bg: "#dcfce7" },
  { value: "No entregado", color: "#b91c1c", bg: "#fee2e2" },
  { value: "Cancelado", color: "#64748b", bg: "#f1f5f9" },
];
const ESTADO_MAP = {
  ...Object.fromEntries(ESTADOS_VIAJE.map((e) => [e.value, e])),
  // Estado sintético (no es un estado real de viaje): guía interna sin chofer.
  "Por despachar": { value: "Por despachar", color: "#b45309", bg: "#fef3c7" },
};
const VIGENCIAS = [
  { value: "1m", label: "1 mes" },
  { value: "3m", label: "3 meses" },
  { value: "indefinido", label: "Indefinido" },
];

function generarClave() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const num = "23456789";
  const pick = (set, n) =>
    Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join("");
  return `${pick(abc, 4)}-${pick(num, 4)}`;
}

function fmtFechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function EstadoBadge({ estado }) {
  const m = ESTADO_MAP[estado] || ESTADO_MAP.Asignado;
  return (
    <span style={{ display: "inline-block", fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 999, color: m.color, background: m.bg }}>
      {estado}
    </span>
  );
}

/* ── Dropdown custom (reemplaza los <select> nativos) ───────────────── */
function DropdownSelect({ value, onChange, options, placeholder = "Selecciona…", minWidth = 200 }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const sel = options.find((o) => String(o.value) === String(value));

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={toggle}
        className="input"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left", background: "#fff" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: sel ? "#0f172a" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sel?.color && <span style={{ width: 9, height: 9, borderRadius: "50%", background: sel.color, flexShrink: 0 }} />}
          {sel ? sel.label : placeholder}
        </span>
        <ChevronDown size={15} style={{ color: "#94a3b8", flexShrink: 0 }} />
      </button>
      {open && coords && createPortal(
        <>
          <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 11000 }} />
          <div style={{ position: "fixed", left: coords.left, top: coords.top, minWidth: Math.max(minWidth, coords.width), zIndex: 11001, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "var(--shadow-lg)", padding: 4, maxHeight: 300, overflowY: "auto" }}>
            {options.map((op) => {
              const isSel = String(op.value) === String(value);
              return (
                <button
                  key={String(op.value)}
                  type="button"
                  onClick={() => { onChange(op.value); setOpen(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: isSel ? "var(--primary-light)" : "transparent", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 6 }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--bg)"; }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                >
                  {op.color && <span style={{ width: 9, height: 9, borderRadius: "50%", background: op.color, flexShrink: 0 }} />}
                  <span style={{ flex: 1 }}>{op.label}</span>
                  {isSel && <Check size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/* ── Página ─────────────────────────────────────────────────────────── */
export default function DespachosChoferes() {
  const [tab, setTab] = useState("choferes");
  const [toast, setToast] = useState(null);

  const [choferes, setChoferes] = useState([]);
  const [viajes, setViajes] = useState([]);
  const [porDespachar, setPorDespachar] = useState([]);
  const [recuperaciones, setRecuperaciones] = useState([]);
  const [cargando, setCargando] = useState(true);

  // Filtros viajes
  const [fChofer, setFChofer] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  // Modales
  const [modalChofer, setModalChofer] = useState(null); // {} nuevo | {chofer}
  const [modalClave, setModalClave] = useState(null); // {chofer, modo:'habilitar'|'regenerar', recuperacion_id?}
  const [modalViaje, setModalViaje] = useState(null); // {}

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [ch, vi, pend, rec] = await Promise.all([
        api.get("/choferes"),
        api.get("/choferes/viajes"),
        api.get("/choferes/despachos/pendientes").catch(() => []),
        api.get("/choferes/recuperaciones"),
      ]);
      setChoferes(Array.isArray(ch) ? ch : []);
      setViajes(Array.isArray(vi) ? vi : []);
      setPorDespachar(Array.isArray(pend) ? pend : []);
      setRecuperaciones(Array.isArray(rec) ? rec : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los datos." });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const pendientes = useMemo(
    () => recuperaciones.filter((r) => r.estado === "pendiente").length,
    [recuperaciones],
  );

  const stats = useMemo(() => ({
    choferes: choferes.length,
    porDespachar: porDespachar.length,
    activos: viajes.filter((v) => v.estado === "Asignado" || v.estado === "En ruta").length,
    enRuta: viajes.filter((v) => v.estado === "En ruta").length,
  }), [choferes, viajes, porDespachar]);

  const viajesFiltrados = useMemo(() => {
    return viajes.filter((v) => {
      if (fChofer && v.chofer_id !== fChofer) return false;
      if (fEstado && v.estado !== fEstado) return false;
      const dia = (v.created_at || "").slice(0, 10);
      if (fDesde && (!dia || dia < fDesde)) return false;
      if (fHasta && (!dia || dia > fHasta)) return false;
      return true;
    });
  }, [viajes, fChofer, fEstado, fDesde, fHasta]);

  async function cancelarViaje(viaje) {
    if (!window.confirm("¿Cancelar este viaje?")) return;
    try {
      await api.post(`/choferes/viajes/${viaje.id}/cancelar`, {});
      setToast({ type: "success", message: "Viaje cancelado." });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cancelar." });
    }
  }

  async function desactivarChofer(chofer) {
    if (!window.confirm(`¿Desactivar al chofer ${chofer.nombre}? No podrá ingresar al portal.`)) return;
    try {
      await api.post(`/choferes/${chofer.id}/desactivar`, {});
      setToast({ type: "success", message: "Chofer desactivado." });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo desactivar." });
    }
  }

  async function deshabilitarAcceso(chofer) {
    try {
      await api.post("/choferes/accesos/deshabilitar", { chofer_id: chofer.id });
      setToast({ type: "success", message: "Acceso deshabilitado." });
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo deshabilitar." });
    }
  }

  const TABS = [
    { id: "choferes", label: "Choferes", icon: Truck, count: choferes.length },
    { id: "despachos", label: "Despachos", icon: MapPin, count: viajes.length + porDespachar.length },
    { id: "estadisticas", label: "Estadísticas", icon: BarChart3, count: 0 },
    { id: "recuperaciones", label: "Recuperaciones de clave", icon: Inbox, count: pendientes },
  ];

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
          <span style={{ width: 44, height: 44, borderRadius: 13, background: "linear-gradient(135deg, var(--primary), var(--primary-dark))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 8px 18px rgba(40,174,177,.28)" }}>
            <Truck size={22} />
          </span>
          <div>
            <h1 className="page-title">Despachos y Choferes</h1>
            <p className="page-subtitle">Registra choferes, habilita su acceso al portal y asigna viajes (despachos internos o libres).</p>
          </div>
        </div>
        {tab === "choferes" && (
          <button className="btn btn-primary" onClick={() => setModalChofer({})}>
            <UserPlus size={16} /> Nuevo chofer
          </button>
        )}
        {tab === "despachos" && (
          <button className="btn btn-primary" onClick={() => setModalViaje({})}>
            <Plus size={16} /> Asignar viaje
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Choferes</div>
          <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{stats.choferes}</div>
          <div className="stat-sub">registrados</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Por despachar</div>
          <div className="stat-value" style={{ color: "#b45309" }}>{stats.porDespachar}</div>
          <div className="stat-sub">sin chofer asignado</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Viajes activos</div>
          <div className="stat-value" style={{ color: "#1d4ed8" }}>{stats.activos}</div>
          <div className="stat-sub">asignados o en ruta</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">En ruta ahora</div>
          <div className="stat-value" style={{ color: "#0d9488" }}>{stats.enRuta}</div>
          <div className="stat-sub">en camino</div>
        </div>
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {TABS.map((t) => {
          const activo = tab === t.id;
          const Icono = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px",
                border: "none", background: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700,
                color: activo ? "var(--primary-dark)" : "var(--text-muted)",
                borderBottom: `2.5px solid ${activo ? "var(--primary)" : "transparent"}`, marginBottom: -1,
              }}
            >
              <Icono size={15} /> {t.label}
              {t.count > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: activo ? "var(--primary-light)" : "var(--bg)", color: activo ? "var(--primary-dark)" : "var(--text-muted)" }}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {cargando ? (
        <p className="text-gray-500 text-sm">Cargando…</p>
      ) : tab === "choferes" ? (
        <ChoferesTab
          choferes={choferes}
          onEditar={(c) => setModalChofer({ chofer: c })}
          onHabilitar={(c) => setModalClave({ chofer: c, modo: "habilitar" })}
          onRegenerar={(c) => setModalClave({ chofer: c, modo: "regenerar" })}
          onDeshabilitar={deshabilitarAcceso}
          onDesactivar={desactivarChofer}
        />
      ) : tab === "despachos" ? (
        <DespachosTab
          viajes={viajesFiltrados}
          porDespachar={porDespachar}
          choferes={choferes}
          fChofer={fChofer} setFChofer={setFChofer}
          fEstado={fEstado} setFEstado={setFEstado}
          fDesde={fDesde} setFDesde={setFDesde}
          fHasta={fHasta} setFHasta={setFHasta}
          onCancelar={cancelarViaje}
          onAsignarChofer={(guia) => setModalViaje({ guia })}
          onEditar={(v) => setModalViaje({ viaje: v })}
        />
      ) : tab === "estadisticas" ? (
        <EstadisticasTab setToast={setToast} />
      ) : (
        <RecuperacionesTab
          recuperaciones={recuperaciones}
          onRegenerar={(r) => {
            const ch = choferes.find((c) => c.rut === r.rut) || { rut: r.rut, nombre: r.nombre };
            setModalClave({ chofer: ch, modo: "regenerar", recuperacion_id: r.id });
          }}
          onResolver={async (r) => {
            try {
              await api.put(`/choferes/recuperaciones/${r.id}/resolver`, {});
              setToast({ type: "success", message: "Solicitud marcada como resuelta." });
              cargar();
            } catch (e) {
              setToast({ type: "error", message: e?.message || "No se pudo actualizar." });
            }
          }}
        />
      )}

      {modalChofer && (
        <ModalChofer
          chofer={modalChofer.chofer}
          onCerrar={() => setModalChofer(null)}
          onGuardado={() => { setModalChofer(null); cargar(); }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}
      {modalClave && (
        <ModalClave
          chofer={modalClave.chofer}
          modo={modalClave.modo}
          recuperacionId={modalClave.recuperacion_id}
          onCerrar={() => setModalClave(null)}
          onListo={(msg) => { setModalClave(null); setToast({ type: "success", message: msg }); cargar(); }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}
      {modalViaje && (
        <ModalViaje
          choferes={choferes.filter((c) => c.activo)}
          guiaInicial={modalViaje.guia}
          viaje={modalViaje.viaje}
          onCerrar={() => setModalViaje(null)}
          onGuardado={() => { setModalViaje(null); cargar(); }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}
    </div>
  );
}

/* ── Tab: Choferes ──────────────────────────────────────────────────── */
function ChoferesTab({ choferes, onEditar, onHabilitar, onRegenerar, onDeshabilitar, onDesactivar }) {
  const [q, setQ] = useState("");
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return choferes;
    return choferes.filter((c) =>
      `${c.nombre} ${c.rut_formateado} ${c.email || ""} ${c.patente || ""}`.toLowerCase().includes(t),
    );
  }, [choferes, q]);

  return (
    <div className="surface">
      <div className="surface-body">
        <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", maxWidth: 360, marginBottom: 14 }}>
          <Search size={15} style={{ color: "#94a3b8" }} />
          <input placeholder="Buscar por nombre, RUT o patente…" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14 }} />
        </div>
        {lista.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>Sin choferes registrados.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Chofer</th>
                  <th style={{ textAlign: "left" }}>Contacto</th>
                  <th style={{ textAlign: "left" }}>Patente</th>
                  <th style={{ textAlign: "left" }}>Acceso portal</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.55 }}>
                    <td>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.nombre}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.rut_formateado}</div>
                    </td>
                    <td style={{ fontSize: 12.5, color: "#475569" }}>
                      {c.telefono && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Phone size={11} /> {c.telefono}</div>}
                      {c.email && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><Mail size={11} /> {c.email}</div>}
                      {!c.telefono && !c.email && "—"}
                    </td>
                    <td style={{ fontSize: 13 }}>{c.patente || "—"}</td>
                    <td>
                      {c.acceso_vigente ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#15803d" }}>
                          <ShieldCheck size={13} /> Habilitado
                          {c.password_temporal && <span style={{ fontWeight: 500, color: "#b45309" }}>(clave temporal)</span>}
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#64748b" }}>
                          <ShieldOff size={13} /> {c.acceso_expira && !c.acceso_vigente && c.acceso_habilitado ? "Expirado" : "Deshabilitado"}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => onEditar(c)} title="Editar"><Pencil size={13} /></button>
                        {c.acceso_vigente ? (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => onRegenerar(c)} title="Regenerar clave"><KeyRound size={13} /></button>
                            <button className="btn btn-secondary btn-sm" onClick={() => onDeshabilitar(c)} title="Deshabilitar acceso"><Power size={13} /></button>
                          </>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => onHabilitar(c)}><KeyRound size={13} /> Habilitar</button>
                        )}
                        {c.activo && <button className="btn btn-secondary btn-sm" onClick={() => onDesactivar(c)} title="Desactivar chofer" style={{ color: "#b91c1c" }}><X size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Despachos ─────────────────────────────────────────────────── */
function DespachosTab({ viajes, porDespachar, choferes, fChofer, setFChofer, fEstado, setFEstado, fDesde, setFDesde, fHasta, setFHasta, onCancelar, onAsignarChofer, onEditar }) {
  // Las guías de despacho interno sin chofer caen aquí como "Por despachar".
  // Se muestran arriba salvo que se filtre por un chofer o por otro estado.
  const mostrarPendientes = !fChofer && (!fEstado || fEstado === "Por despachar");
  const soloPendientes = fEstado === "Por despachar";
  const viajesVisibles = soloPendientes ? [] : viajes;
  const pendientes = (mostrarPendientes ? porDespachar : []).filter((g) => {
    const dia = (g.fecha_guia || "").slice(0, 10);
    if (fDesde && (!dia || dia < fDesde)) return false;
    if (fHasta && (!dia || dia > fHasta)) return false;
    return true;
  });
  const hayFiltros = fChofer || fEstado || fDesde || fHasta;
  const sinFilas = pendientes.length === 0 && viajesVisibles.length === 0;
  const limpiar = () => { setFChofer(""); setFEstado(""); setFDesde(""); setFHasta(""); };

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Chofer</label>
          <DropdownSelect
            value={fChofer}
            onChange={setFChofer}
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...choferes.map((c) => ({ value: c.id, label: c.nombre }))]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <DropdownSelect
            value={fEstado}
            onChange={setFEstado}
            placeholder="Todos"
            options={[
              { value: "", label: "Todos" },
              { value: "Por despachar", label: "Por despachar", color: "#b45309" },
              ...ESTADOS_VIAJE.map((e) => ({ value: e.value, label: e.value, color: e.color })),
            ]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Desde</label>
          <DateFilter value={fDesde} onChange={setFDesde} placeholder="Desde" maxDate={fHasta ? new Date(`${fHasta}T00:00:00`) : undefined} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Hasta</label>
          <DateFilter value={fHasta} onChange={setFHasta} placeholder="Hasta" minDate={fDesde ? new Date(`${fDesde}T00:00:00`) : undefined} />
        </div>
        {hayFiltros && (
          <div className="filter-field" style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn-secondary btn-sm" onClick={limpiar}><X size={13} /> Limpiar</button>
          </div>
        )}
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Despacho / Viaje</th>
              <th style={{ textAlign: "left" }}>Chofer</th>
              <th style={{ textAlign: "left" }}>Destino</th>
              <th style={{ textAlign: "left" }}>Estado</th>
              <th style={{ textAlign: "left" }}>Fecha</th>
              <th style={{ textAlign: "right" }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sinFilas && (
              <tr><td colSpan="6" style={{ textAlign: "center", padding: "44px 0", color: "var(--text-muted)" }}>Sin despachos con los filtros aplicados.</td></tr>
            )}

            {/* Por despachar: guías internas sin chofer asignado */}
            {pendientes.map((g) => (
              <tr key={`pend-${g.documento_id}`} style={{ background: "#fffbeb" }}>
                <td>
                  {g.numero_amso ? (
                    <span style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{g.numero_amso}</span>
                  ) : (
                    <span style={{ fontSize: 12.5, color: "#1f2937" }}>{g.numero_guia || `Doc ${g.documento_id}`}</span>
                  )}
                  <div style={{ fontSize: 12.5, color: "#1f2937", marginTop: 2 }}>{g.cliente_nombre || "—"}</div>
                </td>
                <td style={{ fontSize: 12.5, color: "#b45309", fontStyle: "italic" }}>Sin asignar</td>
                <td style={{ fontSize: 12.5, color: "#475569" }}>{g.comuna || "—"}</td>
                <td><EstadoBadge estado="Por despachar" /></td>
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.fecha_guia ? fmtFechaHora(g.fecha_guia) : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn btn-primary btn-sm" onClick={() => onAsignarChofer(g)}>
                      <Truck size={13} /> Asignar chofer
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {/* Viajes ya asignados */}
            {viajesVisibles.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.numero_amso ? (
                    <span style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{v.numero_amso}</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", background: "#f3e8ff", padding: "1px 8px", borderRadius: 999 }}>Viaje libre</span>
                  )}
                  <div style={{ fontSize: 12.5, color: "#1f2937", marginTop: 2 }}>{v.titulo || "—"}</div>
                  {(v.bultos || v.detalle_carga) && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#475569", marginTop: 3, background: "var(--bg)", borderRadius: 6, padding: "2px 8px" }}>
                      <Package size={12} />
                      {v.bultos ? `${v.bultos} ${v.bultos === 1 ? "caja" : "cajas"}` : "Carga"}
                      {v.detalle_carga ? ` · ${v.detalle_carga}` : ""}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 13 }}>{v.chofer_nombre || "—"}</td>
                <td style={{ fontSize: 12.5, color: "#475569" }}>
                  {v.destino_direccion || v.destino_comuna || "—"}
                  {v.destino_comuna && v.destino_direccion ? <div style={{ color: "var(--text-muted)" }}>{v.destino_comuna}</div> : null}
                </td>
                <td><EstadoBadge estado={v.estado} /></td>
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtFechaHora(v.created_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onEditar(v)} title="Editar viaje"><Pencil size={13} /></button>
                    {(v.estado === "Asignado" || v.estado === "En ruta") && (
                      <button className="btn btn-secondary btn-sm" onClick={() => onCancelar(v)} style={{ color: "#b91c1c" }}>Cancelar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Tab: Recuperaciones ────────────────────────────────────────────── */
function RecuperacionesTab({ recuperaciones, onRegenerar, onResolver }) {
  if (recuperaciones.length === 0) {
    return <div className="surface"><div className="surface-body" style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px 0" }}>No hay solicitudes de recuperación.</div></div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {recuperaciones.map((r) => {
        const resuelta = r.estado === "resuelta";
        return (
          <div key={r.id} className="surface">
            <div className="surface-body" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 999, background: resuelta ? "#dcfce7" : "#fef3c7", color: resuelta ? "#15803d" : "#b45309" }}>
                  {resuelta ? "Resuelta" : "Pendiente"}
                </span>
                <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 6 }}>
                  {r.nombre || "Chofer"} <span style={{ color: "#94a3b8", fontWeight: 500 }}>· {r.rut_formateado}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtFechaHora(r.created_at)}</div>
                <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4 }}>
                  {r.contacto_email && <span style={{ marginRight: 12 }}><Mail size={11} /> {r.contacto_email}</span>}
                  {r.contacto_telefono && <span><Phone size={11} /> {r.contacto_telefono}</span>}
                </div>
                {r.mensaje && <div style={{ fontSize: 13, color: "#334155", marginTop: 6, background: "var(--bg)", borderRadius: 8, padding: "8px 12px" }}>{r.mensaje}</div>}
              </div>
              {!resuelta && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => onRegenerar(r)}><KeyRound size={13} /> Regenerar clave</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => onResolver(r)}>Marcar resuelta</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Tab: Estadísticas (mapa de calor de viajes por chofer) ─────────── */
const PERIODOS = [
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
  { value: 180, label: "180 días" },
];
// Escala teal para el calendario (de menos a más viajes en el día).
const ESCALA_CALOR = ["#d6eeef", "#9bdce0", "#5cc6ca", "#2aa7ab", "#16797c"];

function colorCalor(n, max) {
  if (!n) return "#f1f5f9";
  const idx = Math.min(
    ESCALA_CALOR.length - 1,
    Math.max(0, Math.ceil((n / Math.max(max, 1)) * ESCALA_CALOR.length) - 1),
  );
  return ESCALA_CALOR[idx];
}

function hexToRgba(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function fmtDiaCorto(iso) {
  // iso = "YYYY-MM-DD"
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Fecha local (no UTC) a "YYYY-MM-DD".
function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function hoyISO() { return isoLocal(new Date()); }
function hoyMenosISO(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); }

function EstadisticasTab({ setToast }) {
  const [desde, setDesde] = useState(() => hoyMenosISO(29));
  const [hasta, setHasta] = useState(() => hoyISO());
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);

  // Aplica un preset rápido (últimos N días hasta hoy).
  function aplicarPreset(n) {
    setHasta(hoyISO());
    setDesde(hoyMenosISO(n - 1));
  }
  const presetActivo = (n) => hasta === hoyISO() && desde === hoyMenosISO(n - 1);

  useEffect(() => {
    if (!desde || !hasta) return;
    let cancel = false;
    setCargando(true);
    api
      .get(`/choferes/estadisticas?desde=${desde}&hasta=${hasta}`)
      .then((r) => { if (!cancel) setData(r); })
      .catch((e) => { if (!cancel) setToast?.({ type: "error", message: e?.message || "No se pudieron cargar las estadísticas." }); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [desde, hasta, setToast]);

  const choferesActivos = useMemo(
    () => (data?.choferes || []).filter((c) => c.total_historico > 0),
    [data],
  );

  if (cargando && !data) {
    return <div className="surface"><div className="surface-body" style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>Cargando estadísticas…</div></div>;
  }
  if (!data) return null;

  const { dias_lista = [], max_por_dia = 0, max_por_estado = 0, totales, rango } = data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: cargando ? 0.6 : 1, transition: "opacity .15s" }}>
      {/* Selector de período (presets + rango con calendario) + resumen */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Período: <strong style={{ color: "#0f172a" }}>{rango?.desde && fmtDiaCorto(rango.desde)} → {rango?.hasta && fmtDiaCorto(rango.hasta)}</strong>{" · "}
          <strong style={{ color: "var(--primary-dark)" }}>{totales?.total || 0}</strong> viaje{totales?.total === 1 ? "" : "s"} en el período
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: "var(--bg)", borderRadius: 999, padding: 3 }}>
            {PERIODOS.map((p) => (
              <button key={p.value} type="button" onClick={() => aplicarPreset(p.value)} style={{
                border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "6px 14px", borderRadius: 999,
                background: presetActivo(p.value) ? "var(--primary)" : "transparent",
                color: presetActivo(p.value) ? "#fff" : "var(--text-muted)",
              }}>{p.label}</button>
            ))}
          </div>
          <div className="filter-field">
            <label className="filter-label">Desde</label>
            <DateFilter value={desde} onChange={(v) => v && setDesde(v)} placeholder="Desde" maxDate={hasta ? new Date(`${hasta}T00:00:00`) : new Date()} />
          </div>
          <div className="filter-field">
            <label className="filter-label">Hasta</label>
            <DateFilter value={hasta} onChange={(v) => v && setHasta(v)} placeholder="Hasta" minDate={desde ? new Date(`${desde}T00:00:00`) : undefined} maxDate={new Date()} />
          </div>
        </div>
      </div>

      {/* KPIs por estado (período) */}
      <div className="stats-row stats-5">
        {ESTADOS_VIAJE.map((e) => (
          <div key={e.value} className="stat-card">
            <div className="stat-label">{e.value}</div>
            <div className="stat-value" style={{ color: e.color }}>{totales?.por_estado?.[e.value] || 0}</div>
            <div className="stat-sub">en el período</div>
          </div>
        ))}
      </div>

      {choferesActivos.length === 0 ? (
        <div className="surface"><div className="surface-body" style={{ padding: "36px 0", textAlign: "center", color: "var(--text-muted)" }}>No hay viajes registrados para mostrar.</div></div>
      ) : (
        <>
          {/* Mapa de calor tipo calendario: choferes × días */}
          <div className="surface">
            <div className="surface-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "#0f172a" }}>Mapa de calor · viajes por día</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
                  Menos
                  <span style={{ width: 13, height: 13, borderRadius: 3, background: "#f1f5f9", border: "1px solid #e2e8f0" }} />
                  {ESCALA_CALOR.map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 3, background: c }} />)}
                  Más
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 1 }} />
                      {dias_lista.map((d, i) => (
                        <th key={d} style={{ fontSize: 9, fontWeight: 600, color: "#94a3b8", height: 22, verticalAlign: "bottom", whiteSpace: "nowrap" }}>
                          {/* etiqueta cada ~5 días para no saturar */}
                          {i % 5 === 0 ? <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{fmtDiaCorto(d)}</span> : ""}
                        </th>
                      ))}
                      <th style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", paddingLeft: 8 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {choferesActivos.map((c) => (
                      <tr key={c.chofer_id}>
                        <td style={{ position: "sticky", left: 0, background: "var(--surface)", zIndex: 1, paddingRight: 10, fontSize: 12.5, fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }} title={c.nombre}>
                          {c.nombre}
                        </td>
                        {dias_lista.map((d) => {
                          const n = c.por_dia?.[d] || 0;
                          return (
                            <td key={d} title={`${c.nombre} · ${fmtDiaCorto(d)}: ${n} viaje${n === 1 ? "" : "s"}`}
                              style={{ width: 15, height: 15, borderRadius: 3, background: colorCalor(n, max_por_dia), cursor: "default" }} />
                          );
                        })}
                        <td style={{ paddingLeft: 8, fontSize: 12.5, fontWeight: 800, color: "var(--primary-dark)", textAlign: "right" }}>{c.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Matriz choferes × estado */}
          <div className="surface">
            <div className="surface-body">
              <h3 style={{ margin: "0 0 12px", fontSize: 14.5, fontWeight: 800, color: "#0f172a" }}>Viajes por estado y chofer</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Chofer</th>
                      {ESTADOS_VIAJE.map((e) => <th key={e.value} style={{ textAlign: "center" }}>{e.value}</th>)}
                      <th style={{ textAlign: "right" }}>Total</th>
                      <th style={{ textAlign: "right" }}>Histórico</th>
                      <th style={{ textAlign: "left" }}>Último viaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {choferesActivos.map((c) => (
                      <tr key={c.chofer_id}>
                        <td>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{c.nombre}</div>
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{c.rut_formateado}{c.patente ? ` · ${c.patente}` : ""}</div>
                        </td>
                        {ESTADOS_VIAJE.map((e) => {
                          const n = c.por_estado?.[e.value] || 0;
                          const ratio = max_por_estado ? n / max_por_estado : 0;
                          return (
                            <td key={e.value} style={{ textAlign: "center", padding: 4 }}>
                              <span style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 30, height: 26, padding: "0 8px", borderRadius: 7,
                                fontSize: 12.5, fontWeight: 800,
                                color: n ? e.color : "#cbd5e1",
                                background: n ? hexToRgba(e.color, 0.12 + 0.5 * ratio) : "transparent",
                              }}>{n}</span>
                            </td>
                          );
                        })}
                        <td style={{ textAlign: "right", fontWeight: 800, color: "var(--primary-dark)" }}>{c.total}</td>
                        <td style={{ textAlign: "right", fontSize: 12.5, color: "var(--text-muted)" }}>{c.total_historico}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{fmtFechaHora(c.ultimo_viaje_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Modal: crear / editar chofer ───────────────────────────────────── */
function ModalChofer({ chofer, onCerrar, onGuardado, onError }) {
  const editando = !!chofer?.id;
  const [nombre, setNombre] = useState(chofer?.nombre || "");
  const [rut, setRut] = useState(chofer?.rut_formateado || "");
  const [telefono, setTelefono] = useState(chofer?.telefono || "");
  const [email, setEmail] = useState(chofer?.email || "");
  const [patente, setPatente] = useState(chofer?.patente || "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const body = { nombre, telefono, email, patente };
      if (editando) {
        await api.put(`/choferes/${chofer.id}`, body);
      } else {
        await api.post("/choferes", { ...body, rut });
      }
      onGuardado();
    } catch (e) {
      onError(e?.message || "No se pudo guardar el chofer.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalShell titulo={editando ? "Editar chofer" : "Nuevo chofer"} onCerrar={onCerrar} ancho={460}>
      <Campo label="Nombre *"><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del chofer" /></Campo>
      <Campo label="RUT *"><input className="input" value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12.345.678-9" disabled={editando} /></Campo>
      <div style={{ display: "flex", gap: 10 }}>
        <Campo label="Teléfono" flex><input className="input" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+56 9 ..." /></Campo>
        <Campo label="Patente" flex><input className="input" value={patente} onChange={(e) => setPatente(e.target.value)} placeholder="ABCD12" /></Campo>
      </div>
      <Campo label="Correo (para enviar la clave)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="chofer@correo.cl" /></Campo>
      <FooterModal onCerrar={onCerrar}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
      </FooterModal>
    </ModalShell>
  );
}

/* ── Modal: habilitar / regenerar clave ─────────────────────────────── */
function ModalClave({ chofer, modo, recuperacionId, onCerrar, onListo, onError }) {
  const [password, setPassword] = useState(generarClave());
  const [vigencia, setVigencia] = useState("indefinido");
  const [verClave, setVerClave] = useState(true);
  const [reenviar, setReenviar] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const esHabilitar = modo === "habilitar";

  async function guardar() {
    if ((password || "").length < 6) { onError("La clave debe tener al menos 6 caracteres."); return; }
    setGuardando(true);
    try {
      if (esHabilitar) {
        const r = await api.post("/choferes/accesos/habilitar", { chofer_id: chofer.id, password, vigencia });
        onListo(r?.correo_enviado ? `Acceso habilitado. Correo enviado a ${r.correo_destino}.` : "Acceso habilitado (sin correo: el chofer no tiene email válido).");
      } else {
        const r = await api.post("/choferes/accesos/regenerar-clave", {
          chofer_id: chofer.id, rut: chofer.rut, password, reenviar_correo: reenviar, recuperacion_id: recuperacionId,
        });
        onListo(r?.correo_enviado ? `Clave regenerada. Correo enviado a ${r.correo_destino}.` : "Clave regenerada.");
      }
    } catch (e) {
      onError(e?.message || "No se pudo completar la operación.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalShell titulo={esHabilitar ? "Habilitar acceso" : "Regenerar clave"} onCerrar={onCerrar} ancho={440}>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" }}>
        {esHabilitar ? "Se generará una clave temporal para " : "Nueva clave temporal para "}
        <strong>{chofer.nombre}</strong>{chofer.rut_formateado ? ` (${chofer.rut_formateado})` : ""}. El chofer deberá cambiarla al ingresar.
      </p>
      <Campo label="Clave temporal">
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input className="input" type={verClave ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 64 }} />
            <div style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 2 }}>
              <button type="button" onClick={() => setVerClave((v) => !v)} style={iconBtn} title={verClave ? "Ocultar" : "Ver"}>{verClave ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              <button type="button" onClick={() => navigator.clipboard?.writeText(password)} style={iconBtn} title="Copiar"><Copy size={15} /></button>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPassword(generarClave())} title="Generar otra"><RefreshCw size={14} /></button>
        </div>
      </Campo>
      {esHabilitar && (
        <Campo label="Vigencia del acceso">
          <select className="input" value={vigencia} onChange={(e) => setVigencia(e.target.value)}>
            {VIGENCIAS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </Campo>
      )}
      {!esHabilitar && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", cursor: "pointer", marginTop: 4 }}>
          <input type="checkbox" checked={reenviar} onChange={(e) => setReenviar(e.target.checked)} /> Reenviar la clave por correo
        </label>
      )}
      <FooterModal onCerrar={onCerrar}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Procesando…" : esHabilitar ? "Habilitar y enviar" : "Regenerar"}</button>
      </FooterModal>
    </ModalShell>
  );
}

/* ── Input de dirección con autocompletado de Google Places ─────────── */
function AutocompleteDireccion({ value, onChange, onPlace, placeholder }) {
  const inputRef = useRef(null);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let cancel = false;
    cargarGoogleMaps()
      .then((google) => {
        if (cancel || !inputRef.current) return;
        if (!google?.maps?.places?.Autocomplete) {
          setAviso("Autocompletado no disponible; escribe la dirección manualmente.");
          return;
        }
        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "cl" },
          fields: ["formatted_address", "geometry", "address_components", "name"],
          types: ["geocode"],
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place) return;
          const comp = place.address_components || [];
          const get = (t) => comp.find((c) => c.types.includes(t))?.long_name || "";
          const comuna = get("locality") || get("administrative_area_level_3") || get("administrative_area_level_2");
          onPlace?.({
            direccion: place.formatted_address || place.name || "",
            comuna,
            lat: place.geometry?.location?.lat?.() ?? null,
            lng: place.geometry?.location?.lng?.() ?? null,
          });
        });
      })
      .catch(() => setAviso("Autocompletado no disponible (falta API key de Google Maps); escribe la dirección manualmente."));
    return () => { cancel = true; };
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Busca la dirección…"}
        autoComplete="off"
      />
      {aviso && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>{aviso}</div>}
    </>
  );
}

/* ── Modal: asignar / editar viaje ──────────────────────────────────── */
function ModalViaje({ choferes, guiaInicial, viaje, onCerrar, onGuardado, onError }) {
  const editando = !!viaje;
  const fijarGuia = !editando && !!guiaInicial; // "Asignar chofer" a un despacho pendiente
  // En edición, un viaje vinculado a guía tiene numero_amso (no se cambia el vínculo).
  const esLibre = editando ? !viaje.numero_amso : false;

  const [choferId, setChoferId] = useState(viaje?.chofer_id || "");
  const [tipo, setTipo] = useState("guia"); // solo para creación: 'guia' | 'libre'
  const [guias, setGuias] = useState([]);
  const [docId, setDocId] = useState(guiaInicial?.documento_id || "");
  const [busca, setBusca] = useState("");
  const [titulo, setTitulo] = useState(viaje?.titulo || "");
  const [direccion, setDireccion] = useState(viaje?.destino_direccion || "");
  const [comuna, setComuna] = useState(viaje?.destino_comuna || "");
  const [lat, setLat] = useState(viaje?.destino_lat ?? null);
  const [lng, setLng] = useState(viaje?.destino_lng ?? null);
  const [receptor, setReceptor] = useState(viaje?.receptor_nombre || "");
  const [bultos, setBultos] = useState(viaje?.bultos ?? "");
  const [detalleCarga, setDetalleCarga] = useState(viaje?.detalle_carga || "");
  const [notas, setNotas] = useState(viaje?.notas || "");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (editando || fijarGuia) return; // no hace falta el listado de guías
    api.get("/choferes/guias-disponibles").then((g) => setGuias(Array.isArray(g) ? g : [])).catch(() => {});
  }, [editando, fijarGuia]);

  const guiasFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return guias;
    return guias.filter((g) => `${g.numero_amso || ""} ${g.numero_guia || ""} ${g.cliente_nombre || ""} ${g.comuna || ""}`.toLowerCase().includes(t));
  }, [guias, busca]);

  const numeroAmso = editando ? viaje.numero_amso : null;
  const mostrarTitulo = editando || (!fijarGuia && tipo === "libre");
  const mostrarEntrega = editando || fijarGuia || (!fijarGuia && tipo === "libre");

  async function guardar() {
    if (!choferId) { onError("Selecciona un chofer."); return; }
    setGuardando(true);
    try {
      if (editando) {
        if (esLibre && !titulo.trim() && !direccion.trim()) {
          onError("Indica un título o dirección de destino."); setGuardando(false); return;
        }
        await api.put(`/choferes/viajes/${viaje.id}`, {
          chofer_id: choferId,
          titulo: titulo.trim() || null,
          destino_direccion: direccion.trim() || null,
          destino_comuna: comuna.trim() || null,
          destino_lat: lat,
          destino_lng: lng,
          receptor_nombre: receptor.trim() || null,
          bultos: bultos !== "" ? Number(bultos) : null,
          detalle_carga: detalleCarga.trim() || null,
          notas: notas.trim() || null,
        });
      } else {
        if (!fijarGuia && tipo === "guia" && !docId) { onError("Selecciona una guía interna."); setGuardando(false); return; }
        if (tipo === "libre" && !titulo.trim() && !direccion.trim()) { onError("Indica un título o dirección de destino."); setGuardando(false); return; }
        await api.post("/choferes/viajes", {
          chofer_id: choferId,
          licitacion_documento_id: fijarGuia ? guiaInicial.documento_id : tipo === "guia" ? docId : null,
          titulo: titulo.trim() || null,
          destino_direccion: direccion.trim() || null,
          destino_comuna: comuna.trim() || null,
          destino_lat: lat,
          destino_lng: lng,
          receptor_nombre: receptor.trim() || null,
          bultos: bultos !== "" ? Number(bultos) : null,
          detalle_carga: detalleCarga.trim() || null,
          notas: notas.trim() || null,
        });
      }
      onGuardado();
    } catch (e) {
      onError(e?.message || (editando ? "No se pudo guardar el viaje." : "No se pudo crear el viaje."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalShell titulo={editando ? "Editar viaje" : fijarGuia ? "Asignar chofer al despacho" : "Asignar viaje"} onCerrar={onCerrar} ancho={560}>
      {fijarGuia && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#fffbeb" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "#b45309", marginBottom: 4 }}>Despacho a asignar</div>
          <div style={{ fontWeight: 800, color: "var(--primary-dark)", fontSize: 15 }}>{guiaInicial.numero_amso || guiaInicial.numero_guia || `Doc ${guiaInicial.documento_id}`}</div>
          <div style={{ fontSize: 12.5, color: "#475569" }}>{guiaInicial.cliente_nombre || "—"}{guiaInicial.comuna ? ` · ${guiaInicial.comuna}` : ""}</div>
        </div>
      )}
      {editando && numeroAmso && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12.5, color: "#475569" }}>
          Despacho <span style={{ fontWeight: 800, color: "var(--primary-dark)" }}>{numeroAmso}</span>
        </div>
      )}

      <Campo label="Chofer *">
        <DropdownSelect
          value={choferId}
          onChange={setChoferId}
          placeholder="Selecciona un chofer…"
          options={choferes.map((c) => ({ value: c.id, label: `${c.nombre} — ${c.rut_formateado}` }))}
        />
      </Campo>

      {!editando && !fijarGuia && (
        <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
          {[{ id: "guia", label: "Vincular guía interna" }, { id: "libre", label: "Viaje libre" }].map((op) => (
            <button key={op.id} type="button" onClick={() => setTipo(op.id)} style={{
              flex: 1, padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13,
              border: `1.5px solid ${tipo === op.id ? "var(--primary)" : "var(--border)"}`,
              background: tipo === op.id ? "var(--primary-light)" : "#fff",
              color: tipo === op.id ? "var(--primary-dark)" : "var(--text-muted)",
            }}>{op.label}</button>
          ))}
        </div>
      )}

      {!editando && !fijarGuia && tipo === "guia" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <Search size={15} style={{ color: "#94a3b8" }} />
            <input placeholder="Buscar por N° AMSO, cliente o comuna…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14 }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            {guiasFiltradas.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No hay guías internas disponibles para asignar.</div>
            ) : guiasFiltradas.map((g) => {
              const sel = String(docId) === String(g.documento_id);
              return (
                <button key={g.documento_id} type="button" onClick={() => setDocId(g.documento_id)} style={{
                  display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", gap: 8,
                  padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer",
                  background: sel ? "var(--primary-light)" : "#fff",
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{g.numero_amso || g.numero_guia || `Doc ${g.documento_id}`}</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>{g.cliente_nombre || "—"}{g.comuna ? ` · ${g.comuna}` : ""}</div>
                  </div>
                  {sel && <span style={{ color: "var(--primary)", fontWeight: 700, fontSize: 12 }}>✓ Seleccionada</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {mostrarTitulo && (
        <Campo label="Título del viaje"><input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Retiro en bodega central" /></Campo>
      )}

      {mostrarEntrega && (
        <>
          <Campo label={fijarGuia || numeroAmso ? "Dirección de entrega (opcional)" : "Dirección de destino"}>
            <AutocompleteDireccion
              value={direccion}
              placeholder="Busca la dirección en Google Maps…"
              onChange={(v) => { setDireccion(v); setLat(null); setLng(null); }}
              onPlace={({ direccion: d, comuna: cm, lat: la, lng: ln }) => {
                setDireccion(d);
                if (cm) setComuna(cm);
                setLat(la);
                setLng(ln);
              }}
            />
            {lat != null && lng != null && (
              <div style={{ fontSize: 11, color: "#15803d", marginTop: 4 }}>
                ✓ Ubicación exacta capturada (el chofer podrá navegar directo).
              </div>
            )}
          </Campo>
          <div style={{ display: "flex", gap: 10 }}>
            <Campo label="Comuna" flex><input className="input" value={comuna} onChange={(e) => setComuna(e.target.value)} /></Campo>
            <Campo label="Receptor" flex><input className="input" value={receptor} onChange={(e) => setReceptor(e.target.value)} /></Campo>
          </div>
        </>
      )}

      {/* Carga a entregar */}
      <div style={{ borderTop: "1px dashed var(--border)", margin: "4px 0 14px", paddingTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--primary-dark)", marginBottom: 10 }}>
          <Package size={14} /> Carga a entregar
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 130 }}>
            <Campo label="N° de cajas"><input className="input" type="number" min="0" value={bultos} onChange={(e) => setBultos(e.target.value)} placeholder="Ej: 3" /></Campo>
          </div>
          <Campo label="Detalle (qué se entrega)" flex>
            <input className="input" value={detalleCarga} onChange={(e) => setDetalleCarga(e.target.value)} placeholder="Ej: cajas de insumos dentales, equipo, etc." />
          </Campo>
        </div>
        <Campo label="Notas (opcional)"><textarea className="input" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} style={{ resize: "vertical" }} /></Campo>
      </div>

      <FooterModal onCerrar={onCerrar}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Asignar viaje"}
        </button>
      </FooterModal>
    </ModalShell>
  );
}

/* ── Helpers UI de modal ────────────────────────────────────────────── */
const iconBtn = { background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8", padding: 4, display: "inline-flex" };

function Campo({ label, children, flex }) {
  return (
    <div className="field" style={{ marginBottom: 12, flex: flex ? 1 : undefined }}>
      <label className="field-label" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function ModalShell({ titulo, children, onCerrar, ancho = 480 }) {
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", backdropFilter: "blur(2px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div style={{ background: "#fff", borderRadius: 14, width: ancho, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(15,23,42,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{titulo}</h3>
          <button type="button" onClick={onCerrar} style={{ ...iconBtn, color: "var(--text-muted)" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function FooterModal({ children, onCerrar }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
      <button type="button" className="btn btn-secondary" onClick={onCerrar}>Cancelar</button>
      {children}
    </div>
  );
}
