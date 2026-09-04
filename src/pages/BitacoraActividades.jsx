import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Select from "react-select";
import CreatableSelect from "react-select/creatable";
import { REGIONES_CHILE } from "../constants/regiones";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import {
  ChevronLeft, ChevronRight, Plus, X, Trash2, Clock, User, Filter,
  CalendarDays, CalendarRange, CalendarClock, ListChecks, Check, Paperclip, FileText,
  Users, Tag, FileSignature, Video,
  ClipboardCheck, AlertCircle, CalendarCheck, Bell,
} from "lucide-react";

const ACTIVIDADES_BUCKET = "chat-adjuntos";

// Motivo de la gestión. Se separa en generales y los propios de un Prospecto:
// al elegir el tipo "Prospecto" el motivo se restringe a Mapeo / Visita
// Espontánea / Referido; en el resto de tipos se usan los motivos generales.
const MOTIVOS_GENERAL = ["1er Contacto", "Solicitud de Reunión", "Presupuesto", "Presentación Empresa", "Gestión Administrativa"];
const MOTIVOS_PROSPECTO = ["Mapeo", "Visita Espontánea", "Referido"];
// Unión, para los filtros de la vista (se puede filtrar por cualquiera).
const MOTIVOS = [...MOTIVOS_GENERAL, ...MOTIVOS_PROSPECTO];

