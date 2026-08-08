import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, Bug, ChevronDown, ChevronRight, Clock, Gauge,
  Mail, MonitorSmartphone, Pause, Play, RefreshCw, Search, ServerCrash,
} from "lucide-react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import Toast from "../components/Toast";
import MonitorTrafico from "../components/MonitorTrafico";
import MonitorSalud from "../components/MonitorSalud";
import MonitorIssues from "../components/MonitorIssues";

/* ============================================================
   Monitoreo del Sistema — bitácora técnica EN VIVO de todo el
   stack: requests al backend (método, ruta, status, latencia),
   excepciones con stacktrace, envíos de correo y errores JS del
   navegador. Los eventos nuevos entran solos vía Supabase
   Realtime (tabla monitor_logs); solo admin.
============================================================ */

const NIVELES = {
  info:  { label: "OK",    color: "#15803d", bg: "#dcfce7" },
  warn:  { label: "Aviso", color: "#b45309", bg: "#fef3c7" },
  error: { label: "Error", color: "#b91c1c", bg: "#fee2e2" },
};

const TIPOS = {
  http:      { label: "Request" },
  excepcion: { label: "Excepción" },
  correo:    { label: "Correo" },
  frontend:  { label: "Error JS" },
  sistema:   { label: "Sistema" },
};

const fmtHora = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const hoy = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return hoy ? hora : `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })} ${hora}`;
};

const fmtMs = (v) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

function colorStatus(s) {
  if (s == null) return "var(--text-muted)";
  if (s >= 500) return "#b91c1c";
  if (s >= 400) return "#b45309";
  return "#15803d";
}

