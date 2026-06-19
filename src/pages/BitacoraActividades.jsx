import { useCallback, useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Clock, User, Filter,
  CalendarDays, CalendarRange, CalendarClock, ListChecks, Check, Paperclip, FileText,
} from "lucide-react";

const ACTIVIDADES_BUCKET = "chat-adjuntos";

/* ── Combo: react-select estilizado igual a la clase .input de la app ──── */
const comboTheme = (theme) => ({
  ...theme,
  borderRadius: 8,
  colors: {
    ...theme.colors,
    primary: "#28aeb1",
    primary25: "#e6f7f7",
    primary50: "#cdeeef",
    primary75: "#7fd4d6",
  },
});
const comboStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    borderColor: state.isFocused ? "var(--primary)" : "var(--border-strong)",
    boxShadow: state.isFocused ? "0 0 0 3px rgba(40,174,177,.12)" : "none",
    borderRadius: "var(--radius)",
    fontSize: 13.5,
    backgroundColor: "var(--surface)",
    "&:hover": { borderColor: "var(--primary)" },
  }),
  valueContainer: (b) => ({ ...b, padding: "0 10px" }),
  indicatorSeparator: (b) => ({ ...b, display: "none" }),
  indicatorsContainer: (b) => ({ ...b, height: 34 }),
  dropdownIndicator: (b) => ({ ...b, padding: 6, color: "var(--text-muted)" }),
  clearIndicator: (b) => ({ ...b, padding: 6, color: "var(--text-muted)" }),
  menu: (b) => ({ ...b, fontSize: 13.5, borderRadius: 10, overflow: "hidden", boxShadow: "0 10px 30px rgba(15,23,42,.15)", border: "1px solid var(--border)" }),
  menuPortal: (b) => ({ ...b, zIndex: 12000 }),
  placeholder: (b) => ({ ...b, color: "var(--text-muted)" }),
  singleValue: (b) => ({ ...b, color: "var(--text)" }),
  option: (b, s) => ({
    ...b,
    fontSize: 13.5,
    color: s.isSelected ? "#fff" : "var(--text)",
    backgroundColor: s.isSelected ? "var(--primary)" : s.isFocused ? "#e6f7f7" : "transparent",
    cursor: "pointer",
  }),
};

function Combo({ value, onChange, options, placeholder = "Selecciona…", isSearchable = true, isClearable = false }) {
  const sel = options.find((o) => String(o.value) === String(value ?? "")) || null;
  return (
    <Select
      classNamePrefix="rs"
      value={sel}
      onChange={(o) => onChange(o ? o.value : "")}
      options={options}
      placeholder={placeholder}
      isSearchable={isSearchable}
      isClearable={isClearable}
      noOptionsMessage={() => "Sin opciones"}
      menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
      menuPosition="fixed"
      styles={comboStyles}
      theme={comboTheme}
    />
  );
}