// Color estable por usuario (para diferenciar en la vista de admin).
const PALETA_USUARIOS = ["#2563eb", "#16a34a", "#db2777", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0d9488"];
function colorUsuario(email) {
  const s = String(email || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETA_USUARIOS[h % PALETA_USUARIOS.length];
}
function inicialesNombre(nombre) {
  const p = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p[0][0] + (p[1]?.[0] || "")).toUpperCase();
}

// Las reuniones con participantes se guardan como una fila por persona (mismo
// grupo_id). En la vista global (admin/jefatura sin filtrar por un usuario) eso
// duplica la misma reunión N veces. Aquí colapsamos cada grupo_id a una sola
// fila, prefiriendo la del creador (primer participante de la lista).
function dedupeGrupos(list, activar) {
  if (!activar) return list || [];
  const out = [];
  const idxPorGrupo = new Map();
  for (const a of list || []) {
    if (!a?.grupo_id) { out.push(a); continue; }
    const creador = String(a.participantes?.[0]?.email || "").toLowerCase();
    const esCreador = creador && String(a.user_email || "").toLowerCase() === creador;
    if (!idxPorGrupo.has(a.grupo_id)) {
      idxPorGrupo.set(a.grupo_id, out.length);
      out.push(a);
    } else if (esCreador) {
      out[idxPorGrupo.get(a.grupo_id)] = a; // reemplaza por la fila del creador
    }
  }
  return out;
}

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
  { value: "prospecto", label: "Prospecto", color: "#1e40af" },
  { value: "llamada", label: "Llamada", color: "#0ea5e9" },
  { value: "whatsapp", label: "WhatsApp", color: "#25d366" },
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
  // Vista global (ve actividades de todos y filtra por usuario): admin + jefe de ventas.
  const verTodas = esAdmin || rolNorm === "jefe_ventas";

  const [vista, setVista] = useState("mes"); // mes | semana | dia | agenda
  const [ancla, setAncla] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [actividades, setActividades] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [perfiles, setPerfiles] = useState([]); // usuarios para participantes (reunión)
  const [metricas, setMetricas] = useState([]); // actividades en ventana fija (dashboard)
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Filtros
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroTipoCliente, setFiltroTipoCliente] = useState(""); // filtra el selector de clientes por tipo
  const [filtroUsuario, setFiltroUsuario] = useState("");
  const [filtroMotivo, setFiltroMotivo] = useState("");

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

  const cargar = useCallback(async (opts = {}) => {
    // silencioso: refresco tras guardar — sin vaciar el calendario con el
    // spinner (la recarga completa se sentía como lentitud al crear).
    if (!opts.silencioso) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("desde", rango.desde);
      params.set("hasta", rango.hasta);
      if (filtroTipo) params.set("tipo", filtroTipo);
      if (filtroCliente) params.set("cliente_id", filtroCliente);
      if (verTodas && filtroUsuario) params.set("email", filtroUsuario);
      const data = await api.get(`/actividades?${params.toString()}`);
      setActividades(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudieron cargar las actividades." });
    } finally {
      setLoading(false);
    }
  }, [rango, filtroTipo, filtroCliente, filtroUsuario, verTodas]);

  useEffect(() => { cargar(); }, [cargar]);

  // Al abrir la bitácora se importa AL INSTANTE el Google Calendar del usuario
  // (backend con throttle de 1 min); si trajo reuniones nuevas, se recarga la
  // grilla sin spinner. Best-effort: sin cuenta conectada no pasa nada.
  useEffect(() => {
    let activo = true;
    api.post("/actividades/importar-calendar", {})
      .then((r) => { if (activo && Number(r?.importadas || 0) > 0) cargar({ silencioso: true }); })
      .catch(() => {});
    return () => { activo = false; };
    // Solo al montar: el throttle del backend hace inocuo repetirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Métricas del dashboard: ventana fija alrededor de hoy (independiente de la
  // navegación del calendario) para que los KPIs/paneles no cambien al navegar.
  const cargarMetricas = useCallback(async () => {
    try {
      const h = new Date(); h.setHours(0, 0, 0, 0);
      const params = new URLSearchParams();
      params.set("desde", ymd(addDays(h, -60)));
      params.set("hasta", ymd(addDays(h, 60)));
      if (verTodas && filtroUsuario) params.set("email", filtroUsuario);
      const data = await api.get(`/actividades?${params.toString()}`);
      setMetricas(Array.isArray(data) ? data : []);
    } catch {
      setMetricas([]);
    }
  }, [verTodas, filtroUsuario]);

  useEffect(() => { cargarMetricas(); }, [cargarMetricas]);

  // Clientes (selector/filtro), cotizaciones (asociar), perfiles (participantes)
  // y usuarios con actividades (filtro admin).
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get("/clientes");
        setClientes(Array.isArray(data) ? data : []);
      } catch { /* */ }
    })();
    (async () => {
      try {
        const c = await api.get("/licitaciones/with-fields?fields=id,id_licitacion,nombre,nombre_entidad,rut_entidad,estado");
        setCotizaciones(Array.isArray(c) ? c : []);
      } catch { /* */ }
    })();
    (async () => {
      try {
        const p = await api.get("/usuarios/profiles");
        setPerfiles(Array.isArray(p) ? p : []);
      } catch { /* */ }
    })();
    if (verTodas) {
      (async () => {
        try {
          const u = await api.get("/actividades/usuarios");
          setUsuarios(Array.isArray(u) ? u : []);
        } catch { /* */ }
      })();
    }
  }, [verTodas]);

  // En vista global sin filtro de un único usuario, diferenciamos por color/usuario.
  const mostrarUsuario = verTodas && !filtroUsuario;

  const clienteOptions = useMemo(
    () => clientes
      .map((c) => ({ value: c.id, label: `${c.nombre || "—"}${c.rut ? ` · ${c.rut}` : ""}`, nombre: c.nombre || "", rut: c.rut || "", tipo: c.tipo_cliente || "" }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [clientes],
  );

  // Tipos de cliente disponibles (para el filtro rápido del selector de clientes).
  const tiposClienteDisponibles = useMemo(() => {
    const set = new Set();
    clienteOptions.forEach((c) => { const t = (c.tipo || "").trim(); if (t) set.add(t); });
    return [...set].sort();
  }, [clienteOptions]);

  // Opciones de cliente para el filtro, acotadas por tipo de cliente.
  const clienteOptionsFiltro = useMemo(
    () => (filtroTipoCliente
      ? clienteOptions.filter((c) => (c.tipo || "") === filtroTipoCliente)
      : clienteOptions),
    [clienteOptions, filtroTipoCliente],
  );

  // En la vista global colapsamos las reuniones replicadas por participante
  // (mismo grupo_id) para que el admin/jefatura no las vea duplicadas.
  const actividadesVista = useMemo(() => {
    const base = dedupeGrupos(actividades, mostrarUsuario);
    if (!filtroMotivo) return base;
    return base.filter((a) => (a.motivo || "") === filtroMotivo);
  }, [actividades, mostrarUsuario, filtroMotivo]);
  const metricasVista = useMemo(
    () => dedupeGrupos(metricas, mostrarUsuario),
    [metricas, mostrarUsuario],
  );

  // Agrupar actividades por fecha (YYYY-MM-DD) para pintar el calendario.
  const porFecha = useMemo(() => {
    const m = {};
    actividadesVista.forEach((a) => {
      const k = String(a.fecha).slice(0, 10);
      (m[k] = m[k] || []).push(a);
    });
    Object.values(m).forEach((arr) => arr.sort((x, y) => {
      if (x.todo_el_dia && !y.todo_el_dia) return -1;
      if (!x.todo_el_dia && y.todo_el_dia) return 1;
      return String(x.hora_inicio || "").localeCompare(String(y.hora_inicio || ""));
    }));
    return m;
  }, [actividadesVista]);

  const cotizacionOptions = useMemo(
    () => cotizaciones.map((c) => ({
      value: c.id,
      label: `${c.id_licitacion || c.id} · ${c.nombre || c.nombre_entidad || "—"}`,
      rut: (c.rut_entidad || "").trim(),
      nombre_entidad: (c.nombre_entidad || "").trim(),
    })),
    [cotizaciones],
  );

  const kpis = useMemo(() => {
    const total = actividadesVista.length;
    const realizadas = actividadesVista.filter((a) => a.estado === "realizada").length;
    const pendientes = total - realizadas;
    const porTipo = {};
    const porUsuario = {};
    const porMotivo = {};
    actividadesVista.forEach((a) => {
      porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1;
      const uk = a.user_email || "—";
      porUsuario[uk] = porUsuario[uk] || { nombre: a.user_nombre || uk, n: 0 };
      porUsuario[uk].n += 1;
      if (a.motivo) porMotivo[a.motivo] = (porMotivo[a.motivo] || 0) + 1;
    });
    const pct = total > 0 ? Math.round((realizadas / total) * 100) : 0;
    return {
      total, pendientes, realizadas, pct,
      porTipo: Object.entries(porTipo).sort((a, b) => b[1] - a[1]),
      porUsuario: Object.entries(porUsuario).map(([email, v]) => ({ email, ...v })).sort((a, b) => b.n - a.n),
      porMotivo: Object.entries(porMotivo).sort((a, b) => b[1] - a[1]),
    };
  }, [actividadesVista]);

  // ── Dashboard: KPIs superiores, paneles laterales y mini-stats ──────────
  const dash = useMemo(() => {
    const h = new Date(); h.setHours(0, 0, 0, 0);
    const hoyKey = ymd(h);
    const mes = h.getMonth(), anio = h.getFullYear();
    const enMes = (k) => { const d = parseYMD(k); return d.getMonth() === mes && d.getFullYear() === anio; };

    // Clientes
    const clientesActivos = clientes.filter((c) => c.activo !== false && c.estado !== "inactivo").length;

    // Cotizaciones
    const term = new Set(["adjudicada", "perdida", "descartada"]);
    let enProceso = 0, adjudicadas = 0, pendientesAprob = 0, totalCot = 0;
    cotizaciones.forEach((c) => {
      const e = String(c.estado || "").toLowerCase().trim();
      totalCot += 1;
      if (e === "adjudicada") adjudicadas += 1;
      if (!term.has(e)) enProceso += 1;
      if (e.includes("pendiente")) pendientesAprob += 1;
    });
    const conversion = totalCot > 0 ? Math.round((adjudicadas / totalCot) * 100) : 0;

    // Actividades (ventana fija)
    const orden = (a) => `${String(a.fecha).slice(0, 10)} ${a.todo_el_dia ? "00:00" : (a.hora_inicio || "99:99")}`;
    const visitasHoy = metricasVista.filter((a) => a.tipo === "visita" && String(a.fecha).slice(0, 10) === hoyKey).length;
    const visitasRealizadasMes = metricasVista.filter((a) => a.tipo === "visita" && a.estado === "realizada" && enMes(String(a.fecha).slice(0, 10))).length;
    const visitasProgramadasMes = metricasVista.filter((a) => a.tipo === "visita" && enMes(String(a.fecha).slice(0, 10))).length;
    const realizadasMes = metricasVista.filter((a) => a.estado === "realizada" && enMes(String(a.fecha).slice(0, 10))).length;
    const programadasMes = metricasVista.filter((a) => enMes(String(a.fecha).slice(0, 10))).length;
    const vencidas = metricas
      .filter((a) => a.estado !== "realizada" && String(a.fecha).slice(0, 10) < hoyKey)
      .sort((x, y) => orden(y).localeCompare(orden(x)))
      .slice(0, 8);
    const proximas = metricas
      .filter((a) => a.estado !== "realizada" && String(a.fecha).slice(0, 10) >= hoyKey)
      .sort((x, y) => orden(x).localeCompare(orden(y)))
      .slice(0, 6);
    const tareasPendientes = metricas
      .filter((a) => a.estado !== "realizada" && (a.tipo === "tarea" || a.tipo === "seguimiento"))
      .sort((x, y) => orden(x).localeCompare(orden(y)))
      .slice(0, 6);

    const metaPct = visitasProgramadasMes > 0 ? Math.round((visitasRealizadasMes / visitasProgramadasMes) * 100) : 0;
    const pendientesMes = Math.max(0, programadasMes - realizadasMes);
    const metaCumplimiento = programadasMes > 0 ? Math.round((realizadasMes / programadasMes) * 100) : 0;

    return {
      clientesActivos, enProceso, adjudicadas, pendientesAprob, conversion,
      visitasHoy, visitasRealizadasMes, visitasProgramadasMes, realizadasMes, programadasMes,
      pendientesMes, metaCumplimiento,
      vencidas, proximas, tareasPendientes, metaPct,
    };
  }, [clientes, cotizaciones, metricasVista]);

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
      let r = null;
      if (form.id) {
        r = await api.put(`/actividades/${form.id}`, form);
        if (r?._meet_error) {
          setToast({ type: "error", message: r._meet_error });
        } else if (r?._meet_generado) {
          setToast({ type: "success", message: "Enlace de Google Meet generado." });
        } else {
          setToast({ type: "success", message: "Actividad actualizada." });
        }
      } else {
        r = await api.post("/actividades", form);
        if (r?._meet_error) {
          setToast({ type: "error", message: r._meet_error });
        } else if (r?._meet_generado) {
          setToast({ type: "success", message: "Reunión creada con Google Meet." });
        } else {
          setToast({ type: "success", message: "Actividad registrada." });
        }
      }
      // Si se generó un Meet, dejamos el modal abierto para mostrar/copiar la URL.
      // En ese caso adoptamos el id devuelto para que un nuevo guardado sea una
      // EDICIÓN (PUT) y no reintente crear el Meet (evita duplicados/errores).
      if (r?.id) setModal((m) => (m ? { ...m, id: r.id, meet_url: r.meet_url ?? m.meet_url } : m));
      if (!r?._meet_generado) setModal(null);
      // El modal se cierra AL TIRO; las recargas siguen en segundo plano sin
      // vaciar el calendario (pedido 2026-09-04: se sentía lento al crear).
      cargar({ silencioso: true });
      cargarMetricas();
      if (verTodas) {
        api.get("/actividades/usuarios").then((u) => setUsuarios(Array.isArray(u) ? u : [])).catch(() => {});
      }
      return r;
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar la actividad." });
      return null;
    }
  }

  // Creación rápida de cliente desde el modal de actividad. Devuelve el cliente
  // creado y lo agrega a la lista local para que quede seleccionable al instante.
  async function crearClienteRapido(payload) {
    const nuevo = await api.post("/clientes/rapido", payload);
    if (nuevo?.id != null) setClientes((prev) => [...prev, nuevo]);
    return nuevo;
  }

  async function eliminar(a) {
    try {
      await api.delete(`/actividades/${a.id}`);
      setToast({ type: "success", message: "Actividad eliminada." });
      setConfirmDel(null);
      setModal(null);
      cargar();
      cargarMetricas();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  async function alternarEstado(a) {
    const nuevo = a.estado === "realizada" ? "pendiente" : "realizada";
    // Optimista.
    setActividades((prev) => prev.map((x) => x.id === a.id ? { ...x, estado: nuevo } : x));
    setMetricas((prev) => prev.map((x) => x.id === a.id ? { ...x, estado: nuevo } : x));
    try {
      await api.put(`/actividades/${a.id}`, { estado: nuevo });
    } catch {
      setActividades((prev) => prev.map((x) => x.id === a.id ? { ...x, estado: a.estado } : x));
      setMetricas((prev) => prev.map((x) => x.id === a.id ? { ...x, estado: a.estado } : x));
      setToast({ type: "error", message: "No se pudo cambiar el estado." });
    }
  }

  // Mover una actividad a otro día (drag & drop, estilo Google Calendar).
  async function moverActividad(id, nuevaFecha) {
    const a = actividades.find((x) => String(x.id) === String(id));
    if (!a || !nuevaFecha) return;
    const fechaAnterior = String(a.fecha).slice(0, 10);
    if (fechaAnterior === nuevaFecha) return;
    // Optimista en ambas colecciones.
    setActividades((prev) => prev.map((x) => x.id === a.id ? { ...x, fecha: nuevaFecha } : x));
    setMetricas((prev) => prev.map((x) => x.id === a.id ? { ...x, fecha: nuevaFecha } : x));
    try {
      await api.put(`/actividades/${a.id}`, { fecha: nuevaFecha });
      cargarMetricas();
    } catch (e) {
      // Revertir si falla (p. ej. sin permiso para editar la de otro usuario).
      setActividades((prev) => prev.map((x) => x.id === a.id ? { ...x, fecha: fechaAnterior } : x));
      setMetricas((prev) => prev.map((x) => x.id === a.id ? { ...x, fecha: fechaAnterior } : x));
      setToast({ type: "error", message: e?.message || "No se pudo mover la actividad." });
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
          <p className="page-subtitle">Gestiones y actividades por cliente · {verTodas ? "vista global" : "tu agenda"}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => abrirNueva()}>
          <Plus size={15} /> Nueva actividad
        </button>
      </div>

      {/* KPIs superiores (datos reales) */}
      <div className="bitacora-kpis">
        <KpiTop icon={ClipboardCheck} color="#7c3aed" label="Visitas programadas" value={dash.visitasHoy} sub="hoy" />
        <KpiTop icon={CalendarDays} color="#2563eb" label="Actividades del mes" value={dash.programadasMes} sub="programadas" />
        <KpiTop icon={CalendarCheck} color="#16a34a" label="Realizadas" value={dash.realizadasMes} sub={`${dash.metaCumplimiento}% de cumplimiento`} />
        <KpiTop icon={Clock} color="#f59e0b" label="Pendientes" value={dash.pendientesMes} sub="por realizar este mes" />
        <KpiTop icon={AlertCircle} color="#dc2626" label="Alertas" value={dash.vencidas.length} sub="requieren atención" />
      </div>

      {/* Barra de control: navegación + vistas */}
      <div className="surface bitacora-controlbar" style={{ padding: 12, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navegar(-1)} title="Anterior"><ChevronLeft size={16} /></button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={hoy}>Hoy</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navegar(1)} title="Siguiente"><ChevronRight size={16} /></button>
          <strong style={{ fontSize: 15, marginLeft: 6, textTransform: "capitalize" }}>{tituloPeriodo}</strong>
        </div>
        <div className="bitacora-vistas" style={{ display: "flex", gap: 4, background: "var(--bg)", padding: 3, borderRadius: 8 }}>
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
          <label className="filter-label"><Filter size={11} style={{ marginRight: 4 }} />Acción</label>
          <Combo
            value={filtroTipo}
            onChange={setFiltroTipo}
            isSearchable={false}
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...TIPOS.map((t) => ({ value: t.value, label: t.label }))]}
          />
        </div>
        <div className="filter-field" style={{ minWidth: 180 }}>
          <label className="filter-label"><Filter size={11} style={{ marginRight: 4 }} />Tipo de cliente</label>
          <Combo
            value={filtroTipoCliente}
            onChange={(v) => { setFiltroTipoCliente(v || ""); setFiltroCliente(""); }}
            isSearchable={false}
            isClearable
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...tiposClienteDisponibles.map((t) => ({ value: t, label: t }))]}
          />
        </div>
        <div className="filter-field" style={{ minWidth: 240 }}>
          <label className="filter-label">Cliente</label>
          <Combo
            value={filtroCliente}
            onChange={setFiltroCliente}
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...clienteOptionsFiltro]}
          />
        </div>
        <div className="filter-field" style={{ minWidth: 200 }}>
          <label className="filter-label"><Filter size={11} style={{ marginRight: 4 }} />Motivo</label>
          <Combo
            value={filtroMotivo}
            onChange={(v) => setFiltroMotivo(v || "")}
            isSearchable={false}
            isClearable
            placeholder="Todos"
            options={[{ value: "", label: "Todos" }, ...MOTIVOS.map((m) => ({ value: m, label: m }))]}
          />
        </div>
        {verTodas && (
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

      {/* Leyenda de tipos + usuarios (admin) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        {TIPOS.map((t) => (
          <span key={t.value} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: t.color }} /> {t.label}
          </span>
        ))}
        {mostrarUsuario && kpis.porUsuario.length > 0 && (
          <span style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
        )}
        {mostrarUsuario && kpis.porUsuario.map((u) => (
          <span key={u.email} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorUsuario(u.email) }} /> {u.nombre}
          </span>
        ))}
      </div>

      {/* Calendario a todo el ancho */}
      <div style={{ minWidth: 0 }}>
        {loading ? (
          <div className="surface" style={{ padding: "40px 24px", color: "var(--text-muted)" }}>Cargando actividades…</div>
        ) : vista === "mes" ? (
          <VistaMes ancla={ancla} porFecha={porFecha} hoyDate={hoyDate} onNuevo={abrirNueva} onEditar={abrirEditar} onMover={moverActividad} mostrarUsuario={mostrarUsuario} />
        ) : vista === "semana" ? (
          <VistaSemana ancla={ancla} porFecha={porFecha} hoyDate={hoyDate} onNuevo={abrirNueva} onEditar={abrirEditar} onMover={moverActividad} mostrarUsuario={mostrarUsuario} />
        ) : vista === "dia" ? (
          <VistaDia ancla={ancla} porFecha={porFecha} onNuevo={abrirNueva} onEditar={abrirEditar} onToggle={alternarEstado} mostrarUsuario={mostrarUsuario} />
        ) : (
          <VistaAgenda actividades={actividadesVista} onEditar={abrirEditar} onToggle={alternarEstado} esAdmin={esAdmin} mostrarUsuario={mostrarUsuario} />
        )}
      </div>

      {/* Paneles (debajo del calendario, en columnas) */}
      <div className="bitacora-paneles">
        <PanelActividades titulo="Próximas actividades" icon={CalendarClock} items={dash.proximas} onEditar={abrirEditar} vacio="Sin actividades próximas." />
        <PanelActividades titulo="Tareas pendientes" icon={ListChecks} items={dash.tareasPendientes} onEditar={abrirEditar} onToggle={alternarEstado} checkable vacio="Sin tareas pendientes." />
        <PanelActividades titulo="Alertas importantes" icon={Bell} items={dash.vencidas} onEditar={abrirEditar} tono="danger" vacio="Sin alertas. Todo al día." />
        {verTodas && (
          <div className="surface" style={{ padding: 14 }}>
            <ResumenLista titulo="Por usuario" icon={User} items={kpis.porUsuario.map((u) => ({ label: u.nombre, n: u.n, color: colorUsuario(u.email) }))} vacio="Sin actividad" />
          </div>
        )}
      </div>

      {modal && (
        <ModalActividad
          inicial={modal}
          clienteOptions={clienteOptions}
          cotizacionOptions={cotizacionOptions}
          perfiles={perfiles}
          miEmail={(user?.email || "").toLowerCase()}
          onCancel={() => setModal(null)}
          onSave={guardar}
          onDelete={(a) => setConfirmDel(a)}
          onCrearCliente={crearClienteRapido}
        />
      )}
    </div>
  );
}

