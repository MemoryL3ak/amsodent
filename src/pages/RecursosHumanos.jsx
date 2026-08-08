import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users, FileText, Wallet, CalendarClock, ClipboardCheck, PlaneTakeoff, LayoutDashboard,
  Plus, Search, Pencil, Trash2, X, Upload, Eye, Download, CheckCircle2, AlertTriangle,
  Cake, TrendingUp, Clock, PenLine, RefreshCw, ChevronRight, ChevronDown,
} from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import FirmaDigital from "../components/FirmaDigital";

/* ============================================================================
   Recursos Humanos — panel de administración
   ----------------------------------------------------------------------------
   Tablero · Trabajadores (ficha completa) · Contratos · Liquidaciones de
   sueldo · Asistencia (sobre los marcajes) · Evaluaciones · Solicitudes.
   Solo admin: la ruta usa RequireRole y el backend AdminGuard.
============================================================================ */

const fmtCLP = (v) => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;
const fmtFecha = (v) => {
  if (!v) return "—";
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
};
const periodoActual = () => new Date().toISOString().slice(0, 7);
const nombreCompleto = (e) => `${e?.nombre || ""} ${e?.apellidos || ""}`.trim() || "—";

const TABS = [
  { key: "tablero", label: "Tablero", icon: LayoutDashboard },
  { key: "trabajadores", label: "Trabajadores", icon: Users },
  { key: "contratos", label: "Contratos", icon: FileText },
  { key: "liquidaciones", label: "Liquidaciones", icon: Wallet },
  { key: "asistencia", label: "Asistencia", icon: CalendarClock },
  { key: "evaluaciones", label: "Evaluaciones", icon: ClipboardCheck },
  { key: "solicitudes", label: "Solicitudes", icon: PlaneTakeoff },
];

const TIPOS_CONTRATO = ["indefinido", "plazo_fijo", "part_time", "honorarios", "reemplazo"];
const AFPS = ["Capital", "Cuprum", "Habitat", "Modelo", "PlanVital", "ProVida", "Uno"];
const TASAS_AFP = { Capital: 11.44, Cuprum: 11.44, Habitat: 11.27, Modelo: 10.58, PlanVital: 11.16, ProVida: 11.45, Uno: 10.69 };
const TIPOS_SOLICITUD = ["vacaciones", "permiso", "licencia_medica", "administrativo", "sin_goce"];
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const COMPETENCIAS_BASE = [
  "Calidad del trabajo",
  "Cumplimiento de plazos",
  "Trabajo en equipo",
  "Comunicación",
  "Iniciativa y autonomía",
  "Compromiso y actitud",
];

const ESTADO_TONO = {
  activo: { bg: "#dcfce7", color: "#15803d" },
  inactivo: { bg: "#f1f5f9", color: "#64748b" },
  finiquitado: { bg: "#fee2e2", color: "#b91c1c" },
  borrador: { bg: "#f1f5f9", color: "#64748b" },
  enviado: { bg: "#fef3c7", color: "#b45309" },
  emitida: { bg: "#dbeafe", color: "#1d4ed8" },
  firmado: { bg: "#dcfce7", color: "#15803d" },
  firmada: { bg: "#dcfce7", color: "#15803d" },
  pagada: { bg: "#dcfce7", color: "#15803d" },
  pendiente: { bg: "#fef3c7", color: "#b45309" },
  aprobada: { bg: "#dcfce7", color: "#15803d" },
  rechazada: { bg: "#fee2e2", color: "#b91c1c" },
  anulada: { bg: "#f1f5f9", color: "#64748b" },
  vencido: { bg: "#fee2e2", color: "#b91c1c" },
};

function Pill({ estado }) {
  const t = ESTADO_TONO[estado] || { bg: "#f1f5f9", color: "#64748b" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.color, whiteSpace: "nowrap" }}>
      {String(estado || "—").replace(/_/g, " ")}
    </span>
  );
}

function Kpi({ icon, tono, fondo, label, valor, sub }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "13px 15px", display: "flex", gap: 12, alignItems: "center" }}>
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

// Modal genérico centrado.
function Modal({ titulo, ancho = 720, onClose, children, footer }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 14, width: `min(${ancho}px, 100%)`, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px -12px rgba(15,23,42,.4)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{titulo}</div>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6, lineHeight: 0 }}><X size={17} /></button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

// Campo de formulario con etiqueta.
function Campo({ label, children, ancho }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, gridColumn: ancho ? `span ${ancho}` : undefined }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>{label}</label>
      {children}
    </div>
  );
}

const gridForm = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };

export default function RecursosHumanos() {
  const [tab, setTab] = useState("tablero");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [empleados, setEmpleados] = useState([]);
  const [tablero, setTablero] = useState(null);
  const [migracionFalta, setMigracionFalta] = useState(false);

  const cargarBase = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, tab] = await Promise.all([
        api.get("/rrhh/empleados"),
        api.get("/rrhh/tablero"),
      ]);
      setEmpleados(Array.isArray(emps) ? emps : []);
      setTablero(tab || null);
      setMigracionFalta(false);
    } catch (e) {
      if (/migración/i.test(e?.message || "")) setMigracionFalta(true);
      else setToast({ type: "error", message: e?.message || "No se pudo cargar Recursos Humanos." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarBase(); }, [cargarBase]);

  const empleadosPorId = useMemo(
    () => new Map(empleados.map((e) => [Number(e.id), e])),
    [empleados],
  );

  const props = { empleados, empleadosPorId, setToast, recargar: cargarBase };

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={22} style={{ color: "var(--primary)" }} />
            Recursos Humanos
          </h1>
          <p className="page-subtitle">
            Fichas del personal, contratos, liquidaciones de sueldo, asistencia, evaluaciones y solicitudes
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={cargarBase} disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <RefreshCw size={14} className={loading ? "rrhh-girando" : undefined} /> Actualizar
          </button>
        </div>
      </div>

      {migracionFalta && (
        <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={18} style={{ color: "#b45309", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            <b>Falta aplicar la migración del módulo.</b><br />
            Ejecuta <code>supabase/migrations/20260808_rrhh.sql</code> en el editor SQL de Supabase y vuelve a cargar
            esta página. Crea las tablas del módulo y el bucket privado <code>rrhh</code> para los documentos.
          </div>
        </div>
      )}

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9,
              border: "1px solid " + (tab === key ? "transparent" : "var(--border)"),
              background: tab === key ? "var(--primary)" : "var(--surface)",
              color: tab === key ? "#fff" : "var(--text-muted)",
              fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {loading && !tablero ? (
        <Vacio texto="Cargando módulo de Recursos Humanos…" />
      ) : (
        <>
          {tab === "tablero" && <TabTablero tablero={tablero} {...props} />}
          {tab === "trabajadores" && <TabTrabajadores {...props} />}
          {tab === "contratos" && <TabContratos {...props} />}
          {tab === "liquidaciones" && <TabLiquidaciones {...props} />}
          {tab === "asistencia" && <TabAsistencia {...props} />}
          {tab === "evaluaciones" && <TabEvaluaciones {...props} />}
          {tab === "solicitudes" && <TabSolicitudes {...props} />}
        </>
      )}

      <style>{`
        .rrhh-girando { animation: rrhh-spin 1s linear infinite; }
        @keyframes rrhh-spin { to { transform: rotate(360deg); } }
        .rrhh-tabla-wrap { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); max-height: 64vh; overflow: auto; }
        .rrhh-tabla { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
        .rrhh-tabla thead th {
          position: sticky; top: 0; z-index: 2; background: var(--bg); color: var(--text-muted);
          text-align: left; padding: 9px 12px; font-weight: 600; white-space: nowrap;
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .rrhh-tabla tbody td { padding: 8px 12px; border-top: 1px solid var(--border); }
        .rrhh-tabla tbody tr:hover > td { background: color-mix(in srgb, var(--primary, #1e9295) 5%, transparent); }
      `}</style>
    </div>
  );
}

/* ========================================================================== */
/* TABLERO                                                                     */
/* ========================================================================== */
function TabTablero({ tablero }) {
  if (!tablero) return <Vacio texto="Sin datos todavía. Crea la primera ficha en «Trabajadores»." />;
  const { dotacion, nomina, pendientes, contratos_por_vencer, cumpleanos_mes, ausentismo } = tablero;

  const maxArea = Math.max(1, ...(dotacion.por_area || []).map((a) => a.total));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Kpi icon={<Users size={17} />} tono="#1e9295" fondo="#e6f6f6" label="Dotación activa"
          valor={dotacion.activos} sub={`${dotacion.total} fichas en total`} />
        <Kpi icon={<Wallet size={17} />} tono="#15803d" fondo="#dcfce7" label="Costo mensual"
          valor={fmtCLP(nomina.costo_mensual)} sub={`Promedio ${fmtCLP(nomina.sueldo_promedio)}`} />
        <Kpi icon={<TrendingUp size={17} />} tono="#6d28d9" fondo="#ede9fe" label="Antigüedad media"
          valor={dotacion.antiguedad_promedio_anios != null ? `${dotacion.antiguedad_promedio_anios} años` : "—"}
          sub="de los trabajadores activos" />
        <Kpi icon={<PlaneTakeoff size={17} />} tono="#b45309" fondo="#fef3c7" label="Solicitudes pendientes"
          valor={pendientes.solicitudes} sub={`${ausentismo.total_dias} días de ausencia en ${ausentismo.anio}`} />
        <Kpi icon={<AlertTriangle size={17} />} tono="#b91c1c" fondo="#fee2e2" label="Contratos por vencer"
          valor={pendientes.contratos_por_vencer} sub="en los próximos 30 días" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <Panel titulo="Dotación por área">
          {(dotacion.por_area || []).length === 0 ? <Vacio texto="Sin áreas definidas." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dotacion.por_area.map((a) => (
                <div key={a.nombre}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span>{a.nombre}</span><b>{a.total}</b>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "var(--bg)", overflow: "hidden" }}>
                    <div style={{ width: `${(a.total / maxArea) * 100}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #1e929599, #1e9295)" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo="Tipo de contrato">
          {(dotacion.por_tipo_contrato || []).length === 0 ? <Vacio texto="Sin datos." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {dotacion.por_tipo_contrato.map((t) => (
                <div key={t.nombre} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ textTransform: "capitalize" }}>{String(t.nombre).replace(/_/g, " ")}</span>
                  <b>{t.total}</b>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo="Contratos por vencer" sub="plazo fijo con término dentro de 30 días">
          {(contratos_por_vencer || []).length === 0 ? <Vacio texto="Ninguno por vencer. 👌" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {contratos_por_vencer.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>{c.nombre}</span>
                  <b style={{ color: "#b91c1c" }}>{fmtFecha(c.fecha_termino)}</b>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo="Cumpleaños del mes" sub="para no quedar mal 🎂">
          {(cumpleanos_mes || []).length === 0 ? <Vacio texto="Nadie cumple años este mes." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {cumpleanos_mes.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <Cake size={13} style={{ color: "#db2777" }} />
                  <span style={{ flex: 1 }}>{c.nombre}</span>
                  <b>día {c.dia}</b>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo={`Ausentismo ${ausentismo.anio}`} sub="días aprobados por tipo">
          {(ausentismo.por_tipo || []).length === 0 ? <Vacio texto="Sin ausencias registradas." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {ausentismo.por_tipo.map((t) => (
                <div key={t.tipo} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ textTransform: "capitalize" }}>{String(t.tipo).replace(/_/g, " ")}</span>
                  <span><b>{t.dias}</b> días <span style={{ color: "var(--text-muted)" }}>({t.casos} casos)</span></span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel titulo="Pendientes de gestión">
          <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5 }}>
            {[
              ["Solicitudes por resolver", pendientes.solicitudes],
              ["Contratos enviados sin firmar", pendientes.contratos_sin_firmar],
              ["Evaluaciones en borrador", pendientes.evaluaciones_borrador],
              ["Contratos por vencer", pendientes.contratos_por_vencer],
            ].map(([label, valor]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{label}</span>
                <b style={{ color: valor > 0 ? "#b45309" : "#15803d" }}>{valor}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* TRABAJADORES                                                                */
/* ========================================================================== */
const EMPLEADO_VACIO = {
  nombre: "", apellidos: "", rut: "", email: "", telefono: "", direccion: "", comuna: "",
  fecha_nacimiento: "", cargo: "", area: "", jefatura_email: "", fecha_ingreso: "", fecha_egreso: "",
  tipo_contrato: "indefinido", jornada: "completa", horas_semanales: 45, sueldo_base: "",
  gratificacion_legal: true, colacion: "", movilizacion: "", afp: "", tasa_afp: "", salud: "Fonasa",
  plan_salud_uf: "", banco: "", tipo_cuenta: "", numero_cuenta: "", contacto_emergencia: "",
  telefono_emergencia: "", dias_vacaciones_iniciales: 0, estado: "activo", notas: "",
};

function TabTrabajadores({ empleados, setToast, recargar }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [editando, setEditando] = useState(null); // objeto empleado o EMPLEADO_VACIO
  const [guardando, setGuardando] = useState(false);
  const [detalle, setDetalle] = useState(null); // ficha completa
  const [confirmarBorrar, setConfirmarBorrar] = useState(null);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return empleados.filter((e) => {
      if (filtroEstado && e.estado !== filtroEstado) return false;
      if (!q) return true;
      return [e.nombre, e.apellidos, e.rut, e.email, e.cargo, e.area]
        .map((s) => String(s || "").toLowerCase()).some((s) => s.includes(q));
    });
  }, [empleados, busqueda, filtroEstado]);

  async function guardar() {
    if (!editando?.nombre?.trim()) {
      setToast({ type: "error", message: "El nombre es obligatorio." });
      return;
    }
    setGuardando(true);
    try {
      if (editando.id) await api.put(`/rrhh/empleados/${editando.id}`, editando);
      else await api.post("/rrhh/empleados", editando);
      setToast({ type: "success", message: "Ficha guardada." });
      setEditando(null);
      await recargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar la ficha." });
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(emp) {
    try {
      await api.delete(`/rrhh/empleados/${emp.id}`);
      setToast({ type: "success", message: "Ficha eliminada." });
      setConfirmarBorrar(null);
      await recargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  async function abrirDetalle(id) {
    try {
      const ficha = await api.get(`/rrhh/empleados/${id}`);
      setDetalle(ficha);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo abrir la ficha." });
    }
  }

  const set = (campo, valor) => setEditando((p) => ({ ...p, [campo]: valor }));

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 1, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 30 }} placeholder="Nombre, RUT, cargo, área…"
              value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={{ minWidth: 150 }}>
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="inactivo">Inactivos</option>
            <option value="finiquitado">Finiquitados</option>
          </select>
        </div>
        <div className="filter-field" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={() => setEditando({ ...EMPLEADO_VACIO })}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38 }}>
            <Plus size={15} /> Nuevo trabajador
          </button>
        </div>
      </div>

      <div className="rrhh-tabla-wrap" style={{ marginTop: 12 }}>
        <table className="rrhh-tabla">
          <thead>
            <tr>
              <th>Trabajador</th><th>RUT</th><th>Cargo</th><th>Área</th>
              <th>Ingreso</th><th style={{ textAlign: "right" }}>Sueldo base</th>
              <th>Contrato</th><th>Estado</th><th style={{ width: 110 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                {empleados.length === 0 ? "Sin trabajadores registrados. Crea la primera ficha." : "Sin resultados con esos filtros."}
              </td></tr>
            ) : filtrados.map((e) => (
              <tr key={e.id}>
                <td>
                  <button onClick={() => abrirDetalle(e.id)} className="table-link"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: "var(--primary-dark)", textAlign: "left" }}>
                    {nombreCompleto(e)}
                  </button>
                  {e.email && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.email}</div>}
                </td>
                <td>{e.rut || "—"}</td>
                <td>{e.cargo || "—"}</td>
                <td>{e.area || "—"}</td>
                <td>{fmtFecha(e.fecha_ingreso)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtCLP(e.sueldo_base)}</td>
                <td style={{ textTransform: "capitalize" }}>{String(e.tipo_contrato || "—").replace(/_/g, " ")}</td>
                <td><Pill estado={e.estado} /></td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost" title="Editar" onClick={() => setEditando({ ...e })} style={{ padding: 6, lineHeight: 0 }}><Pencil size={14} /></button>
                    <button className="btn btn-ghost" title="Ver ficha" onClick={() => abrirDetalle(e.id)} style={{ padding: 6, lineHeight: 0 }}><Eye size={14} /></button>
                    <button className="btn btn-ghost" title="Eliminar" onClick={() => setConfirmarBorrar(e)} style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Formulario de ficha */}
      {editando && (
        <Modal
          titulo={editando.id ? `Editar ficha · ${nombreCompleto(editando)}` : "Nuevo trabajador"}
          ancho={860}
          onClose={() => setEditando(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar ficha"}</button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--primary-dark)" }}>Datos personales</div>
              <div style={gridForm}>
                <Campo label="Nombre *"><input className="input" value={editando.nombre || ""} onChange={(e) => set("nombre", e.target.value)} /></Campo>
                <Campo label="Apellidos"><input className="input" value={editando.apellidos || ""} onChange={(e) => set("apellidos", e.target.value)} /></Campo>
                <Campo label="RUT"><input className="input" value={editando.rut || ""} onChange={(e) => set("rut", e.target.value)} placeholder="12.345.678-9" /></Campo>
                <Campo label="Correo (acceso al portal)"><input className="input" type="email" value={editando.email || ""} onChange={(e) => set("email", e.target.value)} /></Campo>
                <Campo label="Teléfono"><input className="input" value={editando.telefono || ""} onChange={(e) => set("telefono", e.target.value)} /></Campo>
                <Campo label="Fecha de nacimiento"><input className="input" type="date" value={(editando.fecha_nacimiento || "").slice(0, 10)} onChange={(e) => set("fecha_nacimiento", e.target.value)} /></Campo>
                <Campo label="Dirección" ancho={2}><input className="input" value={editando.direccion || ""} onChange={(e) => set("direccion", e.target.value)} /></Campo>
                <Campo label="Comuna"><input className="input" value={editando.comuna || ""} onChange={(e) => set("comuna", e.target.value)} /></Campo>
              </div>
            </section>

            <section>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--primary-dark)" }}>Datos laborales</div>
              <div style={gridForm}>
                <Campo label="Cargo"><input className="input" value={editando.cargo || ""} onChange={(e) => set("cargo", e.target.value)} /></Campo>
                <Campo label="Área"><input className="input" value={editando.area || ""} onChange={(e) => set("area", e.target.value)} placeholder="Ventas, Logística…" /></Campo>
                <Campo label="Jefatura (correo)"><input className="input" type="email" value={editando.jefatura_email || ""} onChange={(e) => set("jefatura_email", e.target.value)} /></Campo>
                <Campo label="Fecha de ingreso"><input className="input" type="date" value={(editando.fecha_ingreso || "").slice(0, 10)} onChange={(e) => set("fecha_ingreso", e.target.value)} /></Campo>
                <Campo label="Fecha de egreso"><input className="input" type="date" value={(editando.fecha_egreso || "").slice(0, 10)} onChange={(e) => set("fecha_egreso", e.target.value)} /></Campo>
                <Campo label="Tipo de contrato">
                  <select className="input" value={editando.tipo_contrato || ""} onChange={(e) => set("tipo_contrato", e.target.value)}>
                    {TIPOS_CONTRATO.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </Campo>
                <Campo label="Jornada">
                  <select className="input" value={editando.jornada || ""} onChange={(e) => set("jornada", e.target.value)}>
                    <option value="completa">Completa</option><option value="parcial">Parcial</option><option value="turnos">Por turnos</option>
                  </select>
                </Campo>
                <Campo label="Horas semanales"><input className="input" type="number" value={editando.horas_semanales ?? ""} onChange={(e) => set("horas_semanales", e.target.value)} /></Campo>
                <Campo label="Estado">
                  <select className="input" value={editando.estado || "activo"} onChange={(e) => set("estado", e.target.value)}>
                    <option value="activo">Activo</option><option value="inactivo">Inactivo</option><option value="finiquitado">Finiquitado</option>
                  </select>
                </Campo>
              </div>
            </section>

            <section>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--primary-dark)" }}>Remuneración y previsión</div>
              <div style={gridForm}>
                <Campo label="Sueldo base"><input className="input" inputMode="numeric" value={editando.sueldo_base ?? ""} onChange={(e) => set("sueldo_base", e.target.value.replace(/[^\d]/g, ""))} /></Campo>
                <Campo label="Colación (no imponible)"><input className="input" inputMode="numeric" value={editando.colacion ?? ""} onChange={(e) => set("colacion", e.target.value.replace(/[^\d]/g, ""))} /></Campo>
                <Campo label="Movilización (no imponible)"><input className="input" inputMode="numeric" value={editando.movilizacion ?? ""} onChange={(e) => set("movilizacion", e.target.value.replace(/[^\d]/g, ""))} /></Campo>
                <Campo label="AFP">
                  <select className="input" value={editando.afp || ""} onChange={(e) => { set("afp", e.target.value); set("tasa_afp", TASAS_AFP[e.target.value] ?? ""); }}>
                    <option value="">Sin definir</option>
                    {AFPS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Campo>
                <Campo label="Tasa AFP %"><input className="input" type="number" step="0.01" value={editando.tasa_afp ?? ""} onChange={(e) => set("tasa_afp", e.target.value)} /></Campo>
                <Campo label="Salud"><input className="input" value={editando.salud || ""} onChange={(e) => set("salud", e.target.value)} placeholder="Fonasa / Isapre Colmena" /></Campo>
                <Campo label="Plan isapre (UF)"><input className="input" type="number" step="0.01" value={editando.plan_salud_uf ?? ""} onChange={(e) => set("plan_salud_uf", e.target.value)} /></Campo>
                <Campo label="Vacaciones arrastradas (días)"><input className="input" type="number" step="0.5" value={editando.dias_vacaciones_iniciales ?? 0} onChange={(e) => set("dias_vacaciones_iniciales", e.target.value)} /></Campo>
                <Campo label="Gratificación legal">
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, height: 38 }}>
                    <input type="checkbox" checked={editando.gratificacion_legal !== false} onChange={(e) => set("gratificacion_legal", e.target.checked)} />
                    Aplica 25% con tope legal
                  </label>
                </Campo>
              </div>
            </section>

            <section>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--primary-dark)" }}>Pago y emergencia</div>
              <div style={gridForm}>
                <Campo label="Banco"><input className="input" value={editando.banco || ""} onChange={(e) => set("banco", e.target.value)} /></Campo>
                <Campo label="Tipo de cuenta"><input className="input" value={editando.tipo_cuenta || ""} onChange={(e) => set("tipo_cuenta", e.target.value)} placeholder="Corriente / Vista" /></Campo>
                <Campo label="N° de cuenta"><input className="input" value={editando.numero_cuenta || ""} onChange={(e) => set("numero_cuenta", e.target.value)} /></Campo>
                <Campo label="Contacto de emergencia"><input className="input" value={editando.contacto_emergencia || ""} onChange={(e) => set("contacto_emergencia", e.target.value)} /></Campo>
                <Campo label="Teléfono de emergencia"><input className="input" value={editando.telefono_emergencia || ""} onChange={(e) => set("telefono_emergencia", e.target.value)} /></Campo>
              </div>
              <div style={{ marginTop: 12 }}>
                <Campo label="Notas internas">
                  <textarea className="input" rows={3} value={editando.notas || ""} onChange={(e) => set("notas", e.target.value)} />
                </Campo>
              </div>
            </section>
          </div>
        </Modal>
      )}

      {detalle && <FichaDetalle ficha={detalle} onClose={() => setDetalle(null)} setToast={setToast}
        onRecargar={async (id) => { const f = await api.get(`/rrhh/empleados/${id}`); setDetalle(f); await recargar(); }} />}

      {confirmarBorrar && (
        <Modal titulo="Eliminar ficha" ancho={460} onClose={() => setConfirmarBorrar(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setConfirmarBorrar(null)}>Cancelar</button>
            <button className="btn btn-primary" style={{ background: "#b91c1c", borderColor: "#b91c1c" }} onClick={() => borrar(confirmarBorrar)}>Eliminar</button>
          </>}>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
            Se eliminará la ficha de <b>{nombreCompleto(confirmarBorrar)}</b> junto con sus contratos,
            liquidaciones, evaluaciones, solicitudes y documentos. Esta acción no se puede deshacer.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ── Ficha detallada del trabajador ─────────────────────────────────────── */
function FichaDetalle({ ficha, onClose, setToast, onRecargar }) {
  const { empleado, contratos, liquidaciones, evaluaciones, solicitudes, documentos, vacaciones, antiguedad, jornadas } = ficha;
  const [seccion, setSeccion] = useState("resumen");
  const [jorn, setJorn] = useState(() => {
    const base = {};
    for (let d = 0; d <= 6; d++) {
      const j = (jornadas || []).find((x) => Number(x.dia_semana) === d);
      base[d] = { hora_entrada: j?.hora_entrada?.slice(0, 5) || "", hora_salida: j?.hora_salida?.slice(0, 5) || "", colacion_minutos: j?.colacion_minutos ?? 60 };
    }
    return base;
  });
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef(null);

  async function guardarJornadas() {
    try {
      const payload = Object.entries(jorn)
        .filter(([, v]) => v.hora_entrada || v.hora_salida)
        .map(([dia, v]) => ({ dia_semana: Number(dia), ...v }));
      await api.put(`/rrhh/empleados/${empleado.id}/jornadas`, { jornadas: payload });
      setToast({ type: "success", message: "Jornada guardada." });
      await onRecargar(empleado.id);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar la jornada." });
    }
  }

  async function subirDocumento(file) {
    if (!file) return;
    setSubiendo(true);
    try {
      const nombre = `${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const path = `${empleado.id}/documentos/${nombre}`;
      const fd = new FormData();
      fd.append("file", file);
      await api.postForm(`/rrhh/storage/upload?path=${encodeURIComponent(path)}`, fd);
      await api.post("/rrhh/documentos", {
        empleado_id: empleado.id, tipo: "otro", titulo: file.name,
        bucket: "rrhh", storage_path: path, file_name: file.name,
        mime_type: file.type, size_bytes: file.size,
      });
      setToast({ type: "success", message: "Documento cargado." });
      await onRecargar(empleado.id);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo subir el documento." });
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function abrirArchivo(doc) {
    try {
      const { url } = await api.get(`/rrhh/storage/signed-url?bucket=${encodeURIComponent(doc.bucket || "rrhh")}&path=${encodeURIComponent(doc.storage_path)}`);
      if (url) window.open(url, "_blank", "noopener");
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo abrir el archivo." });
    }
  }

  const SECCIONES = [
    ["resumen", "Resumen"], ["contratos", `Contratos (${contratos.length})`],
    ["liquidaciones", `Liquidaciones (${liquidaciones.length})`], ["evaluaciones", `Evaluaciones (${evaluaciones.length})`],
    ["solicitudes", `Solicitudes (${solicitudes.length})`], ["documentos", `Documentos (${documentos.length})`],
    ["jornada", "Jornada"],
  ];

  return (
    <Modal titulo={`Ficha · ${nombreCompleto(empleado)}`} ancho={900} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {SECCIONES.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSeccion(k)}
            style={{
              padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: "1px solid " + (seccion === k ? "transparent" : "var(--border)"),
              background: seccion === k ? "var(--primary)" : "var(--surface)",
              color: seccion === k ? "#fff" : "var(--text-muted)",
            }}>{label}</button>
        ))}
      </div>

      {seccion === "resumen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Kpi icon={<Clock size={16} />} tono="#1e9295" fondo="#e6f6f6" label="Antigüedad"
              valor={antiguedad ? `${antiguedad.anios}a ${antiguedad.meses}m` : "—"} sub={fmtFecha(empleado.fecha_ingreso)} />
            <Kpi icon={<PlaneTakeoff size={16} />} tono="#15803d" fondo="#dcfce7" label="Vacaciones disponibles"
              valor={`${vacaciones.saldo} días`} sub={`${vacaciones.tomados} tomados de ${(vacaciones.devengados + vacaciones.iniciales).toFixed(2)}`} />
            <Kpi icon={<Wallet size={16} />} tono="#6d28d9" fondo="#ede9fe" label="Sueldo base"
              valor={fmtCLP(empleado.sueldo_base)} sub={empleado.tipo_contrato?.replace(/_/g, " ") || "—"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, fontSize: 12.5 }}>
            {[
              ["RUT", empleado.rut], ["Correo", empleado.email], ["Teléfono", empleado.telefono],
              ["Cargo", empleado.cargo], ["Área", empleado.area], ["Jefatura", empleado.jefatura_email],
              ["Dirección", [empleado.direccion, empleado.comuna].filter(Boolean).join(", ")],
              ["AFP", empleado.afp], ["Salud", empleado.salud],
              ["Banco", [empleado.banco, empleado.numero_cuenta].filter(Boolean).join(" · ")],
              ["Emergencia", [empleado.contacto_emergencia, empleado.telefono_emergencia].filter(Boolean).join(" · ")],
            ].map(([label, valor]) => (
              <div key={label} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
                <div>{valor || "—"}</div>
              </div>
            ))}
          </div>
          {empleado.notas && (
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.6 }}>
              <b>Notas:</b> {empleado.notas}
            </div>
          )}
        </div>
      )}

      {seccion === "contratos" && <ListaSimple filas={contratos} columnas={[
        ["tipo", "Tipo"], ["titulo", "Título"], ["fecha_inicio", "Inicio", fmtFecha],
        ["fecha_termino", "Término", fmtFecha], ["sueldo_base", "Sueldo", fmtCLP], ["estado", "Estado", "pill"],
      ]} vacio="Sin contratos registrados." />}

      {seccion === "liquidaciones" && <ListaSimple filas={liquidaciones} columnas={[
        ["periodo", "Período"], ["total_haberes", "Haberes", fmtCLP], ["total_descuentos", "Descuentos", fmtCLP],
        ["liquido", "Líquido", fmtCLP], ["estado", "Estado", "pill"],
      ]} vacio="Sin liquidaciones." />}

      {seccion === "evaluaciones" && <ListaSimple filas={evaluaciones} columnas={[
        ["periodo", "Período"], ["tipo", "Tipo"], ["evaluador_nombre", "Evaluador"],
        ["puntaje", "Puntaje", (v) => (v != null ? `${v} / 5` : "—")], ["estado", "Estado", "pill"],
      ]} vacio="Sin evaluaciones." />}

      {seccion === "solicitudes" && <ListaSimple filas={solicitudes} columnas={[
        ["tipo", "Tipo"], ["fecha_desde", "Desde", fmtFecha], ["fecha_hasta", "Hasta", fmtFecha],
        ["dias", "Días"], ["estado", "Estado", "pill"],
      ]} vacio="Sin solicitudes." />}

      {seccion === "documentos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => subirDocumento(e.target.files?.[0])} />
            <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={subiendo}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Upload size={14} /> {subiendo ? "Subiendo…" : "Subir documento"}
            </button>
          </div>
          {documentos.length === 0 ? <Vacio texto="Sin documentos." /> : (
            <div className="rrhh-tabla-wrap">
              <table className="rrhh-tabla">
                <thead><tr><th>Documento</th><th>Tipo</th><th>Fecha</th><th style={{ width: 90 }}>Acciones</th></tr></thead>
                <tbody>
                  {documentos.map((d) => (
                    <tr key={d.id}>
                      <td>{d.titulo || d.file_name}</td>
                      <td style={{ textTransform: "capitalize" }}>{d.tipo}</td>
                      <td>{fmtFecha(d.created_at)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost" title="Abrir" onClick={() => abrirArchivo(d)} style={{ padding: 6, lineHeight: 0 }}><Eye size={14} /></button>
                          <button className="btn btn-ghost" title="Eliminar" style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}
                            onClick={async () => {
                              try { await api.delete(`/rrhh/documentos/${d.id}`); await onRecargar(empleado.id); }
                              catch (e) { setToast({ type: "error", message: e?.message }); }
                            }}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {seccion === "jornada" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            La jornada pactada permite calcular atrasos, horas trabajadas y salidas anticipadas cruzando
            los marcajes de asistencia. Deja en blanco los días libres.
          </div>
          <div className="rrhh-tabla-wrap" style={{ maxHeight: "none" }}>
            <table className="rrhh-tabla">
              <thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th>Colación (min)</th></tr></thead>
              <tbody>
                {DIAS_SEMANA.map((nombre, d) => (
                  <tr key={d}>
                    <td style={{ fontWeight: 600 }}>{nombre}</td>
                    <td><input className="input" type="time" style={{ width: 130 }} value={jorn[d].hora_entrada}
                      onChange={(e) => setJorn((p) => ({ ...p, [d]: { ...p[d], hora_entrada: e.target.value } }))} /></td>
                    <td><input className="input" type="time" style={{ width: 130 }} value={jorn[d].hora_salida}
                      onChange={(e) => setJorn((p) => ({ ...p, [d]: { ...p[d], hora_salida: e.target.value } }))} /></td>
                    <td><input className="input" type="number" style={{ width: 90 }} value={jorn[d].colacion_minutos}
                      onChange={(e) => setJorn((p) => ({ ...p, [d]: { ...p[d], colacion_minutos: e.target.value } }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={guardarJornadas}>Guardar jornada</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Tabla compacta reutilizable para las secciones de la ficha.
function ListaSimple({ filas, columnas, vacio }) {
  if (!filas?.length) return <Vacio texto={vacio} />;
  return (
    <div className="rrhh-tabla-wrap">
      <table className="rrhh-tabla">
        <thead><tr>{columnas.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.id || i}>
              {columnas.map(([campo, label, fmt]) => (
                <td key={label} style={{ textTransform: campo === "tipo" ? "capitalize" : undefined }}>
                  {fmt === "pill" ? <Pill estado={f[campo]} />
                    : typeof fmt === "function" ? fmt(f[campo])
                      : String(f[campo] ?? "—").replace(/_/g, " ")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========================================================================== */
/* CONTRATOS                                                                   */
/* ========================================================================== */
function TabContratos({ empleados, empleadosPorId, setToast }) {
  const [contratos, setContratos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [firmando, setFirmando] = useState(null);
  const fileRef = useRef(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setContratos(await api.get("/rrhh/contratos"));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los contratos." });
    } finally { setCargando(false); }
  }, [setToast]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    if (!editando?.empleado_id) { setToast({ type: "error", message: "Selecciona el trabajador." }); return; }
    setGuardando(true);
    try {
      if (editando.id) await api.put(`/rrhh/contratos/${editando.id}`, editando);
      else await api.post("/rrhh/contratos", editando);
      setToast({ type: "success", message: "Contrato guardado." });
      setEditando(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally { setGuardando(false); }
  }

  async function subirPdf(file, contrato) {
    if (!file) return;
    try {
      const path = `${contrato.empleado_id}/contratos/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const fd = new FormData();
      fd.append("file", file);
      await api.postForm(`/rrhh/storage/upload?path=${encodeURIComponent(path)}`, fd);
      await api.put(`/rrhh/contratos/${contrato.id}`, { bucket: "rrhh", storage_path: path, file_name: file.name });
      setToast({ type: "success", message: "Archivo adjuntado al contrato." });
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo adjuntar." });
    }
  }

  async function firmarComoEmpresa(datos) {
    try {
      await api.post("/rrhh/firmas", {
        documento_tipo: "contrato", documento_id: firmando.id, empleado_id: firmando.empleado_id,
        firma_imagen: datos.firma_imagen, contenido: firmando.contenido || firmando.titulo || "",
        firmante_nombre: "Representante AMSODENT",
      });
      setToast({ type: "success", message: "Contrato firmado." });
      setFirmando(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo firmar." });
    }
  }

  const set = (c, v) => setEditando((p) => ({ ...p, [c]: v }));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          Contratos, anexos y finiquitos. Puedes redactar el texto para firmarlo en pantalla o adjuntar el PDF firmado.
        </div>
        <button className="btn btn-primary" onClick={() => setEditando({ tipo: "contrato", estado: "borrador" })}
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Plus size={15} /> Nuevo contrato
        </button>
      </div>

      <div className="rrhh-tabla-wrap">
        <table className="rrhh-tabla">
          <thead><tr>
            <th>Trabajador</th><th>Tipo</th><th>Título</th><th>Inicio</th><th>Término</th>
            <th style={{ textAlign: "right" }}>Sueldo</th><th>Estado</th><th style={{ width: 130 }}>Acciones</th>
          </tr></thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando…</td></tr>
            ) : contratos.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Sin contratos registrados.</td></tr>
            ) : contratos.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{nombreCompleto(empleadosPorId.get(Number(c.empleado_id)))}</td>
                <td style={{ textTransform: "capitalize" }}>{String(c.tipo || "").replace(/_/g, " ")}</td>
                <td>{c.titulo || "—"}</td>
                <td>{fmtFecha(c.fecha_inicio)}</td>
                <td>{c.fecha_termino ? fmtFecha(c.fecha_termino) : <span style={{ color: "var(--text-muted)" }}>indefinido</span>}</td>
                <td style={{ textAlign: "right" }}>{c.sueldo_base ? fmtCLP(c.sueldo_base) : "—"}</td>
                <td><Pill estado={c.estado} /></td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost" title="Editar" onClick={() => setEditando({ ...c })} style={{ padding: 6, lineHeight: 0 }}><Pencil size={14} /></button>
                    <button className="btn btn-ghost" title="Adjuntar PDF" style={{ padding: 6, lineHeight: 0 }}
                      onClick={() => { fileRef.current.onchange = (e) => subirPdf(e.target.files?.[0], c); fileRef.current.click(); }}>
                      <Upload size={14} />
                    </button>
                    {c.estado !== "firmado" && (
                      <button className="btn btn-ghost" title="Firmar" onClick={() => setFirmando(c)} style={{ padding: 6, lineHeight: 0, color: "var(--primary-dark)" }}><PenLine size={14} /></button>
                    )}
                    <button className="btn btn-ghost" title="Eliminar" style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}
                      onClick={async () => { try { await api.delete(`/rrhh/contratos/${c.id}`); await cargar(); } catch (e) { setToast({ type: "error", message: e?.message }); } }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} />

      {editando && (
        <Modal titulo={editando.id ? "Editar contrato" : "Nuevo contrato"} ancho={780} onClose={() => setEditando(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={gridForm}>
              <Campo label="Trabajador *">
                <select className="input" value={editando.empleado_id || ""} onChange={(e) => set("empleado_id", e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{nombreCompleto(e)}</option>)}
                </select>
              </Campo>
              <Campo label="Tipo">
                <select className="input" value={editando.tipo || "contrato"} onChange={(e) => set("tipo", e.target.value)}>
                  <option value="contrato">Contrato</option><option value="anexo">Anexo</option>
                  <option value="finiquito">Finiquito</option><option value="carta_amonestacion">Carta de amonestación</option>
                </select>
              </Campo>
              <Campo label="Estado">
                <select className="input" value={editando.estado || "borrador"} onChange={(e) => set("estado", e.target.value)}>
                  <option value="borrador">Borrador</option><option value="enviado">Enviado a firma</option>
                  <option value="firmado">Firmado</option><option value="vencido">Vencido</option><option value="anulado">Anulado</option>
                </select>
              </Campo>
              <Campo label="Título" ancho={2}><input className="input" value={editando.titulo || ""} onChange={(e) => set("titulo", e.target.value)} placeholder="Contrato de trabajo indefinido" /></Campo>
              <Campo label="Fecha inicio"><input className="input" type="date" value={(editando.fecha_inicio || "").slice(0, 10)} onChange={(e) => set("fecha_inicio", e.target.value)} /></Campo>
              <Campo label="Fecha término"><input className="input" type="date" value={(editando.fecha_termino || "").slice(0, 10)} onChange={(e) => set("fecha_termino", e.target.value)} /></Campo>
              <Campo label="Cargo"><input className="input" value={editando.cargo || ""} onChange={(e) => set("cargo", e.target.value)} /></Campo>
              <Campo label="Sueldo base"><input className="input" inputMode="numeric" value={editando.sueldo_base ?? ""} onChange={(e) => set("sueldo_base", e.target.value.replace(/[^\d]/g, ""))} /></Campo>
              <Campo label="Jornada"><input className="input" value={editando.jornada || ""} onChange={(e) => set("jornada", e.target.value)} placeholder="Lunes a viernes, 45 hrs" /></Campo>
            </div>
            <Campo label="Texto del contrato (opcional, para firmar en pantalla)">
              <textarea className="input" rows={8} value={editando.contenido || ""} onChange={(e) => set("contenido", e.target.value)}
                placeholder="Pega aquí el texto del contrato para que el trabajador lo lea y firme desde su portal." />
            </Campo>
          </div>
        </Modal>
      )}

      {firmando && (
        <Modal titulo="Firmar contrato" ancho={620} onClose={() => setFirmando(null)}>
          <FirmaDigital
            titulo={firmando.titulo || "Contrato de trabajo"}
            descripcion={`Firma en representación de la empresa · ${nombreCompleto(empleadosPorId.get(Number(firmando.empleado_id)))}`}
            contenido={firmando.contenido || firmando.titulo || ""}
            onFirmar={firmarComoEmpresa}
            onCancelar={() => setFirmando(null)}
          />
        </Modal>
      )}
    </>
  );
}

/* ========================================================================== */
/* LIQUIDACIONES                                                               */
/* ========================================================================== */
function TabLiquidaciones({ empleados, empleadosPorId, setToast }) {
  const [periodo, setPeriodo] = useState(periodoActual());
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [libro, setLibro] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [calculo, setCalculo] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const data = await api.get(`/rrhh/libro-remuneraciones?periodo=${periodo}`);
      setLibro(data);
      setLiquidaciones(data.filas || []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar las liquidaciones." });
    } finally { setCargando(false); }
  }, [periodo, setToast]);

  useEffect(() => { cargar(); }, [cargar]);

  async function generarMasivo() {
    setGenerando(true);
    try {
      const r = await api.post("/rrhh/liquidaciones/generar", { periodo });
      setToast({
        type: r.errores?.length ? "info" : "success",
        message: `${r.creadas} liquidación(es) generada(s)${r.omitidas ? `, ${r.omitidas} ya emitidas se mantuvieron` : ""}.${r.errores?.length ? ` Errores: ${r.errores.length}` : ""}`,
      });
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo generar." });
    } finally { setGenerando(false); }
  }

  // Recalcula en vivo mientras se editan los haberes.
  useEffect(() => {
    if (!editando?.empleado_id) { setCalculo(null); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.post("/rrhh/liquidaciones/calcular", editando);
        if (vivo) setCalculo(r);
      } catch { /* el formulario sigue usable sin preview */ }
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [editando]);

  async function guardar() {
    setGuardando(true);
    try {
      await api.post("/rrhh/liquidaciones", { ...editando, periodo: editando.periodo || periodo });
      setToast({ type: "success", message: "Liquidación guardada." });
      setEditando(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally { setGuardando(false); }
  }

  async function cambiarEstado(l, estado) {
    try {
      await api.put(`/rrhh/liquidaciones/${l.id}/estado`, { estado });
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cambiar el estado." });
    }
  }

  function exportarCsv() {
    if (!liquidaciones.length) return;
    const enc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const cols = ["rut", "nombre", "cargo", "area", "dias_trabajados", "sueldo_base", "gratificacion", "horas_extra", "bonos",
      "total_imponible", "colacion", "movilizacion", "total_haberes", "afp_monto", "salud_monto",
      "seguro_cesantia", "impuesto_unico", "total_descuentos", "liquido", "estado"];
    const filas = [cols, ...liquidaciones.map((l) => cols.map((c) => l[c] ?? ""))];
    const csv = String.fromCharCode(0xfeff) + filas.map((r) => r.map(enc).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `libro-remuneraciones-${periodo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const set = (c, v) => setEditando((p) => ({ ...p, [c]: v }));
  const t = libro?.totales;

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Período</label>
          <input type="month" className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: 170 }} />
        </div>
        <div className="filter-field" style={{ flex: 1, justifyContent: "flex-end", flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <button className="btn btn-secondary" onClick={exportarCsv} disabled={!liquidaciones.length}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38 }}>
            <Download size={14} /> Libro CSV
          </button>
          <button className="btn btn-secondary" onClick={() => setEditando({ periodo, empleado_id: "" })}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38 }}>
            <Plus size={15} /> Individual
          </button>
          <button className="btn btn-primary" onClick={generarMasivo} disabled={generando}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38 }}>
            <RefreshCw size={14} className={generando ? "rrhh-girando" : undefined} />
            {generando ? "Generando…" : "Generar período"}
          </button>
        </div>
      </div>

      {t && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, margin: "14px 0" }}>
          <Kpi icon={<Users size={17} />} tono="#1e9295" fondo="#e6f6f6" label="Trabajadores" valor={t.trabajadores} sub={`período ${periodo}`} />
          <Kpi icon={<Wallet size={17} />} tono="#15803d" fondo="#dcfce7" label="Total haberes" valor={fmtCLP(t.total_haberes)} sub={`imponible ${fmtCLP(t.total_imponible)}`} />
          <Kpi icon={<TrendingUp size={17} />} tono="#b45309" fondo="#fef3c7" label="Descuentos" valor={fmtCLP(t.total_descuentos)} sub={`AFP ${fmtCLP(t.afp)} · Salud ${fmtCLP(t.salud)}`} />
          <Kpi icon={<CheckCircle2 size={17} />} tono="#6d28d9" fondo="#ede9fe" label="Líquido a pagar" valor={fmtCLP(t.liquido)} sub={`impuesto ${fmtCLP(t.impuesto)}`} />
        </div>
      )}

      <div className="rrhh-tabla-wrap">
        <table className="rrhh-tabla">
          <thead><tr>
            <th>Trabajador</th><th style={{ textAlign: "right" }}>Imponible</th><th style={{ textAlign: "right" }}>Haberes</th>
            <th style={{ textAlign: "right" }}>AFP</th><th style={{ textAlign: "right" }}>Salud</th>
            <th style={{ textAlign: "right" }}>Impuesto</th><th style={{ textAlign: "right" }}>Descuentos</th>
            <th style={{ textAlign: "right" }}>Líquido</th><th>Estado</th><th style={{ width: 130 }}>Acciones</th>
          </tr></thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={10} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando…</td></tr>
            ) : liquidaciones.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>
                Sin liquidaciones en {periodo}. Usa «Generar período» para crearlas desde las fichas.
              </td></tr>
            ) : liquidaciones.map((l) => (
              <tr key={l.id}>
                <td style={{ fontWeight: 600 }}>{l.nombre}<div style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.cargo || ""}</div></td>
                <td style={{ textAlign: "right" }}>{fmtCLP(l.total_imponible)}</td>
                <td style={{ textAlign: "right" }}>{fmtCLP(l.total_haberes)}</td>
                <td style={{ textAlign: "right" }}>{fmtCLP(l.afp_monto)}</td>
                <td style={{ textAlign: "right" }}>{fmtCLP(l.salud_monto)}</td>
                <td style={{ textAlign: "right" }}>{fmtCLP(l.impuesto_unico)}</td>
                <td style={{ textAlign: "right" }}>{fmtCLP(l.total_descuentos)}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtCLP(l.liquido)}</td>
                <td><Pill estado={l.estado} /></td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-ghost" title="Editar" onClick={() => setEditando({ ...l })} style={{ padding: 6, lineHeight: 0 }}><Pencil size={14} /></button>
                    {l.estado === "borrador" && (
                      <button className="btn btn-ghost" title="Emitir" onClick={() => cambiarEstado(l, "emitida")} style={{ padding: 6, lineHeight: 0, color: "#1d4ed8" }}><CheckCircle2 size={14} /></button>
                    )}
                    {(l.estado === "emitida" || l.estado === "firmada") && (
                      <button className="btn btn-ghost" title="Marcar pagada" onClick={() => cambiarEstado(l, "pagada")} style={{ padding: 6, lineHeight: 0, color: "#15803d" }}><Wallet size={14} /></button>
                    )}
                    <button className="btn btn-ghost" title="Eliminar" style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}
                      onClick={async () => { try { await api.delete(`/rrhh/liquidaciones/${l.id}`); await cargar(); } catch (e) { setToast({ type: "error", message: e?.message }); } }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal titulo="Liquidación de sueldo" ancho={860} onClose={() => setEditando(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando || !editando.empleado_id}>{guardando ? "Guardando…" : "Guardar"}</button>
          </>}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={gridForm}>
                <Campo label="Trabajador *">
                  <select className="input" value={editando.empleado_id || ""} onChange={(e) => set("empleado_id", e.target.value)} disabled={Boolean(editando.id)}>
                    <option value="">Seleccionar…</option>
                    {empleados.map((e) => <option key={e.id} value={e.id}>{nombreCompleto(e)}</option>)}
                  </select>
                </Campo>
                <Campo label="Período"><input className="input" type="month" value={editando.periodo || periodo} onChange={(e) => set("periodo", e.target.value)} /></Campo>
                <Campo label="Días trabajados"><input className="input" type="number" max={30} value={editando.dias_trabajados ?? 30} onChange={(e) => set("dias_trabajados", e.target.value)} /></Campo>
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--primary-dark)" }}>Haberes</div>
                <div style={gridForm}>
                  {[["sueldo_base", "Sueldo base"], ["horas_extra", "Horas extra ($)"], ["bonos", "Bonos"],
                    ["comisiones", "Comisiones"], ["otros_imponibles", "Otros imponibles"],
                    ["colacion", "Colación"], ["movilizacion", "Movilización"], ["asignacion_familiar", "Asig. familiar"]].map(([campo, label]) => (
                    <Campo key={campo} label={label}>
                      <input className="input" inputMode="numeric" value={editando[campo] ?? ""}
                        onChange={(e) => set(campo, e.target.value.replace(/[^\d]/g, ""))} placeholder="según ficha" />
                    </Campo>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8, color: "var(--primary-dark)" }}>Otros descuentos</div>
                <div style={gridForm}>
                  {[["anticipos", "Anticipos"], ["prestamos", "Préstamos"], ["otros_descuentos", "Otros"]].map(([campo, label]) => (
                    <Campo key={campo} label={label}>
                      <input className="input" inputMode="numeric" value={editando[campo] ?? ""}
                        onChange={(e) => set(campo, e.target.value.replace(/[^\d]/g, ""))} />
                    </Campo>
                  ))}
                </div>
              </div>
              <Campo label="Observaciones">
                <textarea className="input" rows={2} value={editando.observaciones || ""} onChange={(e) => set("observaciones", e.target.value)} />
              </Campo>
            </div>

            {/* Vista previa del cálculo */}
            <div style={{ background: "var(--bg)", borderRadius: 12, padding: 14, alignSelf: "start", position: "sticky", top: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>Cálculo</div>
              {!calculo ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Selecciona un trabajador para ver el cálculo.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5 }}>
                  {[
                    ["Sueldo base", calculo.sueldo_base], ["Gratificación", calculo.gratificacion],
                    ["Horas extra", calculo.horas_extra], ["Bonos", calculo.bonos],
                    ["Total imponible", calculo.total_imponible, true],
                    ["Colación", calculo.colacion], ["Movilización", calculo.movilizacion],
                    ["Total haberes", calculo.total_haberes, true],
                    ["AFP", -calculo.afp_monto], ["Salud", -calculo.salud_monto],
                    ["Seguro cesantía", -calculo.seguro_cesantia], ["Impuesto único", -calculo.impuesto_unico],
                    ["Otros descuentos", -(calculo.anticipos + calculo.prestamos + calculo.otros_descuentos)],
                    ["Total descuentos", -calculo.total_descuentos, true],
                  ].map(([label, valor, fuerte], i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between",
                      fontWeight: fuerte ? 800 : 400,
                      borderTop: fuerte ? "1px solid var(--border)" : undefined,
                      paddingTop: fuerte ? 5 : 0,
                      color: Number(valor) < 0 ? "#b91c1c" : undefined,
                    }}>
                      <span>{label}</span><span>{fmtCLP(Math.abs(valor))}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: 15, marginTop: 8, paddingTop: 8, borderTop: "2px solid var(--primary)", color: "var(--primary-dark)" }}>
                    <span>Líquido</span><span>{fmtCLP(calculo.liquido)}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
                    UF {Number(calculo.parametros?.uf).toLocaleString("es-CL")} · UTM {Number(calculo.parametros?.utm).toLocaleString("es-CL")} ·
                    tope imponible {calculo.parametros?.tope_imponible_uf} UF. Ajustables en el .env del backend.
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ========================================================================== */
/* ASISTENCIA                                                                  */
/* ========================================================================== */
function TabAsistencia({ setToast }) {
  const hoy = new Date();
  const [desde, setDesde] = useState(new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(hoy.toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState("resumen");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setData(await api.get(`/rrhh/asistencia?desde=${desde}&hasta=${hasta}`));
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo cargar la asistencia." });
    } finally { setCargando(false); }
  }, [desde, hasta, setToast]);

  useEffect(() => { cargar(); }, [cargar]);

  const hhmm = (min) => {
    if (min == null) return "—";
    const h = Math.floor(Math.abs(min) / 60);
    const m = Math.abs(min) % 60;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  };

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Desde</label>
          <input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 160 }} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Hasta</label>
          <input type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ width: 160 }} />
        </div>
        <div className="filter-field">
          <label className="filter-label">Vista</label>
          <select className="input" value={vista} onChange={(e) => setVista(e.target.value)} style={{ minWidth: 160 }}>
            <option value="resumen">Resumen por persona</option>
            <option value="detalle">Detalle por día</option>
          </select>
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0", lineHeight: 1.5 }}>
        Calculado con los marcajes de asistencia cruzados con la jornada pactada de cada ficha
        (pestaña «Jornada» dentro del trabajador). Sin jornada cargada no se pueden medir atrasos.
      </div>

      {cargando ? <Vacio texto="Calculando asistencia…" /> : !data ? <Vacio texto="Sin datos." /> : vista === "resumen" ? (
        <div className="rrhh-tabla-wrap">
          <table className="rrhh-tabla">
            <thead><tr>
              <th>Trabajador</th><th>Área</th><th style={{ textAlign: "center" }}>Días con marca</th>
              <th style={{ textAlign: "center" }}>Atrasos</th><th style={{ textAlign: "right" }}>Tiempo de atraso</th>
              <th style={{ textAlign: "right" }}>Horas trabajadas</th><th style={{ textAlign: "center" }}>Sin salida</th>
              <th style={{ textAlign: "center" }}>Fuera de radio</th>
            </tr></thead>
            <tbody>
              {data.resumen.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Sin marcajes en el período.</td></tr>
              ) : data.resumen.map((r) => (
                <tr key={r.email}>
                  <td style={{ fontWeight: 600 }}>{r.nombre}<div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.email}</div></td>
                  <td>{r.area || "—"}</td>
                  <td style={{ textAlign: "center" }}>{r.dias_con_marca}</td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: r.atrasos > 0 ? "#b45309" : "#15803d" }}>{r.atrasos}</td>
                  <td style={{ textAlign: "right" }}>{r.minutos_atraso ? hhmm(r.minutos_atraso) : "—"}</td>
                  <td style={{ textAlign: "right" }}>{hhmm(r.minutos_trabajados)}</td>
                  <td style={{ textAlign: "center", color: r.dias_sin_salida ? "#b91c1c" : undefined }}>{r.dias_sin_salida || "—"}</td>
                  <td style={{ textAlign: "center", color: r.dias_fuera_de_radio ? "#b45309" : undefined }}>{r.dias_fuera_de_radio || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rrhh-tabla-wrap">
          <table className="rrhh-tabla">
            <thead><tr>
              <th>Fecha</th><th>Trabajador</th><th>Entrada</th><th>Salida</th>
              <th>Jornada</th><th style={{ textAlign: "right" }}>Atraso</th>
              <th style={{ textAlign: "right" }}>Trabajado</th><th>Observación</th>
            </tr></thead>
            <tbody>
              {data.dias.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Sin marcajes en el período.</td></tr>
              ) : data.dias.map((d, i) => (
                <tr key={`${d.email}-${d.fecha}-${i}`}>
                  <td>{fmtFecha(d.fecha)}</td>
                  <td style={{ fontWeight: 600 }}>{d.nombre}</td>
                  <td>{d.entrada_hora || "—"}</td>
                  <td>{d.salida_hora || "—"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {d.jornada_entrada ? `${d.jornada_entrada}–${d.jornada_salida || "?"}` : "sin jornada"}
                  </td>
                  <td style={{ textAlign: "right", color: d.atraso_min > 5 ? "#b45309" : undefined, fontWeight: d.atraso_min > 5 ? 700 : 400 }}>
                    {d.atraso_min != null ? (d.atraso_min > 0 ? `${d.atraso_min} min` : "—") : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{hhmm(d.trabajado_min)}</td>
                  <td style={{ fontSize: 11.5 }}>
                    {d.sin_salida && <span style={{ color: "#b91c1c", marginRight: 6 }}>Sin salida</span>}
                    {d.fuera_de_radio && <span style={{ color: "#b45309" }}>Fuera de radio</span>}
                    {!d.sin_salida && !d.fuera_de_radio && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ========================================================================== */
/* EVALUACIONES                                                                */
/* ========================================================================== */
function TabEvaluaciones({ empleados, empleadosPorId, setToast }) {
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [expandida, setExpandida] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setEvaluaciones(await api.get("/rrhh/evaluaciones")); }
    catch (e) { setToast({ type: "error", message: e?.message || "No se pudieron cargar las evaluaciones." }); }
    finally { setCargando(false); }
  }, [setToast]);

  useEffect(() => { cargar(); }, [cargar]);

  function nueva() {
    setEditando({
      periodo: String(new Date().getFullYear()),
      tipo: "desempeno",
      estado: "borrador",
      competencias: COMPETENCIAS_BASE.map((nombre) => ({ nombre, peso: 1, puntaje: 3, comentario: "" })),
    });
  }

  async function guardar() {
    if (!editando?.empleado_id) { setToast({ type: "error", message: "Selecciona el trabajador." }); return; }
    setGuardando(true);
    try {
      await api.post("/rrhh/evaluaciones", editando);
      setToast({ type: "success", message: "Evaluación guardada." });
      setEditando(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar." });
    } finally { setGuardando(false); }
  }

  const promedio = useMemo(() => {
    if (!editando?.competencias?.length) return null;
    const items = editando.competencias.filter((c) => Number.isFinite(Number(c.puntaje)));
    if (!items.length) return null;
    const pesoTotal = items.reduce((s, c) => s + (Number(c.peso) || 1), 0);
    return (items.reduce((s, c) => s + Number(c.puntaje) * (Number(c.peso) || 1), 0) / pesoTotal).toFixed(2);
  }, [editando]);

  const set = (c, v) => setEditando((p) => ({ ...p, [c]: v }));
  const setComp = (i, campo, valor) =>
    setEditando((p) => ({ ...p, competencias: p.competencias.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)) }));

  const colorPuntaje = (p) => (p >= 4 ? "#15803d" : p >= 3 ? "#b45309" : "#b91c1c");

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          Evaluaciones de desempeño con competencias ponderadas (escala 1 a 5), fortalezas, oportunidades y compromisos.
        </div>
        <button className="btn btn-primary" onClick={nueva} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Plus size={15} /> Nueva evaluación
        </button>
      </div>

      <div className="rrhh-tabla-wrap">
        <table className="rrhh-tabla">
          <thead><tr>
            <th style={{ width: 26 }} /><th>Trabajador</th><th>Período</th><th>Tipo</th>
            <th>Evaluador</th><th style={{ textAlign: "center" }}>Puntaje</th><th>Estado</th><th style={{ width: 90 }}>Acciones</th>
          </tr></thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando…</td></tr>
            ) : evaluaciones.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Sin evaluaciones registradas.</td></tr>
            ) : evaluaciones.map((ev) => (
              <Fragment key={ev.id}>
                <tr>
                  <td style={{ cursor: "pointer", color: "var(--text-muted)" }} onClick={() => setExpandida(expandida === ev.id ? null : ev.id)}>
                    {expandida === ev.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td style={{ fontWeight: 600 }}>{nombreCompleto(empleadosPorId.get(Number(ev.empleado_id)))}</td>
                  <td>{ev.periodo}</td>
                  <td style={{ textTransform: "capitalize" }}>{String(ev.tipo || "").replace(/_/g, " ")}</td>
                  <td>{ev.evaluador_nombre || ev.evaluador_email || "—"}</td>
                  <td style={{ textAlign: "center", fontWeight: 800, color: colorPuntaje(Number(ev.puntaje)) }}>
                    {ev.puntaje != null ? `${ev.puntaje} / 5` : "—"}
                  </td>
                  <td><Pill estado={ev.estado} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-ghost" title="Editar" onClick={() => setEditando({ ...ev, competencias: ev.competencias || [] })} style={{ padding: 6, lineHeight: 0 }}><Pencil size={14} /></button>
                      <button className="btn btn-ghost" title="Eliminar" style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}
                        onClick={async () => { try { await api.delete(`/rrhh/evaluaciones/${ev.id}`); await cargar(); } catch (e) { setToast({ type: "error", message: e?.message }); } }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandida === ev.id && (
                  <tr>
                    <td colSpan={8} style={{ background: "var(--bg)", padding: "12px 20px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, fontSize: 12.5 }}>
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>Competencias</div>
                          {(ev.competencias || []).map((c, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                              <span>{c.nombre}</span>
                              <b style={{ color: colorPuntaje(Number(c.puntaje)) }}>{c.puntaje}</b>
                            </div>
                          ))}
                        </div>
                        {[["Fortalezas", ev.fortalezas], ["Oportunidades de mejora", ev.oportunidades], ["Compromisos", ev.compromisos], ["Comentario del trabajador", ev.comentario_empleado]]
                          .filter(([, v]) => v).map(([label, v]) => (
                            <div key={label}>
                              <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                              <div style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{v}</div>
                            </div>
                          ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal titulo={editando.id ? "Editar evaluación" : "Nueva evaluación de desempeño"} ancho={820} onClose={() => setEditando(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={gridForm}>
              <Campo label="Trabajador *">
                <select className="input" value={editando.empleado_id || ""} onChange={(e) => set("empleado_id", e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{nombreCompleto(e)}</option>)}
                </select>
              </Campo>
              <Campo label="Período"><input className="input" value={editando.periodo || ""} onChange={(e) => set("periodo", e.target.value)} placeholder="2026-S1" /></Campo>
              <Campo label="Tipo">
                <select className="input" value={editando.tipo || "desempeno"} onChange={(e) => set("tipo", e.target.value)}>
                  <option value="desempeno">Desempeño</option><option value="periodo_prueba">Período de prueba</option>
                  <option value="360">360°</option><option value="objetivos">Por objetivos</option>
                </select>
              </Campo>
              <Campo label="Estado">
                <select className="input" value={editando.estado || "borrador"} onChange={(e) => set("estado", e.target.value)}>
                  <option value="borrador">Borrador</option><option value="enviada">Enviada al trabajador</option><option value="firmada">Firmada</option>
                </select>
              </Campo>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--primary-dark)" }}>Competencias (1 a 5)</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: promedio ? colorPuntaje(Number(promedio)) : undefined }}>
                  Promedio: {promedio ?? "—"} / 5
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(editando.competencias || []).map((c, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px", gap: 8, alignItems: "center" }}>
                    <input className="input" value={c.nombre} onChange={(e) => setComp(i, "nombre", e.target.value)} />
                    <input className="input" type="range" min={1} max={5} step={1} value={c.puntaje ?? 3} onChange={(e) => setComp(i, "puntaje", Number(e.target.value))} style={{ padding: 0 }} />
                    <div style={{ fontWeight: 800, textAlign: "center", color: colorPuntaje(Number(c.puntaje)) }}>{c.puntaje ?? 3}</div>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: 12 }}
                  onClick={() => set("competencias", [...(editando.competencias || []), { nombre: "", peso: 1, puntaje: 3 }])}>
                  + Agregar competencia
                </button>
              </div>
            </div>

            <Campo label="Fortalezas"><textarea className="input" rows={2} value={editando.fortalezas || ""} onChange={(e) => set("fortalezas", e.target.value)} /></Campo>
            <Campo label="Oportunidades de mejora"><textarea className="input" rows={2} value={editando.oportunidades || ""} onChange={(e) => set("oportunidades", e.target.value)} /></Campo>
            <Campo label="Compromisos y plan de acción"><textarea className="input" rows={2} value={editando.compromisos || ""} onChange={(e) => set("compromisos", e.target.value)} /></Campo>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ========================================================================== */
/* SOLICITUDES                                                                 */
/* ========================================================================== */
function TabSolicitudes({ empleados, empleadosPorId, setToast }) {
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [nueva, setNueva] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setSolicitudes(await api.get("/rrhh/solicitudes")); }
    catch (e) { setToast({ type: "error", message: e?.message || "No se pudieron cargar las solicitudes." }); }
    finally { setCargando(false); }
  }, [setToast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(
    () => solicitudes.filter((s) => !filtroEstado || s.estado === filtroEstado),
    [solicitudes, filtroEstado],
  );

  async function resolver(s, estado) {
    try {
      await api.put(`/rrhh/solicitudes/${s.id}/resolver`, { estado });
      setToast({ type: "success", message: `Solicitud ${estado}.` });
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo resolver." });
    }
  }

  async function crear() {
    setGuardando(true);
    try {
      await api.post("/rrhh/solicitudes", nueva);
      setToast({ type: "success", message: "Solicitud registrada." });
      setNueva(null);
      await cargar();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo registrar." });
    } finally { setGuardando(false); }
  }

  return (
    <>
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Todas</option>
            <option value="pendiente">Pendientes</option><option value="aprobada">Aprobadas</option>
            <option value="rechazada">Rechazadas</option><option value="anulada">Anuladas</option>
          </select>
        </div>
        <div className="filter-field" style={{ flex: 1, justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={() => setNueva({ tipo: "vacaciones" })}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 38 }}>
            <Plus size={15} /> Registrar solicitud
          </button>
        </div>
      </div>

      <div className="rrhh-tabla-wrap" style={{ marginTop: 12 }}>
        <table className="rrhh-tabla">
          <thead><tr>
            <th>Trabajador</th><th>Tipo</th><th>Desde</th><th>Hasta</th>
            <th style={{ textAlign: "center" }}>Días</th><th>Motivo</th><th>Estado</th><th style={{ width: 110 }}>Acciones</th>
          </tr></thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Cargando…</td></tr>
            ) : filtradas.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 26, textAlign: "center", color: "var(--text-muted)" }}>Sin solicitudes.</td></tr>
            ) : filtradas.map((s) => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{nombreCompleto(empleadosPorId.get(Number(s.empleado_id)))}</td>
                <td style={{ textTransform: "capitalize" }}>{String(s.tipo || "").replace(/_/g, " ")}</td>
                <td>{fmtFecha(s.fecha_desde)}</td>
                <td>{fmtFecha(s.fecha_hasta)}</td>
                <td style={{ textAlign: "center", fontWeight: 700 }}>{s.dias ?? "—"}</td>
                <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.motivo || ""}>{s.motivo || "—"}</td>
                <td><Pill estado={s.estado} /></td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {s.estado === "pendiente" && (
                      <>
                        <button className="btn btn-ghost" title="Aprobar" onClick={() => resolver(s, "aprobada")} style={{ padding: 6, lineHeight: 0, color: "#15803d" }}><CheckCircle2 size={14} /></button>
                        <button className="btn btn-ghost" title="Rechazar" onClick={() => resolver(s, "rechazada")} style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}><X size={14} /></button>
                      </>
                    )}
                    <button className="btn btn-ghost" title="Eliminar" style={{ padding: 6, lineHeight: 0, color: "#b91c1c" }}
                      onClick={async () => { try { await api.delete(`/rrhh/solicitudes/${s.id}`); await cargar(); } catch (e) { setToast({ type: "error", message: e?.message }); } }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nueva && (
        <Modal titulo="Registrar solicitud" ancho={560} onClose={() => setNueva(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setNueva(null)} disabled={guardando}>Cancelar</button>
            <button className="btn btn-primary" onClick={crear} disabled={guardando}>{guardando ? "Guardando…" : "Registrar"}</button>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={gridForm}>
              <Campo label="Trabajador *">
                <select className="input" value={nueva.empleado_id || ""} onChange={(e) => setNueva((p) => ({ ...p, empleado_id: e.target.value }))}>
                  <option value="">Seleccionar…</option>
                  {empleados.map((e) => <option key={e.id} value={e.id}>{nombreCompleto(e)}</option>)}
                </select>
              </Campo>
              <Campo label="Tipo">
                <select className="input" value={nueva.tipo} onChange={(e) => setNueva((p) => ({ ...p, tipo: e.target.value }))}>
                  {TIPOS_SOLICITUD.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </Campo>
              <Campo label="Desde"><input className="input" type="date" value={nueva.fecha_desde || ""} onChange={(e) => setNueva((p) => ({ ...p, fecha_desde: e.target.value }))} /></Campo>
              <Campo label="Hasta"><input className="input" type="date" value={nueva.fecha_hasta || ""} onChange={(e) => setNueva((p) => ({ ...p, fecha_hasta: e.target.value }))} /></Campo>
            </div>
            <Campo label="Motivo"><textarea className="input" rows={3} value={nueva.motivo || ""} onChange={(e) => setNueva((p) => ({ ...p, motivo: e.target.value }))} /></Campo>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              Los días hábiles se calculan automáticamente (se excluyen sábados y domingos).
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