/* ── Tipos de actividad (color + etiqueta) ───────────────────────────── */
const TIPOS = [
  { value: "llamada", label: "Llamada", color: "#0ea5e9" },
  { value: "visita", label: "Visita", color: "#16a34a" },
  { value: "reunion", label: "Reunión", color: "#6366f1" },
  { value: "correo", label: "Correo", color: "#f59e0b" },
  { value: "seguimiento", label: "Seguimiento", color: "#ec4899" },
  { value: "tarea", label: "Tarea", color: "#14b8a6" },
  { value: "otro", label: "Otro", color: "#64748b" },
];
const TIPO_MAP = Object.fromEntries(TIPOS.map((t) => [t.value, t]));
const colorTipo = (t) => (TIPO_MAP[t]?.color || "#64748b");
const labelTipo = (t) => (TIPO_MAP[t]?.label || t || "Otro");

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/* ── Helpers de fecha (local, sin timezone shift) ─────────────────────── */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYMD(s) {
  return new Date(`${String(s).slice(0, 10)}T00:00:00`);
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n, 1); return x; }
// Lunes como primer día de la semana (getDay: 0=Dom).
function lunesDe(d) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; }
function mismaFecha(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtHora(h) { return h ? String(h).slice(0, 5) : ""; }
function fmtFechaLarga(d) {
  return `${DIAS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

export default function BitacoraActividades() {
  const { user, rol } = useAuth();
  const rolNorm = (rol || "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin" || rolNorm === "administrador";

  const [vista, setVista] = useState("mes"); // mes | semana | dia | agenda
  const [ancla, setAncla] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [actividades, setActividades] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filtros
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroUsuario, setFiltroUsuario] = useState("");

  // Modal de actividad
  const [modal, setModal] = useState(null); // { ...actividad } o { fecha } para nueva
  const [confirmDel, setConfirmDel] = useState(null);

  // Rango visible según la vista (para la consulta).
  const rango = useMemo(() => {
    if (vista === "dia") return { desde: ymd(ancla), hasta: ymd(ancla) };
    if (vista === "semana") { const l = lunesDe(ancla); return { desde: ymd(l), hasta: ymd(addDays(l, 6)) }; }
    // mes y agenda: grilla del mes (con días de relleno).
    const ini = lunesDe(new Date(ancla.getFullYear(), ancla.getMonth(), 1));
    return { desde: ymd(ini), hasta: ymd(addDays(ini, 41)) };
  }, [vista, ancla]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("desde", rango.desde);
      params.set("hasta", rango.hasta);
      if (filtroTipo) params.set("tipo", filtroTipo);
      if (filtroCliente) params.set("cliente_id", filtroCliente);
      if (esAdmin && filtroUsuario) params.set("email", filtroUsuario);
      const data = await api.get(`/actividades?${params.toString()}`);
      setActividades(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron cargar las actividades." });
    } finally {
      setLoading(false);
    }
  }, [rango, filtroTipo, filtroCliente, filtroUsuario, esAdmin]);

  useEffect(() => { cargar(); }, [cargar]);

  // Clientes (para el selector y filtro) y usuarios (admin).
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get("/clientes");
        setClientes(Array.isArray(data) ? data : []);
      } catch { /* */ }
    })();
    if (esAdmin) {
      (async () => {
        try {
          const u = await api.get("/actividades/usuarios");
          setUsuarios(Array.isArray(u) ? u : []);
        } catch { /* */ }
      })();
    }
  }, [esAdmin]);

  const clienteOptions = useMemo(
    () => clientes
      .map((c) => ({ value: c.id, label: `${c.nombre || "—"}${c.rut ? ` · ${c.rut}` : ""}`, nombre: c.nombre || "", tipo: c.tipo_cliente || "" }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [clientes],
  );

  // Agrupar actividades por fecha (YYYY-MM-DD) para pintar el calendario.
  const porFecha = useMemo(() => {
    const m = {};
    actividades.forEach((a) => {
      const k = String(a.fecha).slice(0, 10);
      (m[k] = m[k] || []).push(a);
    });
    Object.values(m).forEach((arr) => arr.sort((x, y) => {
      if (x.todo_el_dia && !y.todo_el_dia) return -1;
      if (!x.todo_el_dia && y.todo_el_dia) return 1;
      return String(x.hora_inicio || "").localeCompare(String(y.hora_inicio || ""));
    }));
    return m;
  }, [actividades]);

  const kpis = useMemo(() => {
    const total = actividades.length;
    const pendientes = actividades.filter((a) => a.estado !== "realizada").length;
    return { total, pendientes, realizadas: total - pendientes };
  }, [actividades]);

  // Navegación.
  function navegar(dir) {
    if (vista === "dia") setAncla((d) => addDays(d, dir));
    else if (vista === "semana") setAncla((d) => addDays(d, dir * 7));
    else setAncla((d) => addMonths(d, dir));
  }
  function hoy() { const d = new Date(); d.setHours(0, 0, 0, 0); setAncla(d); }

  const tituloPeriodo = useMemo(() => {
    if (vista === "dia") return fmtFechaLarga(ancla);
    if (vista === "semana") { const l = lunesDe(ancla); const f = addDays(l, 6); return `${l.getDate()} ${MESES[l.getMonth()].slice(0, 3)} – ${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)} ${f.getFullYear()}`; }
    return `${MESES[ancla.getMonth()]} ${ancla.getFullYear()}`;
  }, [vista, ancla]);

  function abrirNueva(fecha) {
    setModal({ nueva: true, fecha: ymd(fecha || ancla), tipo: "llamada", estado: "pendiente", todo_el_dia: false });
  }
  function abrirEditar(a) {
    setModal({ ...a, fecha: String(a.fecha).slice(0, 10) });
  }

  async function guardar(form) {
    try {
      if (form.id) {
        await api.put(`/actividades/${form.id}`, form);
        setToast({ type: "success", message: "Actividad actualizada." });
      } else {
        await api.post("/actividades", form);
        setToast({ type: "success", message: "Actividad registrada." });
      }
      setModal(null);
      cargar();
      if (esAdmin) { try { const u = await api.get("/actividades/usuarios"); setUsuarios(Array.isArray(u) ? u : []); } catch { /* */ } }
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar la actividad." });
    }
  }

  async function eliminar(a) {
    try {
      await api.delete(`/actividades/${a.id}`);
      setToast({ type: "success", message: "Actividad eliminada." });
      setConfirmDel(null);
      setModal(null);
      cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  async function alternarEstado(a) {
    const nuevo = a.estado === "realizada" ? "pendiente" : "realizada";
    // Optimista.
    setActividades((prev) => prev.map((x) => x.id === a.id ? { ...x, estado: nuevo } : x));
    try {
      await api.put(`/actividades/${a.id}`, { estado: nuevo });
    } catch {
      setActividades((prev) => prev.map((x) => x.id === a.id ? { ...x, estado: a.estado } : x));
      setToast({ type: "error", message: "No se pudo cambiar el estado." });
    }
  }

  const hoyDate = new Date(); hoyDate.setHours(0, 0, 0, 0);

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={confirmDel !== null}
        title="¿Eliminar esta actividad?"
        message="Se quitará de la bitácora de forma permanente."
        confirmText="Eliminar"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={() => eliminar(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Bitácora de actividades</h1>
          <p className="page-subtitle">Gestiones y actividades por cliente · {esAdmin ? "vista de administración" : "tu agenda"}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => abrirNueva()}>
          <Plus size={15} /> Nueva actividad
        </button>
      </div>

      {/* Barra de control: navegación + vistas */}
      <div className="surface" style={{ padding: 12, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navegar(-1)} title="Anterior"><ChevronLeft size={16} /></button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={hoy}>Hoy</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navegar(1)} title="Siguiente"><ChevronRight size={16} /></button>
          <strong style={{ fontSize: 15, marginLeft: 6, textTransform: "capitalize" }}>{tituloPeriodo}</strong>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--bg)", padding: 3, borderRadius: 8 }}>
          {[
            { v: "mes", label: "Mes", icon: CalendarDays },
            { v: "semana", label: "Semana", icon: CalendarRange },
            { v: "dia", label: "Día", icon: CalendarClock },
            { v: "agenda", label: "Agenda", icon: ListChecks },
          ].map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px",
                border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: vista === v ? "var(--surface)" : "transparent",
                color: vista === v ? "var(--primary-dark)" : "var(--text-muted)",
                boxShadow: vista === v ? "0 1px 2px rgba(0,0,0,.08)" : "none",
              }}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <div className="filter-field" style={{ minWidth: 180 }}>
          <label className="filter-label"><Filter size={11} style={{ marginRight: 4 }} />Tipo</label>
          <Combo
            value={filtroTipo}
            onChange={setFiltroTipo}
            isSearchable={false}
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...TIPOS.map((t) => ({ value: t.value, label: t.label }))]}
          />
        </div>
        <div className="filter-field" style={{ minWidth: 240 }}>
          <label className="filter-label">Cliente</label>
          <Combo
            value={filtroCliente}
            onChange={setFiltroCliente}
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...clienteOptions]}
          />
        </div>
        {esAdmin && (
          <div className="filter-field" style={{ minWidth: 220 }}>
            <label className="filter-label"><User size={11} style={{ marginRight: 4 }} />Usuario</label>
            <Combo
              value={filtroUsuario}
              onChange={setFiltroUsuario}
              placeholder="Todos"
              options={[{ value: "", label: "Todos" }, ...usuarios.map((u) => ({ value: u.email, label: u.nombre }))]}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginLeft: "auto", fontSize: 12.5, color: "var(--text-muted)" }}>
          <span><strong style={{ color: "var(--text)" }}>{kpis.total}</strong> actividades</span>
          <span><strong style={{ color: "#b45309" }}>{kpis.pendientes}</strong> pendientes</span>
          <span><strong style={{ color: "#16a34a" }}>{kpis.realizadas}</strong> realizadas</span>
        </div>
      </div>

      {/* Leyenda de tipos */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        {TIPOS.map((t) => (
          <span key={t.value} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color }} /> {t.label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando actividades…</div>
      ) : vista === "mes" ? (
        <VistaMes ancla={ancla} porFecha={porFecha} hoyDate={hoyDate} onNuevo={abrirNueva} onEditar={abrirEditar} />
      ) : vista === "semana" ? (
        <VistaSemana ancla={ancla} porFecha={porFecha} hoyDate={hoyDate} onNuevo={abrirNueva} onEditar={abrirEditar} />
      ) : vista === "dia" ? (
        <VistaDia ancla={ancla} porFecha={porFecha} onNuevo={abrirNueva} onEditar={abrirEditar} onToggle={alternarEstado} />
      ) : (
        <VistaAgenda actividades={actividades} onEditar={abrirEditar} onToggle={alternarEstado} esAdmin={esAdmin} />
      )}

      {modal && (
        <ModalActividad
          inicial={modal}
          clienteOptions={clienteOptions}
          onCancel={() => setModal(null)}
          onSave={guardar}
          onDelete={(a) => setConfirmDel(a)}
        />
      )}
    </div>
  );
}

/* ── Chip de actividad ────────────────────────────────────────────────── */
function Chip({ a, onClick, compact }) {
  const color = colorTipo(a.tipo);
  const hecha = a.estado === "realizada";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(a); }}
      title={`${labelTipo(a.tipo)}${a.hora_inicio ? ` · ${fmtHora(a.hora_inicio)}` : ""} · ${a.titulo}${a.cliente_nombre ? ` · ${a.cliente_nombre}` : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 5, width: "100%",
        background: `${color}14`, borderLeft: `3px solid ${color}`, border: "none",
        borderRadius: 5, padding: compact ? "2px 6px" : "4px 7px", cursor: "pointer",
        textAlign: "left", opacity: hecha ? 0.6 : 1,
      }}
    >
      {a.hora_inicio && !a.todo_el_dia && (
        <span style={{ fontSize: 10, fontWeight: 700, color, flexShrink: 0 }}>{fmtHora(a.hora_inicio)}</span>
      )}
      <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: hecha ? "line-through" : "none" }}>
        {a.titulo}
      </span>
    </button>
  );
}