export default function MonitoreoSistema() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [nivel, setNivel] = useState("");
  const [tipo, setTipo] = useState("");
  const [buscar, setBuscar] = useState("");
  const [pausado, setPausado] = useState(false);
  const [expandido, setExpandido] = useState(null);
  const [nuevos, setNuevos] = useState(0); // llegados en vivo estando pausado
  const [conectado, setConectado] = useState(false);
  const [vista, setVista] = useState("eventos"); // eventos | problemas

  // Los filtros vigentes, accesibles desde el callback de realtime sin
  // re-suscribir el canal en cada cambio.
  const filtrosRef = useRef({ nivel, tipo, buscar, pausado });
  useEffect(() => {
    filtrosRef.current = { nivel, tipo, buscar, pausado };
  }, [nivel, tipo, buscar, pausado]);

  async function cargarLogs(filtros = {}) {
    const params = new URLSearchParams();
    const n = filtros.nivel ?? nivel;
    const t = filtros.tipo ?? tipo;
    const b = filtros.buscar ?? buscar;
    if (n) params.set("nivel", n);
    if (t) params.set("tipo", t);
    if (b.trim()) params.set("buscar", b.trim());
    params.set("limite", "300");
    const res = await api.get(`/monitor/logs?${params.toString()}`);
    setLogs(Array.isArray(res) ? res : []);
    setNuevos(0);
  }

  async function cargarStats() {
    try {
      setStats(await api.get("/monitor/stats"));
    } catch {
      /* los KPIs no son críticos */
    }
  }

  async function cargar() {
    setLoading(true);
    try {
      await Promise.all([cargarLogs(), cargarStats()]);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "Error cargando el monitoreo." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recargar la tabla al cambiar filtros (con debounce para la búsqueda).
  const primeraCarga = useRef(true);
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; return; }
    const t = setTimeout(() => cargarLogs().catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [nivel, tipo, buscar]); // eslint-disable-line react-hooks/exhaustive-deps

  // KPIs frescos cada minuto.
  useEffect(() => {
    const t = setInterval(cargarStats, 60_000);
    return () => clearInterval(t);
  }, []);

  // ── En vivo: cada INSERT en monitor_logs entra arriba de la tabla ──
  useEffect(() => {
    const canal = supabase
      .channel("monitor-logs-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "monitor_logs" },
        ({ new: fila }) => {
          const f = filtrosRef.current;
          if (f.nivel && fila.nivel !== f.nivel) return;
          if (f.tipo && fila.tipo !== f.tipo) return;
          if (f.buscar.trim()) {
            const b = f.buscar.trim().toLowerCase();
            const texto = `${fila.ruta || ""} ${fila.mensaje || ""} ${fila.usuario_email || ""}`.toLowerCase();
            if (!texto.includes(b)) return;
          }
          if (f.pausado) {
            setNuevos((n) => n + 1);
            return;
          }
          setLogs((prev) => [{ ...fila, _nuevo: true }, ...prev].slice(0, 500));
        },
      )
      .subscribe((estado) => setConectado(estado === "SUBSCRIBED"));
    return () => { supabase.removeChannel(canal); };
  }, []);

  const filas = logs;
  const hayFiltro = nivel || tipo || buscar.trim();

  const kpis = useMemo(() => {
    if (!stats) return null;
    return [
      { icon: <Activity size={17} />, tono: "#1e9295", fondo: "#e6f6f6", label: "Eventos (24 h)", valor: stats.total,
        sub: stats.latenciaProm != null ? `latencia prom. ${fmtMs(stats.latenciaProm)}` : "sin requests aún",
        onClick: () => { setNivel(""); setTipo(""); setBuscar(""); } },
      { icon: <ServerCrash size={17} />, tono: "#b91c1c", fondo: "#fee2e2", label: "Errores (24 h)", valor: stats.errores,
        sub: `${stats.warnings} avisos (4xx)`, activo: nivel === "error",
        onClick: () => setNivel((v) => (v === "error" ? "" : "error")) },
      { icon: <Mail size={17} />, tono: "#6d28d9", fondo: "#ede9fe", label: "Correos (24 h)", valor: stats.correos,
        sub: stats.correosError ? `${stats.correosError} fallidos` : "todos enviados", activo: tipo === "correo",
        onClick: () => setTipo((v) => (v === "correo" ? "" : "correo")) },
      { icon: <MonitorSmartphone size={17} />, tono: "#b45309", fondo: "#fef3c7", label: "Errores JS (24 h)", valor: stats.frontend,
        sub: "navegador y app móvil", activo: tipo === "frontend",
        onClick: () => setTipo((v) => (v === "frontend" ? "" : "frontend")) },
      { icon: <Bug size={17} />, tono: "#0f766e", fondo: "#ccfbf1", label: "Problemas activos", valor: stats.issuesActivos,
        sub: "errores agrupados sin resolver", activo: vista === "problemas",
        onClick: () => setVista((v) => (v === "problemas" ? "eventos" : "problemas")) },
    ];
  }, [stats, nivel, tipo, vista]);

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Gauge size={22} style={{ color: "var(--primary)" }} />
            Monitoreo del Sistema
            <span className="mon-vivo" style={{ background: conectado ? "#dcfce7" : "#fee2e2", color: conectado ? "#15803d" : "#b91c1c" }}>
              <span className="mon-punto" style={{ background: conectado ? "#22c55e" : "#ef4444" }} />
              {conectado ? "En vivo" : "Reconectando…"}
            </span>
          </h1>
          <p className="page-subtitle">
            Requests, errores, correos y fallas del frontend en tiempo real · se conservan {Number(import.meta.env.VITE_MONITOR_DIAS || 30)} días
          </p>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setPausado((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            {pausado ? <Play size={14} /> : <Pause size={14} />}
            {pausado ? (nuevos > 0 ? `Reanudar (${nuevos} nuevos)` : "Reanudar") : "Pausar"}
          </button>
          <button className="btn btn-primary" onClick={cargar} disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <RefreshCw size={14} className={loading ? "girando" : undefined} />
            Actualizar
          </button>
        </div>
      </div>

      {/* ── Semáforo de servicios ── */}
      <MonitorSalud />

      {/* ── KPIs (clic = filtrar) ── */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          {kpis.map((k) => (
            <div key={k.label} onClick={k.onClick} className="mon-kpi"
              style={{ borderColor: k.activo ? k.tono : "var(--border)", cursor: "pointer" }}>
              <div className="mon-kpi-icono" style={{ background: k.fondo, color: k.tono }}>{k.icon}</div>
              <div>
                <div className="mon-kpi-valor">{k.valor ?? "—"}</div>
                <div className="mon-kpi-label">{k.label}</div>
                <div className="mon-kpi-sub">{k.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tráfico: gráficos agregados ── */}
      <MonitorTrafico />

      {/* ── Pestañas: eventos crudos | problemas agrupados ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className={"mon-tab" + (vista === "eventos" ? " mon-tab-activa" : "")}
          onClick={() => setVista("eventos")}>
          <Activity size={13} /> Eventos
        </button>
        <button className={"mon-tab" + (vista === "problemas" ? " mon-tab-activa" : "")}
          onClick={() => setVista("problemas")}>
          <Bug size={13} /> Problemas{stats?.issuesActivos ? ` (${stats.issuesActivos})` : ""}
        </button>
      </div>

      {vista === "problemas" ? (
        <MonitorIssues onError={(m) => setToast({ type: "error", message: m })} />
      ) : (
      <>
      {/* ── Filtros ── */}
      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 1, minWidth: 220 }}>
          <label className="filter-label">Buscar</label>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="input" style={{ paddingLeft: 30 }} placeholder="Ruta, mensaje, correo del usuario…"
              value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </div>
        </div>
        <div className="filter-field">
          <label className="filter-label">Nivel</label>
          <select className="input" value={nivel} onChange={(e) => setNivel(e.target.value)} style={{ minWidth: 130 }}>
            <option value="">Todos</option>
            {Object.entries(NIVELES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo</label>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="mon-tabla-wrap">
        <table className="mon-tabla">
          <thead>
            <tr>
              <th style={{ width: 26 }} />
              <th style={{ width: 120 }}><Clock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Hora</th>
              <th style={{ width: 70 }}>Nivel</th>
              <th style={{ width: 90 }}>Tipo</th>
              <th>Detalle</th>
              <th style={{ width: 60, textAlign: "right" }}>Status</th>
              <th style={{ width: 80, textAlign: "right" }}>Duración</th>
              <th style={{ width: 180 }}>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="mon-vacio">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={8} className="mon-vacio">
                {hayFiltro ? "Sin eventos con estos filtros." : "Aún no hay eventos registrados. Apenas el backend reciba tráfico aparecerán aquí."}
              </td></tr>
            ) : (
              filas.map((f) => {
                const niv = NIVELES[f.nivel] || NIVELES.info;
                const abierto = expandido === f.id;
                const detalle = f.tipo === "http" || f.tipo === "excepcion"
                  ? `${f.metodo || ""} ${f.ruta || ""}${f.mensaje ? ` — ${f.mensaje}` : ""}`
                  : f.mensaje || f.ruta || "—";
                const tieneExtra = f.stack || f.metadata || f.user_agent;
                return (
                  <FragmentoFila key={f.id}>
                    <tr className={f._nuevo ? "mon-fila-nueva" : undefined}
                      onClick={() => tieneExtra && setExpandido(abierto ? null : f.id)}
                      style={{ cursor: tieneExtra ? "pointer" : "default" }}>
                      <td>{tieneExtra ? (abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)" }}>{fmtHora(f.created_at)}</td>
                      <td>
                        <span className="mon-badge" style={{ color: niv.color, background: niv.bg }}>
                          {f.nivel === "error" && <AlertTriangle size={11} style={{ marginRight: 3, verticalAlign: -1 }} />}
                          {niv.label}
                        </span>
                      </td>
                      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{TIPOS[f.tipo]?.label || f.tipo}</td>
                      <td className="mon-detalle" title={detalle}>{detalle}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: colorStatus(f.status) }}>{f.status ?? "—"}</td>
                      <td style={{ textAlign: "right", color: f.duracion_ms > 2000 ? "#b45309" : "var(--text-muted)" }}>{fmtMs(f.duracion_ms)}</td>
                      <td className="mon-detalle" style={{ fontSize: 12, color: "var(--text-muted)" }} title={f.usuario_email || ""}>
                        {f.usuario_email || "—"}
                      </td>
                    </tr>
                    {abierto && (
                      <tr className="mon-expandida">
                        <td colSpan={8}>
                          {f.mensaje && <div style={{ marginBottom: 8 }}><b>Mensaje:</b> {f.mensaje}</div>}
                          <div style={{ marginBottom: 8, fontSize: 12, color: "var(--text-muted)" }}>
                            {f.trace_id && <>Trace ID <code style={{ fontSize: 11 }}>{f.trace_id}</code> · </>}
                            {f.ip && <>IP {f.ip}</>}{f.user_agent ? ` · ${f.user_agent}` : ""}
                          </div>
                          {Array.isArray(f.metadata?.breadcrumbs) && f.metadata.breadcrumbs.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <b style={{ fontSize: 12 }}>Qué hizo el usuario antes del error:</b>
                              <div className="mon-migas">
                                {f.metadata.breadcrumbs.map((m, i) => (
                                  <div key={i} className="mon-miga">
                                    <span className="mon-miga-hora">{m.t}</span>
                                    <span className="mon-miga-tipo">{m.tipo}</span>
                                    <span>
                                      {m.tipo === "api"
                                        ? `${m.m} ${m.u} → ${m.s} (${m.ms} ms)`
                                        : m.a}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {f.metadata && Object.keys(f.metadata).filter((k) => k !== "breadcrumbs").length > 0 && (
                            <pre className="mon-pre">
                              {JSON.stringify(
                                Object.fromEntries(Object.entries(f.metadata).filter(([k]) => k !== "breadcrumbs")),
                                null, 2,
                              )}
                            </pre>
                          )}
                          {f.stack && <pre className="mon-pre mon-stack">{f.stack}</pre>}
                        </td>
                      </tr>
                    )}
                  </FragmentoFila>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
        Se muestran los últimos 300 eventos según filtros; los nuevos entran solos arriba (verde). 4xx se registran
        como aviso (validaciones, permisos); 5xx y errores JS como error, con su stacktrace al expandir la fila.
        Cada request tiene un trace ID (header <code>X-Request-Id</code>): puedes buscarlo arriba.
      </p>
      </>
      )}

      <style>{`
        .girando { animation: mon-spin 1s linear infinite; }
        @keyframes mon-spin { to { transform: rotate(360deg); } }
        .mon-vivo {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
        }
        .mon-punto { width: 7px; height: 7px; border-radius: 50%; animation: mon-pulso 1.6s ease-in-out infinite; }
        @keyframes mon-pulso { 50% { opacity: .35; } }
        .mon-kpi {
          display: flex; gap: 12px; align-items: center; background: var(--surface, #fff);
          border: 1px solid var(--border); border-radius: 12px; padding: 13px 15px;
          transition: box-shadow .15s;
        }
        .mon-kpi:hover { box-shadow: 0 2px 10px rgba(0,0,0,.07); }
        .mon-kpi-icono { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .mon-kpi-valor { font-size: 21px; font-weight: 800; line-height: 1.1; }
        .mon-kpi-label { font-size: 12.5px; font-weight: 600; }
        .mon-kpi-sub { font-size: 11.5px; color: var(--text-muted); }
        .mon-tabla-wrap {
          border: 1px solid var(--border); border-radius: 10px; background: var(--surface, #fff);
          overflow: auto; max-height: 62vh;
        }
        .mon-tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
        .mon-tabla thead th {
          position: sticky; top: 0; background: var(--surface, #fff); z-index: 1;
          text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
          color: var(--text-muted); padding: 9px 10px; border-bottom: 1px solid var(--border);
        }
        .mon-tabla tbody td { padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
        .mon-tabla tbody tr:hover { background: rgba(0,0,0,.02); }
        .mon-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
        .mon-detalle { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mon-vacio { text-align: center; color: var(--text-muted); padding: 34px 10px !important; }
        .mon-fila-nueva { animation: mon-entrada 2.5s ease-out; }
        @keyframes mon-entrada { 0% { background: #dcfce7; } 100% { background: transparent; } }
        .mon-expandida td { background: rgba(0,0,0,.025); font-size: 12.5px; }
        .mon-pre {
          background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px 12px;
          font-size: 11.5px; line-height: 1.5; overflow: auto; max-height: 260px; margin: 0 0 8px;
          white-space: pre-wrap; word-break: break-word;
        }
        .mon-stack { color: #fca5a5; }
        .mon-tab {
          display: inline-flex; align-items: center; gap: 6px;
          border: 1px solid var(--border); background: var(--surface, #fff); border-radius: 999px;
          padding: 6px 16px; font-size: 12.5px; font-weight: 700; color: var(--text-muted); cursor: pointer;
        }
        .mon-tab-activa { background: var(--primary, #1e9295); border-color: var(--primary, #1e9295); color: #fff; }
        .mon-migas { border: 1px solid var(--border); border-radius: 8px; background: var(--surface, #fff); margin-top: 5px; max-height: 200px; overflow: auto; }
        .mon-miga { display: flex; gap: 10px; padding: 4px 10px; font-size: 11.5px; border-bottom: 1px solid var(--border); }
        .mon-miga:last-child { border-bottom: 0; }
        .mon-miga-hora { color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .mon-miga-tipo { font-weight: 700; text-transform: uppercase; font-size: 10px; color: var(--text-muted); width: 38px; flex-shrink: 0; margin-top: 1px; }
      `}</style>
    </div>
  );
}

// React exige un componente para agrupar <tr> hermanas con key.
function FragmentoFila({ children }) {
  return <>{children}</>;
}
