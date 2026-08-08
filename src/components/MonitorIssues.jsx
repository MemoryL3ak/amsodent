import { useEffect, useState } from "react";
import {
  AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronRight, EyeOff, RotateCcw, Users,
} from "lucide-react";
import { api } from "../lib/api";

/* Vista "Problemas": errores agrupados por huella (estilo Sentry).
   El mismo bug repetido N veces es UNA fila con contador, usuarios
   afectados, primera/última vez y stacktrace. Acciones: resolver
   (si reaparece se REABRE solo), ignorar, reabrir. */

const ESTADOS = {
  activo:   { label: "Activo",   color: "#b91c1c", bg: "#fee2e2" },
  resuelto: { label: "Resuelto", color: "#15803d", bg: "#dcfce7" },
  ignorado: { label: "Ignorado", color: "#475569", bg: "#e2e8f0" },
};

const TIPOS = { excepcion: "Backend", frontend: "Frontend", correo: "Correo", sistema: "Sistema", http: "Backend" };

function fmtFechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function hace(iso) {
  if (!iso) return "—";
  const seg = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "hace segundos";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return `hace ${Math.floor(seg / 86400)} d`;
}

export default function MonitorIssues({ onError }) {
  const [issues, setIssues] = useState([]);
  const [estado, setEstado] = useState("activo");
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState(null);

  async function cargar(est = estado) {
    setCargando(true);
    try {
      const res = await api.get(`/monitor/issues${est ? `?estado=${est}` : ""}`);
      setIssues(Array.isArray(res) ? res : []);
    } catch (e) {
      onError?.(e?.message || "No se pudieron cargar los problemas.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { cargar(estado); }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cambiar(id, nuevo) {
    try {
      await api.post(`/monitor/issues/${id}/estado`, { estado: nuevo });
      setIssues((prev) => prev
        .map((i) => (i.id === id ? { ...i, estado: nuevo } : i))
        .filter((i) => !estado || i.estado === estado));
    } catch (e) {
      onError?.(e?.message || "No se pudo cambiar el estado.");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["activo", "Activos"], ["resuelto", "Resueltos"], ["ignorado", "Ignorados"], ["", "Todos"]].map(([v, l]) => (
          <button key={v} onClick={() => setEstado(v)}
            className={"miss-tab" + (estado === v ? " miss-tab-activa" : "")}>{l}</button>
        ))}
      </div>

      {cargando ? (
        <div className="miss-vacio">Cargando…</div>
      ) : issues.length === 0 ? (
        <div className="miss-vacio">
          <Bug size={18} style={{ marginBottom: 6, opacity: 0.6 }} /><br />
          {estado === "activo" ? "Sin problemas activos. 🎉" : "Nada por aquí."}
        </div>
      ) : (
        issues.map((i) => {
          const est = ESTADOS[i.estado] || ESTADOS.activo;
          const abierto = expandido === i.id;
          const usuarios = Array.isArray(i.usuarios_afectados) ? i.usuarios_afectados : [];
          return (
            <div key={i.id} className="miss-card">
              <div className="miss-fila" onClick={() => setExpandido(abierto ? null : i.id)}>
                <span style={{ flexShrink: 0, marginTop: 2 }}>
                  {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="miss-titulo">{i.titulo}</div>
                  <div className="miss-sub">
                    <span className="miss-badge" style={{ color: est.color, background: est.bg }}>{est.label}</span>
                    <span>{TIPOS[i.tipo] || i.tipo}</span>
                    {i.ruta && <span className="miss-ruta" title={i.ruta}>{i.ruta}</span>}
                    <span>· primera vez {fmtFechaHora(i.primera_vez)} · última {hace(i.ultima_vez)}</span>
                  </div>
                </div>
                <div className="miss-numeros">
                  <span className="miss-conteo" title="Ocurrencias">
                    <AlertTriangle size={13} /> {Number(i.ocurrencias).toLocaleString("es-CL")}
                  </span>
                  {usuarios.length > 0 && (
                    <span className="miss-conteo" title={usuarios.join(", ")}>
                      <Users size={13} /> {usuarios.length}
                    </span>
                  )}
                </div>
                <div className="miss-acciones" onClick={(e) => e.stopPropagation()}>
                  {i.estado === "activo" ? (
                    <>
                      <button className="btn btn-ghost miss-btn" onClick={() => cambiar(i.id, "resuelto")}>
                        <CheckCircle2 size={13} /> Resolver
                      </button>
                      <button className="btn btn-ghost miss-btn" onClick={() => cambiar(i.id, "ignorado")}>
                        <EyeOff size={13} /> Ignorar
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-ghost miss-btn" onClick={() => cambiar(i.id, "activo")}>
                      <RotateCcw size={13} /> Reabrir
                    </button>
                  )}
                </div>
              </div>
              {abierto && (
                <div className="miss-detalle">
                  {usuarios.length > 0 && (
                    <div style={{ marginBottom: 8, fontSize: 12 }}>
                      <b>Usuarios afectados:</b> {usuarios.join(", ")}
                    </div>
                  )}
                  {i.ultimo_trace_id && (
                    <div style={{ marginBottom: 8, fontSize: 12 }}>
                      <b>Último trace ID:</b> <code style={{ fontSize: 11 }}>{i.ultimo_trace_id}</code>
                      {" "}(búscalo en la pestaña Eventos para ver la request completa)
                    </div>
                  )}
                  {i.ultimo_stack
                    ? <pre className="miss-pre">{i.ultimo_stack}</pre>
                    : <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin stacktrace registrado.</div>}
                </div>
              )}
            </div>
          );
        })
      )}

      <style>{`
        .miss-tab {
          border: 1px solid var(--border); background: var(--surface, #fff); border-radius: 999px;
          padding: 5px 14px; font-size: 12.5px; font-weight: 600; color: var(--text-muted); cursor: pointer;
        }
        .miss-tab-activa { background: var(--primary, #1e9295); border-color: var(--primary, #1e9295); color: #fff; }
        .miss-vacio { text-align: center; color: var(--text-muted); padding: 40px 0; font-size: 13px; }
        .miss-card { background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px; }
        .miss-fila { display: flex; gap: 10px; align-items: flex-start; padding: 11px 14px; cursor: pointer; }
        .miss-fila:hover { background: rgba(0,0,0,.015); }
        .miss-titulo { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .miss-sub { display: flex; gap: 8px; align-items: center; font-size: 11.5px; color: var(--text-muted); margin-top: 3px; flex-wrap: wrap; }
        .miss-badge { font-size: 10.5px; font-weight: 700; padding: 1px 8px; border-radius: 999px; }
        .miss-ruta { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .miss-numeros { display: flex; gap: 12px; align-items: center; flex-shrink: 0; margin-top: 2px; }
        .miss-conteo { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 700; color: var(--text-muted); }
        .miss-acciones { display: flex; gap: 6px; flex-shrink: 0; }
        .miss-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 4px 10px; }
        .miss-detalle { border-top: 1px solid var(--border); padding: 11px 14px; background: rgba(0,0,0,.015); }
        .miss-pre {
          background: #0f172a; color: #fca5a5; border-radius: 8px; padding: 10px 12px;
          font-size: 11.5px; line-height: 1.5; overflow: auto; max-height: 280px; margin: 0;
          white-space: pre-wrap; word-break: break-word;
        }
      `}</style>
    </div>
  );
}