/* ── Vista Mes ────────────────────────────────────────────────────────── */
function VistaMes({ ancla, porFecha, hoyDate, onNuevo, onEditar }) {
  const ini = lunesDe(new Date(ancla.getFullYear(), ancla.getMonth(), 1));
  const dias = Array.from({ length: 42 }, (_, i) => addDays(ini, i));
  return (
    <div className="surface" style={{ overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
        {DIAS.map((d) => (
          <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {dias.map((d, i) => {
          const key = ymd(d);
          const items = porFecha[key] || [];
          const otroMes = d.getMonth() !== ancla.getMonth();
          const esHoy = mismaFecha(d, hoyDate);
          return (
            <div
              key={i}
              onClick={() => onNuevo(d)}
              style={{
                minHeight: 104, borderRight: (i % 7 !== 6) ? "1px solid var(--border)" : "none",
                borderBottom: i < 35 ? "1px solid var(--border)" : "none",
                padding: 5, cursor: "pointer", background: otroMes ? "var(--bg)" : "var(--surface)",
                display: "flex", flexDirection: "column", gap: 3,
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, width: 22, height: 22, display: "grid", placeItems: "center",
                  borderRadius: "50%", color: esHoy ? "#fff" : otroMes ? "var(--text-muted)" : "var(--text)",
                  background: esHoy ? "var(--primary)" : "transparent",
                }}>{d.getDate()}</span>
              </div>
              {items.slice(0, 3).map((a) => <Chip key={a.id} a={a} compact onClick={onEditar} />)}
              {items.length > 3 && (
                <span style={{ fontSize: 10.5, color: "var(--text-muted)", paddingLeft: 4 }}>+{items.length - 3} más</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Vista Semana ─────────────────────────────────────────────────────── */
function VistaSemana({ ancla, porFecha, hoyDate, onNuevo, onEditar }) {
  const l = lunesDe(ancla);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(l, i));
  return (
    <div className="surface" style={{ overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
      {dias.map((d, i) => {
        const items = porFecha[ymd(d)] || [];
        const esHoy = mismaFecha(d, hoyDate);
        return (
          <div key={i} style={{ borderRight: i < 6 ? "1px solid var(--border)" : "none", minHeight: 360, display: "flex", flexDirection: "column" }}>
            <div onClick={() => onNuevo(d)} style={{ padding: "8px 6px", textAlign: "center", borderBottom: "1px solid var(--border)", cursor: "pointer", background: esHoy ? "var(--primary-light, #e6f7f7)" : "transparent" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{DIAS[i]}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: esHoy ? "var(--primary-dark)" : "var(--text)" }}>{d.getDate()}</div>
            </div>
            <div onClick={() => onNuevo(d)} style={{ flex: 1, padding: 5, display: "flex", flexDirection: "column", gap: 4, cursor: "pointer" }}>
              {items.map((a) => <Chip key={a.id} a={a} onClick={onEditar} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Vista Día ────────────────────────────────────────────────────────── */
function VistaDia({ ancla, porFecha, onNuevo, onEditar, onToggle }) {
  const items = porFecha[ymd(ancla)] || [];
  return (
    <div className="surface" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 className="surface-title" style={{ margin: 0, textTransform: "capitalize" }}>{fmtFechaLarga(ancla)}</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNuevo(ancla)}><Plus size={13} /> Agregar</button>
      </div>
      {items.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>Sin actividades este día.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((a) => <FilaActividad key={a.id} a={a} onEditar={onEditar} onToggle={onToggle} />)}
        </div>
      )}
    </div>
  );
}

/* ── Vista Agenda (lista agrupada por día) ────────────────────────────── */
function VistaAgenda({ actividades, onEditar, onToggle, esAdmin }) {
  const grupos = useMemo(() => {
    const m = {};
    actividades.forEach((a) => { const k = String(a.fecha).slice(0, 10); (m[k] = m[k] || []).push(a); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [actividades]);
  if (grupos.length === 0) {
    return <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)", textAlign: "center" }}>No hay actividades en el periodo.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {grupos.map(([fecha, items]) => (
        <div key={fecha} className="surface" style={{ padding: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--primary-dark)", marginBottom: 10, textTransform: "capitalize" }}>
            {fmtFechaLarga(parseYMD(fecha))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((a) => <FilaActividad key={a.id} a={a} onEditar={onEditar} onToggle={onToggle} mostrarUsuario={esAdmin} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Fila detallada de actividad (día / agenda) ───────────────────────── */
function FilaActividad({ a, onEditar, onToggle, mostrarUsuario }) {
  const color = colorTipo(a.tipo);
  const hecha = a.estado === "realizada";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, borderLeft: `4px solid ${color}`, background: "var(--surface)" }}>
      <button
        type="button"
        onClick={() => onToggle(a)}
        title={hecha ? "Marcar pendiente" : "Marcar realizada"}
        style={{ marginTop: 2, width: 20, height: 20, borderRadius: "50%", border: `2px solid ${hecha ? "#16a34a" : "var(--border)"}`, background: hecha ? "#16a34a" : "transparent", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}
      >
        {hecha && <Check size={12} color="#fff" />}
      </button>
      <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onEditar(a)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color, background: `${color}18`, padding: "1px 7px", borderRadius: 999 }}>{labelTipo(a.tipo)}</span>
          {!a.todo_el_dia && a.hora_inicio && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: "var(--text-muted)" }}>
              <Clock size={11} /> {fmtHora(a.hora_inicio)}{a.hora_fin ? `–${fmtHora(a.hora_fin)}` : ""}
            </span>
          )}
          {a.todo_el_dia && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Todo el día</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginTop: 3, textDecoration: hecha ? "line-through" : "none" }}>{a.titulo}</div>
        {a.cliente_nombre && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>👤 {a.cliente_nombre}</div>}
        {a.comentario && <div style={{ fontSize: 12.5, color: "var(--text-soft, #64748b)", marginTop: 4, whiteSpace: "pre-wrap" }}>{a.comentario}</div>}
        {Array.isArray(a.adjuntos) && a.adjuntos.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
            {a.adjuntos.map((ad, i) => {
              const esImg = /^image\//.test(ad.mime || "") || /\.(png|jpe?g|gif|webp)$/i.test(ad.url || "");
              return esImg ? (
                <a key={i} href={ad.url} target="_blank" rel="noopener noreferrer" title={ad.nombre}>
                  <img src={ad.url} alt={ad.nombre} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                </a>
              ) : (
                <a key={i} href={ad.url} target="_blank" rel="noopener noreferrer" title={ad.nombre} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--primary-dark)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", background: "var(--bg)" }}>
                  <Paperclip size={11} /> {(ad.nombre || "Adjunto").slice(0, 24)}
                </a>
              );
            })}
          </div>
        )}
        {mostrarUsuario && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Registrada por {a.user_nombre || a.user_email}</div>}
      </div>
    </div>
  );
}

/* ── Modal crear / editar actividad ───────────────────────────────────── */
function ModalActividad({ inicial, clienteOptions, onCancel, onSave, onDelete }) {
  const [titulo, setTitulo] = useState(inicial.titulo || "");
  const [tipo, setTipo] = useState(inicial.tipo || "gestion");
  const [clienteId, setClienteId] = useState(inicial.cliente_id ?? null);
  const [fecha, setFecha] = useState(inicial.fecha || ymd(new Date()));
  const [todoDia, setTodoDia] = useState(Boolean(inicial.todo_el_dia));
  const [horaIni, setHoraIni] = useState(inicial.hora_inicio ? String(inicial.hora_inicio).slice(0, 5) : "");
  const [horaFin, setHoraFin] = useState(inicial.hora_fin ? String(inicial.hora_fin).slice(0, 5) : "");
  const [comentario, setComentario] = useState(inicial.comentario || "");
  const [estado, setEstado] = useState(inicial.estado || "pendiente");
  const [adjuntos, setAdjuntos] = useState(Array.isArray(inicial.adjuntos) ? inicial.adjuntos : []);
  const [subiendo, setSubiendo] = useState(false);
  const [errorAdj, setErrorAdj] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function onFiles(files) {
    if (!files?.length) return;
    setSubiendo(true);
    setErrorAdj("");
    try {
      const nuevos = [];
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const path = `actividades/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from(ACTIVIDADES_BUCKET).upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (error) throw error;
        const { data } = supabase.storage.from(ACTIVIDADES_BUCKET).getPublicUrl(path);
        nuevos.push({ url: data.publicUrl, nombre: file.name, mime: file.type || "" });
      }
      setAdjuntos((prev) => [...prev, ...nuevos]);
    } catch (e) {
      setErrorAdj(e?.message || "No se pudo subir el archivo.");
    } finally {
      setSubiendo(false);
    }
  }

  const clienteSel = clienteOptions.find((c) => String(c.value) === String(clienteId)) || null;

  async function submit(e) {
    e.preventDefault();
    if (!titulo.trim()) return;
    if (!clienteSel) return;
    setGuardando(true);
    const form = {
      id: inicial.id,
      titulo: titulo.trim(),
      tipo,
      cliente_id: clienteSel.value,
      cliente_nombre: clienteSel.nombre,
      fecha,
      todo_el_dia: todoDia,
      hora_inicio: todoDia ? null : (horaIni || null),
      hora_fin: todoDia ? null : (horaFin || null),
      comentario: comentario.trim(),
      estado,
      adjuntos,
    };
    await onSave(form);
    setGuardando(false);
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <form onSubmit={submit} style={{ width: 480, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 16 }}>{inicial.id ? "Editar actividad" : "Nueva actividad"}</strong>
          <button type="button" onClick={onCancel} className="btn btn-ghost" style={{ padding: 6 }}><X size={18} /></button>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label className="field-label">Título <span style={{ color: "var(--danger)" }}>*</span></label>
            <input type="text" className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Llamada de seguimiento" autoFocus />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">Tipo</label>
              <Combo
                value={tipo}
                onChange={(v) => setTipo(v || "otro")}
                isSearchable={false}
                options={TIPOS.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>
            <div className="field">
              <label className="field-label">Estado</label>
              <Combo
                value={estado}
                onChange={(v) => setEstado(v || "pendiente")}
                isSearchable={false}
                options={[{ value: "pendiente", label: "Pendiente" }, { value: "realizada", label: "Realizada" }]}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">Cliente <span style={{ color: "var(--danger)" }}>*</span></label>
            <Combo
              value={clienteId ?? ""}
              onChange={(v) => setClienteId(v || null)}
              placeholder="Selecciona un cliente…"
              options={clienteOptions}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: todoDia ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">Fecha <span style={{ color: "var(--danger)" }}>*</span></label>
              <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            {!todoDia && (
              <>
                <div className="field">
                  <label className="field-label">Desde</label>
                  <input type="time" className="input" value={horaIni} onChange={(e) => setHoraIni(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Hasta</label>
                  <input type="time" className="input" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-soft)", fontWeight: 500, cursor: "pointer" }}>
            <input type="checkbox" checked={todoDia} onChange={(e) => setTodoDia(e.target.checked)} />
            Todo el día
          </label>

          <div className="field">
            <label className="field-label">Comentario</label>
            <textarea className="input" value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3} placeholder="Detalle de la gestión, acuerdos, próximos pasos…" style={{ resize: "vertical", fontFamily: "inherit", height: "auto", paddingTop: 8, paddingBottom: 8 }} />
          </div>

          <div className="field">
            <label className="field-label">Adjuntos (archivos / fotos)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label className="btn btn-secondary btn-sm" style={{ cursor: subiendo ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Paperclip size={13} /> {subiendo ? "Subiendo…" : "Adjuntar"}
                <input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} disabled={subiendo} />
              </label>
              {adjuntos.length === 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin adjuntos</span>}
            </div>
            {errorAdj && <div style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 4 }}>{errorAdj}</div>}
            {adjuntos.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {adjuntos.map((ad, i) => {
                  const esImg = /^image\//.test(ad.mime || "") || /\.(png|jpe?g|gif|webp)$/i.test(ad.url || "");
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
                      {esImg ? (
                        <a href={ad.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                          <img src={ad.url} alt={ad.nombre} style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 5 }} />
                        </a>
                      ) : (
                        <FileText size={18} style={{ color: "var(--primary)", flexShrink: 0 }} />
                      )}
                      <a href={ad.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12.5, fontWeight: 400, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ad.nombre}>
                        {ad.nombre || "Adjunto"}
                      </a>
                      <button type="button" onClick={() => setAdjuntos((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }} title="Quitar">
                        <X size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          {inicial.id ? (
            <button type="button" onClick={() => onDelete(inicial)} className="btn btn-ghost" style={{ color: "#dc2626", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Trash2 size={14} /> Eliminar
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onCancel} className="btn btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando || !titulo.trim() || !clienteSel} className="btn btn-primary">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
