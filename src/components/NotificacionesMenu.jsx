import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, ExternalLink, CheckCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

// Campana de notificaciones in-app: muestra count de no leídas y un dropdown
// con la lista. Polling cada 60s (ligero) para mantenerse fresca.
// El dropdown se renderiza con createPortal a document.body para que no se
// recorte si el contenedor padre tiene overflow (caso del sidebar).

const POLL_MS = 60_000;
const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 480;

export default function NotificacionesMenu() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState(null);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  async function fetchCount() {
    try {
      const r = await api.get("/notificaciones/unread-count");
      setCount(Number(r?.total || 0));
    } catch {
      // silencioso — no romper la UI por una campana
    }
  }

  async function fetchList() {
    setLoading(true);
    try {
      const r = await api.get("/notificaciones");
      setItems(Array.isArray(r) ? r : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (open) fetchList();
  }, [open]);

  // Cerrar al click afuera (verifica tanto el botón como el panel portado).
  useEffect(() => {
    function onDoc(e) {
      const panel = document.getElementById("notif-panel");
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (panel && panel.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Reposicionar al scroll/resize cuando está abierto, así el panel sigue
  // anclado al botón aunque el sidebar tenga su propio scroll.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      // Panel ARRIBA del botón (la campana suele estar al pie del sidebar).
      const bottom = window.innerHeight - rect.top + 8;
      // Alineamos el lado izquierdo del panel con el botón, pero si así se
      // saldría por la derecha, lo movemos a la izquierda lo justo para entrar.
      const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 8);
      const left = Math.min(Math.max(8, rect.left), maxLeft);
      setCoords({ bottom, left });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  async function marcarLeida(id) {
    try {
      await api.post(`/notificaciones/${id}/leer`, {});
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, leida_at: new Date().toISOString() } : n));
      fetchCount();
    } catch {
      // no hacemos toast — el componente debe ser muy silencioso
    }
  }

  async function marcarTodas() {
    try {
      await api.post(`/notificaciones/leer-todas`, {});
      setItems((prev) => prev.map((n) => n.leida_at ? n : ({ ...n, leida_at: new Date().toISOString() })));
      setCount(0);
    } catch {}
  }

  const panel = open && coords ? (
    <div
      id="notif-panel"
      style={{
        position: "fixed",
        bottom: coords.bottom,
        left: coords.left,
        width: PANEL_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15,23,42,.18)",
        zIndex: 10000,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border, #e5e7eb)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
          Notificaciones {count > 0 && <span style={{ color: "#dc2626" }}>· {count} nuevas</span>}
        </div>
        <button
          type="button"
          onClick={marcarTodas}
          disabled={count === 0}
          style={{
            background: "transparent", border: "none",
            color: count === 0 ? "var(--text-muted)" : "var(--primary, #0e7490)",
            fontSize: 12, fontWeight: 600,
            cursor: count === 0 ? "default" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}
          title="Marcar todas como leídas"
        >
          <CheckCheck size={13} /> Leer todas
        </button>
      </div>
      <div style={{ overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Cargando…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            No tienes notificaciones.
          </div>
        ) : (
          items.map((n) => {
            const isLeida = Boolean(n.leida_at);
            return (
              <div
                key={n.id}
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--border, #f1f5f9)",
                  background: isLeida ? "transparent" : "#f0f9ff",
                  display: "flex", flexDirection: "column", gap: 4,
                }}
              >
                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.4 }}>
                  {n.mensaje}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {fmtCuandoFue(n.creado_at)}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {n.link && (
                      <Link
                        to={n.link}
                        onClick={() => { setOpen(false); if (!isLeida) marcarLeida(n.id); }}
                        style={{
                          fontSize: 12, color: "var(--primary, #0e7490)",
                          fontWeight: 600, textDecoration: "none",
                          display: "inline-flex", alignItems: "center", gap: 3,
                        }}
                      >
                        Ver <ExternalLink size={11} />
                      </Link>
                    )}
                    {!isLeida && (
                      <button
                        type="button"
                        onClick={() => marcarLeida(n.id)}
                        style={{
                          background: "transparent", border: "none",
                          color: "var(--text-muted)", fontSize: 12,
                          cursor: "pointer", padding: 0,
                        }}
                      >
                        Marcar leída
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="nav-bell"
          title="Notificaciones"
          style={{
            position: "relative",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 6,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text)",
          }}
        >
          <Bell size={18} />
          {count > 0 && (
            <span style={{
              position: "absolute", top: 0, right: 0,
              minWidth: 16, height: 16, padding: "0 4px",
              background: "#dc2626", color: "#fff",
              fontSize: 10, fontWeight: 700, lineHeight: "16px",
              borderRadius: 999,
              border: "2px solid var(--surface, #fff)",
              transform: "translate(30%, -30%)",
            }}>{count > 99 ? "99+" : count}</span>
          )}
        </button>
      </div>
      {panel && createPortal(panel, document.body)}
    </>
  );
}

function fmtCuandoFue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Hace un momento";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Hace ${h} h`;
  return d.toLocaleDateString("es-CL");
}