/* ── Chip de actividad ────────────────────────────────────────────────── */
function Chip({ a, onClick, compact, mostrarUsuario, draggable }) {
  const color = colorTipo(a.tipo);
  const hecha = a.estado === "realizada";
  const cu = colorUsuario(a.user_email);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(a); }}
      draggable={draggable}
      onDragStart={draggable ? (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("text/plain", String(a.id));
        e.dataTransfer.effectAllowed = "move";
      } : undefined}
      title={`${labelTipo(a.tipo)}${a.hora_inicio ? ` · ${fmtHora(a.hora_inicio)}` : ""} · ${a.titulo}${a.cliente_nombre ? ` · ${a.cliente_nombre}` : ""}${mostrarUsuario ? ` · ${a.user_nombre || a.user_email}` : ""}${draggable ? " · arrastra para mover de día" : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 5, width: "100%",
        background: `${color}14`, borderLeft: `3px solid ${color}`, border: "none",
        borderRadius: 5, padding: compact ? "2px 6px" : "4px 7px", cursor: draggable ? "grab" : "pointer",
        textAlign: "left", opacity: hecha ? 0.6 : 1,
      }}
    >
      {mostrarUsuario && (
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: cu, flexShrink: 0 }} />
      )}
      {a.hora_inicio && !a.todo_el_dia && (
        <span style={{ fontSize: 10, fontWeight: 700, color, flexShrink: 0 }}>{fmtHora(a.hora_inicio)}</span>
      )}
      <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: hecha ? "line-through" : "none" }}>
        {a.titulo}{a.cliente_nombre ? ` - ${a.cliente_nombre}` : ""}
      </span>
    </button>
  );
}

/* ── Lista de resumen (KPIs admin) ────────────────────────────────────── */
function ResumenLista({ titulo, icon: Icon, items, vacio }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--text-soft)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
        {Icon && <Icon size={13} />} {titulo}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{vacio || "Sin datos"}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              <strong style={{ color: "var(--text)" }}>{it.n}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── KPI superior (ícono circular de color) ───────────────────────────── */
function KpiTop({ icon: Icon, color, label, value, sub }) {
  return (
    <div className="surface bitacora-kpi">
      <div style={{ width: 46, height: 46, borderRadius: "50%", background: `${color}1a`, color, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon size={22} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label" style={{ marginBottom: 1 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.05, color: "var(--text)" }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--text-soft)" }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ── Panel lateral: lista de actividades (próximas / tareas / alertas) ──── */
function PanelActividades({ titulo, icon: Icon, items, onEditar, onToggle, checkable, tono, vacio }) {
  const acento = tono === "danger" ? "#dc2626" : "var(--primary-dark)";
  return (
    <div className="surface" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: acento, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 10 }}>
        {Icon && <Icon size={14} />} {titulo}
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: tono === "danger" ? "#dc2626" : "var(--text-muted)", background: tono === "danger" ? "#fee2e2" : "var(--bg)", borderRadius: 999, padding: "1px 8px" }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 0" }}>{vacio || "Sin elementos"}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((a) => {
            const color = colorTipo(a.tipo);
            const f = parseYMD(String(a.fecha).slice(0, 10));
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const esHoy = mismaFecha(f, hoy);
            const etiquetaFecha = esHoy ? "Hoy" : `${DIAS[(f.getDay() + 6) % 7]} ${f.getDate()} ${MESES[f.getMonth()].slice(0, 3)}`;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 9px", border: "1px solid var(--border)", borderRadius: 9, borderLeft: `3px solid ${tono === "danger" ? "#dc2626" : color}`, cursor: "pointer" }}>
                {checkable && onToggle && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(a); }} title="Marcar realizada"
                    style={{ marginTop: 1, width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--border)", background: "transparent", cursor: "pointer", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => onEditar(a)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.titulo}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, fontSize: 11.5, color: tono === "danger" ? "#b91c1c" : "var(--text-muted)" }}>
                    <span style={{ fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{etiquetaFecha}</span>
                    {!a.todo_el_dia && a.hora_inicio && <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{fmtHora(a.hora_inicio)}</span>}
                    {a.cliente_nombre && <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {a.cliente_nombre}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Vista Mes ────────────────────────────────────────────────────────── */
function VistaMes({ ancla, porFecha, hoyDate, onNuevo, onEditar, onMover, mostrarUsuario }) {
  const ini = lunesDe(new Date(ancla.getFullYear(), ancla.getMonth(), 1));
  const dias = Array.from({ length: 42 }, (_, i) => addDays(ini, i));
  const [sobre, setSobre] = useState(null); // día resaltado durante el arrastre
  return (
    <div className="surface" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        {/* Grilla única (cabecera + días) con líneas de 1px nítidas y consistentes
            en cualquier ancho: gap de 1px sobre un fondo del color del borde. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1, background: "var(--border)", minWidth: 620 }}>
          {DIAS.map((d) => (
            <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em", background: "var(--surface)" }}>{d}</div>
          ))}
          {dias.map((d, i) => {
            const key = ymd(d);
            const items = porFecha[key] || [];
            const otroMes = d.getMonth() !== ancla.getMonth();
            const esHoy = mismaFecha(d, hoyDate);
            const resaltado = sobre === key;
            return (
              <div
                key={i}
                onClick={() => onNuevo(d)}
                onDragOver={onMover ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (sobre !== key) setSobre(key); } : undefined}
                onDragLeave={onMover ? () => setSobre((s) => (s === key ? null : s)) : undefined}
                onDrop={onMover ? (e) => {
                  e.preventDefault();
                  setSobre(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) onMover(id, key);
                } : undefined}
                style={{
                  minHeight: 104, padding: 5, cursor: "pointer",
                  background: resaltado ? "var(--primary-light, #e6f7f7)" : otroMes ? "var(--bg)" : "var(--surface)",
                  boxShadow: resaltado ? "inset 0 0 0 2px var(--primary)" : "none",
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
                {items.slice(0, 3).map((a) => <Chip key={a.id} a={a} compact onClick={onEditar} draggable={Boolean(onMover)} mostrarUsuario={mostrarUsuario} />)}
                {items.length > 3 && (
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)", paddingLeft: 4 }}>+{items.length - 3} más</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Vista Semana ─────────────────────────────────────────────────────── */
function VistaSemana({ ancla, porFecha, hoyDate, onNuevo, onEditar, onMover, mostrarUsuario }) {
  const l = lunesDe(ancla);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(l, i));
  const [sobre, setSobre] = useState(null);
  return (
    <div className="surface" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1, background: "var(--border)", minWidth: 620 }}>
          {dias.map((d, i) => {
            const key = ymd(d);
            const items = porFecha[key] || [];
            const esHoy = mismaFecha(d, hoyDate);
            const resaltado = sobre === key;
            return (
              <div
                key={i}
                onDragOver={onMover ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (sobre !== key) setSobre(key); } : undefined}
                onDragLeave={onMover ? () => setSobre((s) => (s === key ? null : s)) : undefined}
                onDrop={onMover ? (e) => {
                  e.preventDefault();
                  setSobre(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) onMover(id, key);
                } : undefined}
                style={{
                  minHeight: 360, display: "flex", flexDirection: "column",
                  background: resaltado ? "var(--primary-light, #e6f7f7)" : "var(--surface)",
                  boxShadow: resaltado ? "inset 0 0 0 2px var(--primary)" : "none",
                }}
              >
                <div onClick={() => onNuevo(d)} style={{ padding: "8px 6px", textAlign: "center", borderBottom: "1px solid var(--border)", cursor: "pointer", background: esHoy ? "var(--primary-light, #e6f7f7)" : "transparent" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{DIAS[i]}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: esHoy ? "var(--primary-dark)" : "var(--text)" }}>{d.getDate()}</div>
                </div>
                <div onClick={() => onNuevo(d)} style={{ flex: 1, padding: 5, display: "flex", flexDirection: "column", gap: 4, cursor: "pointer" }}>
                  {items.map((a) => <Chip key={a.id} a={a} onClick={onEditar} draggable={Boolean(onMover)} mostrarUsuario={mostrarUsuario} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Vista Día ────────────────────────────────────────────────────────── */
function VistaDia({ ancla, porFecha, onNuevo, onEditar, onToggle, mostrarUsuario }) {
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
          {items.map((a) => <FilaActividad key={a.id} a={a} onEditar={onEditar} onToggle={onToggle} mostrarUsuario={mostrarUsuario} />)}
        </div>
      )}
    </div>
  );
}

/* ── Vista Agenda (lista agrupada por día) ────────────────────────────── */
function VistaAgenda({ actividades, onEditar, onToggle, esAdmin, mostrarUsuario }) {
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
            {items.map((a) => <FilaActividad key={a.id} a={a} onEditar={onEditar} onToggle={onToggle} mostrarUsuario={mostrarUsuario} />)}
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
          {a.motivo && (
            <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--primary-dark)", background: "var(--primary-light)", padding: "1px 7px", borderRadius: 999 }}>{a.motivo}</span>
          )}
          {!a.todo_el_dia && a.hora_inicio && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: "var(--text-muted)" }}>
              <Clock size={11} /> {fmtHora(a.hora_inicio)}{a.hora_fin ? `–${fmtHora(a.hora_fin)}` : ""}
            </span>
          )}
          {a.todo_el_dia && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Todo el día</span>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginTop: 3, textDecoration: hecha ? "line-through" : "none" }}>{a.titulo}</div>
        {a.cliente_nombre && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 1 }}>👤 {a.cliente_nombre}</div>}
        {a.licitacion_id && (
          <div style={{ fontSize: 12, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
            <Link to={`/detalle/${a.licitacion_id}`} style={{ color: "var(--primary-dark)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <FileSignature size={11} /> Cotización asociada
            </Link>
          </div>
        )}
        {Array.isArray(a.participantes) && a.participantes.length > 1 && (
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Users size={11} /> {a.participantes.map((p) => p.nombre || p.email).join(", ")}
          </div>
        )}
        {a.meet_url && (
          <div style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
            <a href={a.meet_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#1a73e8", textDecoration: "none" }}>
              <Video size={12} /> Unirse a Google Meet
            </a>
          </div>
        )}
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
        {mostrarUsuario && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorUsuario(a.user_email) }} />
            Registrada por {a.user_nombre || a.user_email}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Modal crear / editar actividad ───────────────────────────────────── */
function ModalActividad({ inicial, clienteOptions, cotizacionOptions, perfiles, miEmail, onCancel, onSave, onDelete, onCrearCliente }) {
  const [titulo, setTitulo] = useState(inicial.titulo || "");
  const [tipo, setTipo] = useState(inicial.tipo || "gestion");
  const [motivo, setMotivo] = useState(inicial.motivo || "");
  const [clienteId, setClienteId] = useState(inicial.cliente_id ?? null);
  const [errorForm, setErrorForm] = useState(""); // validación visible (no retorno silencioso)
  const [filtroTipoCli, setFiltroTipoCli] = useState(""); // filtra el selector de cliente por tipo
  // Alta rápida de cliente desde el modal.
  const [nuevoCli, setNuevoCli] = useState(false);
  // Cliente nuevo desde bitácora: por defecto Cliente Particular (obligatorio).
  const [nc, setNc] = useState({ nombre: "", rut: "", email: "", telefono: "", region: "", comuna: "", direccion: "", oficina: "", tipo_cliente: "Cliente Particular" });
  const [ncGuardando, setNcGuardando] = useState(false);
  const [ncError, setNcError] = useState("");

  async function guardarNuevoCliente() {
    const nombre = nc.nombre.trim();
    if (!nombre) { setNcError("El nombre es obligatorio."); return; }
    if (!nc.tipo_cliente) { setNcError("El tipo de cliente es obligatorio."); return; }
    setNcGuardando(true);
    setNcError("");
    try {
      const creado = await onCrearCliente({
        nombre,
        rut: nc.rut.trim(),
        email: nc.email.trim(),
        telefono: nc.telefono.trim(),
        region: nc.region.trim(),
        comuna: nc.comuna.trim(),
        direccion: nc.direccion.trim(),
        oficina: nc.oficina.trim(),
        tipo_cliente: nc.tipo_cliente || null,
      });
      if (creado?.id != null) {
        setClienteId(creado.id);
        setLicitacionId("");
        setNuevoCli(false);
        // Un cliente recién creado desde la bitácora entra como Prospecto.
        setTipo("prospecto");
        setMotivo((m) => (MOTIVOS_PROSPECTO.includes(m) ? m : ""));
        setNc({ nombre: "", rut: "", email: "", telefono: "", region: "", comuna: "", direccion: "", oficina: "", tipo_cliente: "Cliente Particular" });
      }
    } catch (e) {
      setNcError(e?.message || "No se pudo crear el cliente.");
    } finally {
      setNcGuardando(false);
    }
  }
  const [licitacionId, setLicitacionId] = useState(inicial.licitacion_id ?? "");
  const [participantes, setParticipantes] = useState(
    Array.isArray(inicial.participantes)
      ? inicial.participantes.filter((p) => String(p.email || "").toLowerCase() !== String(miEmail || "").toLowerCase())
      : [],
  );
  // Google Meet: solo al crear una reunión nueva (si aún no tiene enlace).
  const [crearMeet, setCrearMeet] = useState(!inicial.id && !inicial.meet_url);
  const [meetCreado, setMeetCreado] = useState(""); // URL del Meet recién creado
  const [copiado, setCopiado] = useState(false);

  async function copiarMeet(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* */ }
  }
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
  // Para jer.consorcio la bitácora funciona como Google Calendar (2026-08-13):
  // puede crear actividades sueltas (personales/internas) sin asociar cliente.
  // Para el resto el cliente sigue siendo obligatorio, porque sus actividades
  // alimentan la productividad comercial por cliente.
  const clienteOpcional = String(miEmail || "").toLowerCase() === "jer.consorcio@gmail.com";

  // Filtro de tipo de cliente para acotar el selector de cliente del modal.
  const tiposClienteModal = useMemo(() => {
    const s = new Set();
    (clienteOptions || []).forEach((c) => { const t = (c.tipo || "").trim(); if (t) s.add(t); });
    return [...s].sort();
  }, [clienteOptions]);
  const clienteOptionsModal = useMemo(
    () => (filtroTipoCli ? (clienteOptions || []).filter((c) => (c.tipo || "") === filtroTipoCli) : clienteOptions),
    [clienteOptions, filtroTipoCli],
  );

  // Cotizaciones del cliente seleccionado (match por RUT normalizado o por
  // nombre). Si hay un cliente elegido, se muestran SOLO sus cotizaciones
  // (aunque no haya ninguna); sin cliente se ofrecen todas.
  const cotizacionesFiltradas = useMemo(() => {
    const todas = cotizacionOptions || [];
    if (!clienteSel) return todas;
    const normRut = (v) => String(v || "").toLowerCase().replace(/[.\-\s]/g, "");
    const rut = normRut(clienteSel.rut);
    const nombre = String(clienteSel.nombre || "").trim().toLowerCase();
    return todas.filter((c) => {
      const cRut = normRut(c.rut);
      const cNombre = String(c.nombre_entidad || "").trim().toLowerCase();
      if (rut && cRut && cRut === rut) return true;
      if (nombre && cNombre && (cNombre.includes(nombre) || nombre.includes(cNombre))) return true;
      return false;
    });
  }, [cotizacionOptions, clienteSel]);

  const participanteOptions = useMemo(
    () => (perfiles || [])
      .filter((p) => p?.email && String(p.email).toLowerCase() !== String(miEmail || "").toLowerCase())
      .map((p) => ({ value: (p.email || "").toLowerCase(), label: p.nombre || p.email, nombre: p.nombre || p.email })),
    [perfiles, miEmail],
  );
  // Valor del selector construido desde el estado, para reflejar también los
  // invitados EXTERNOS (correos escritos a mano, que no están en la lista).
  const participantesSel = participantes.map((p) => {
    const email = String(p.email || "").toLowerCase();
    const externo = !participanteOptions.some((o) => o.value === email);
    return { value: email, label: externo ? email : (p.nombre || email), nombre: p.nombre || email, externo };
  });

  async function submit(e) {
    e.preventDefault();
    // Avisos explícitos: antes el submit retornaba en silencio y el usuario
    // creía haber guardado (típico en actividades automáticas sin cliente).
    if (!titulo.trim()) { setErrorForm("Falta el título de la actividad."); return; }
    if (!clienteSel && !clienteOpcional) { setErrorForm("Selecciona el cliente para poder guardar."); return; }
    setErrorForm("");
    setGuardando(true);
    const form = {
      id: inicial.id,
      titulo: titulo.trim(),
      tipo,
      motivo: motivo || null,
      cliente_id: clienteSel?.value ?? null,
      cliente_nombre: clienteSel?.nombre ?? null,
      licitacion_id: licitacionId || null,
      participantes: tipo === "reunion" ? participantes : [],
      crear_meet: tipo === "reunion" && !inicial.meet_url ? crearMeet : false,
      fecha,
      todo_el_dia: todoDia,
      hora_inicio: todoDia ? null : (horaIni || null),
      hora_fin: todoDia ? null : (horaFin || null),
      comentario: comentario.trim(),
      estado,
      adjuntos,
    };
    const res = await onSave(form);
    setGuardando(false);
    if (res?._meet_generado && res?.meet_url) setMeetCreado(res.meet_url);
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <form onSubmit={submit} style={{ width: 440, maxWidth: "100%", maxHeight: "88vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
          <strong style={{ fontSize: 15 }}>{inicial.id ? "Editar actividad" : "Nueva actividad"}</strong>
          <button type="button" onClick={onCancel} className="btn btn-ghost" style={{ padding: 6 }}><X size={18} /></button>
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
          {(meetCreado || inicial.meet_url) && (
            <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #bae6fd", background: "#f0f9ff" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#0369a1", marginBottom: 8 }}>
                <Video size={15} /> {meetCreado ? "Reunión creada · enlace de Google Meet" : "Enlace de Google Meet"}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="input" readOnly value={meetCreado || inicial.meet_url} onFocus={(e) => e.target.select()} style={{ flex: 1, fontSize: 12.5 }} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => copiarMeet(meetCreado || inicial.meet_url)} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                  {copiado ? <><Check size={13} /> Copiado</> : <>Copiar</>}
                </button>
                <a href={meetCreado || inicial.meet_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ whiteSpace: "nowrap" }}>Abrir</a>
              </div>
            </div>
          )}

          {/* Cliente primero: seleccionar existente o crear uno nuevo. */}
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label className="field-label">
                Cliente {clienteOpcional
                  ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span>
                  : <span style={{ color: "var(--danger)" }}>*</span>}
              </label>
              <button
                type="button"
                onClick={() => { setNuevoCli((v) => !v); setNcError(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: 12, fontWeight: 600, padding: 0 }}
              >
                {nuevoCli ? "Cancelar" : "+ Nuevo cliente"}
              </button>
            </div>
            {!nuevoCli && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {tiposClienteModal.length > 1 && (
                  <select
                    className="input"
                    value={filtroTipoCli}
                    onChange={(e) => { setFiltroTipoCli(e.target.value); setClienteId(null); setLicitacionId(""); }}
                    style={{ fontSize: 12.5 }}
                  >
                    <option value="">Todos los tipos de cliente</option>
                    {tiposClienteModal.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <Combo
                  value={clienteId ?? ""}
                  onChange={(v) => { setClienteId(v || null); setLicitacionId(""); }}
                  placeholder="Selecciona un cliente…"
                  options={clienteOptionsModal}
                />
              </div>
            )}
            {nuevoCli && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 8 }}>
                <input className="input" placeholder="Nombre del cliente *" value={nc.nombre} onChange={(e) => setNc((p) => ({ ...p, nombre: e.target.value }))} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input className="input" placeholder="RUT (opcional)" value={nc.rut} onChange={(e) => setNc((p) => ({ ...p, rut: e.target.value }))} />
                  <select className="input" value={nc.tipo_cliente} onChange={(e) => setNc((p) => ({ ...p, tipo_cliente: e.target.value }))}>
                    <option value="Cliente Particular">Cliente Particular</option>
                    <option value="Entidad Pública">Entidad Pública</option>
                  </select>
                  <input className="input" placeholder="Email (opcional)" value={nc.email} onChange={(e) => setNc((p) => ({ ...p, email: e.target.value }))} />
                  <input className="input" placeholder="Teléfono (opcional)" value={nc.telefono} onChange={(e) => setNc((p) => ({ ...p, telefono: e.target.value }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <select className="input" value={nc.region} onChange={(e) => setNc((p) => ({ ...p, region: e.target.value, comuna: "" }))}>
                    <option value="">Región (opcional)</option>
                    {Object.keys(REGIONES_CHILE).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select className="input" value={nc.comuna} disabled={!nc.region} onChange={(e) => setNc((p) => ({ ...p, comuna: e.target.value }))}>
                    <option value="">{nc.region ? "Comuna (opcional)" : "Elige región primero"}</option>
                    {nc.region && (REGIONES_CHILE[nc.region] || []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <input className="input" placeholder="Dirección (opcional)" value={nc.direccion} onChange={(e) => setNc((p) => ({ ...p, direccion: e.target.value }))} />
                <input className="input" placeholder="Oficina / sucursal (opcional)" value={nc.oficina} onChange={(e) => setNc((p) => ({ ...p, oficina: e.target.value }))} />
                <div className="field-hint" style={{ margin: 0 }}>
                  Sin RUT se guarda como <strong>cliente transitorio</strong> (a completar luego). Con RUT y datos de contacto queda como cliente normal.
                </div>
                {ncError && <div style={{ color: "var(--danger)", fontSize: 12 }}>{ncError}</div>}
                <div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={guardarNuevoCliente} disabled={ncGuardando || !nc.nombre.trim()}>
                    {ncGuardando ? "Guardando…" : "Crear y seleccionar"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="field">
            <label className="field-label">Título <span style={{ color: "var(--danger)" }}>*</span></label>
            <input type="text" className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: Llamada de seguimiento" disabled={!!meetCreado} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label className="field-label">Acción</label>
              <Combo
                value={tipo}
                onChange={(v) => {
                  const nt = v || "otro";
                  setTipo(nt);
                  // Al cambiar de/hacia Prospecto, si el motivo actual no aplica
                  // al nuevo tipo, se limpia para evitar motivos inconsistentes.
                  const permitidos = nt === "prospecto" ? MOTIVOS_PROSPECTO : MOTIVOS_GENERAL;
                  if (motivo && !permitidos.includes(motivo)) setMotivo("");
                }}
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
            <label className="field-label">{tipo === "prospecto" ? "Origen del prospecto" : "Motivo"}</label>
            <Combo
              value={motivo}
              onChange={(v) => setMotivo(v || "")}
              isSearchable={false}
              isClearable
              placeholder={tipo === "prospecto" ? "Mapeo / Visita espontánea / Referido" : "Sin motivo"}
              options={(tipo === "prospecto" ? MOTIVOS_PROSPECTO : MOTIVOS_GENERAL).map((m) => ({ value: m, label: m }))}
            />
          </div>

          <div className="field">
            <label className="field-label">Cotización asociada</label>
            <Combo
              value={licitacionId ?? ""}
              onChange={(v) => setLicitacionId(v || "")}
              isClearable
              placeholder={
                !clienteSel
                  ? "Selecciona primero un cliente"
                  : cotizacionesFiltradas.length
                    ? "Opcional · cotizaciones del cliente"
                    : "Este cliente no tiene cotizaciones"
              }
              options={cotizacionesFiltradas}
            />
          </div>

          {tipo === "reunion" && (
            <div className="field">
              <label className="field-label">Participantes</label>
              <CreatableSelect
                isMulti
                classNamePrefix="rs"
                value={participantesSel}
                onChange={(arr) => setParticipantes((arr || []).map((o) => {
                  const email = String(o.value || "").toLowerCase();
                  const interno = participanteOptions.some((p) => p.value === email);
                  return { email, nombre: o.nombre || (interno ? o.label : email), externo: !interno };
                }))}
                options={participanteOptions}
                placeholder="Agrega usuarios o escribe un correo externo…"
                noOptionsMessage={() => "Escribe un correo para invitar a un externo"}
                // Solo permite crear (invitar) correos válidos.
                isValidNewOption={(input) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input || "").trim())}
                formatCreateLabel={(input) => `Invitar externo: ${input}`}
                menuPortalTarget={typeof document !== "undefined" ? document.body : undefined}
                menuPosition="fixed"
                styles={comboStyles}
                theme={comboTheme}
              />
              <div className="field-hint">Usuarios internos quedan agendados en su bitácora; los correos externos solo reciben la invitación al Meet.</div>
            </div>
          )}

          {tipo === "reunion" && !inicial.meet_url && !meetCreado && (
            <div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-soft)", fontWeight: 500, cursor: "pointer" }}>
                <input type="checkbox" checked={crearMeet} onChange={(e) => setCrearMeet(e.target.checked)} />
                <Video size={15} /> {inicial.id ? "Generar Google Meet" : "Crear Google Meet"} (usa tu cuenta conectada en «Mi Correo»)
              </label>
              {crearMeet && <div className="field-hint">El enlace del Meet se generará al guardar y aparecerá aquí mismo para copiarlo.</div>}
            </div>
          )}

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
            <textarea className="input" value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Detalle de la gestión, acuerdos, próximos pasos…" style={{ resize: "vertical", fontFamily: "inherit", height: "auto", paddingTop: 8, paddingBottom: 8 }} />
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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "11px 18px", borderTop: "1px solid var(--border)", background: "var(--bg)", position: "sticky", bottom: 0 }}>
          {errorForm && (
            <span style={{ fontSize: 12.5, color: "#dc2626", fontWeight: 600 }}>{errorForm}</span>
          )}
          {inicial.id && !meetCreado ? (
            <button type="button" onClick={() => onDelete(inicial)} className="btn btn-ghost" style={{ color: "#dc2626", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Trash2 size={14} /> Eliminar
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 10 }}>
            {meetCreado ? (
              <button type="button" onClick={onCancel} className="btn btn-primary">Listo</button>
            ) : (
              <>
                <button type="button" onClick={onCancel} className="btn btn-secondary">Cancelar</button>
                <button type="submit" disabled={guardando || !titulo.trim() || (!clienteSel && !clienteOpcional)} className="btn btn-primary">
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
