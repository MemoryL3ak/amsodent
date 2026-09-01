import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  ExternalLink,
  CheckCheck,
  AlertCircle,
  AlertTriangle,
  Upload,
  PackageSearch,
  Inbox,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

// Campana de notificaciones in-app: count de no leídas + dropdown con lista.
// Combina dos mecanismos:
//   1. Suscripción realtime a la tabla `notificaciones` filtrada por email
//      del usuario → aparece al instante cuando llega una nueva.
//   2. Polling cada 60s como fallback (por si la conexión realtime se cae).
// El dropdown se renderiza con createPortal a document.body para que no se
// recorte si el contenedor padre tiene overflow (caso del sidebar).

const POLL_MS = 30_000;
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

  // Suscripción realtime: cuando llega una INSERT/UPDATE en `notificaciones`
  // para el email del usuario, refrescamos contador y, si el panel está
  // abierto, también la lista. Esto reemplaza el lag del polling de 60s.
  useEffect(() => {
    let canal = null;
    let cancel = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email?.toLowerCase();
      if (!email || cancel) return;

      canal = supabase
        .channel(`notificaciones-${email}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notificaciones",
            filter: `user_email=eq.${email}`,
          },
          () => {
            fetchCount();
            if (open) fetchList();
          },
        )
        .subscribe();
    })();

    return () => {
      cancel = true;
      if (canal) supabase.removeChannel(canal);
    };
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
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        boxShadow: "0 24px 50px rgba(15,23,42,.20), 0 4px 10px rgba(15,23,42,.05)",
        zIndex: 10000,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        .notif-item:hover { filter: brightness(.985); }
        .notif-item:hover a[href] { filter: brightness(1.05); }
      `}</style>
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
            Notificaciones
          </div>
          {count > 0 && (
            <span
              style={{
                background: "#dc2626",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                letterSpacing: 0.3,
              }}
            >
              {count} {count === 1 ? "nueva" : "nuevas"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={marcarTodas}
          disabled={count === 0}
          style={{
            background: "transparent",
            border: "none",
            color: count === 0 ? "#cbd5e1" : "#0e7490",
            fontSize: 12,
            fontWeight: 600,
            cursor: count === 0 ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 6,
            transition: "background .15s ease",
          }}
          title="Marcar todas como leídas"
        >
          <CheckCheck size={13} /> Leer todas
        </button>
      </div>

      {/* Lista */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading ? (
          <div style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            Cargando…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "#f1f5f9",
                color: "#94a3b8",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 10,
              }}
            >
              <Inbox size={24} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#475569", marginBottom: 2 }}>
              Todo al día
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              No tienes notificaciones pendientes.
            </div>
          </div>
        ) : (
          items.map((n) => (
            <NotifItem
              key={n.id}
              notif={n}
              onMarcarLeida={marcarLeida}
              onClickLink={() => setOpen(false)}
            />
          ))
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

// Mapeo tipo → icono/color/etiqueta. Si llega un tipo desconocido, se cae a
// un default neutro.
function getNotifVisuales(notif) {
  const tipo = String(notif?.tipo || "").toLowerCase();
  const meta = notif?.metadata || {};
  const severidad = String(meta?.severidad || "").toLowerCase();

  if (tipo === "stock_critico" || severidad === "critico") {
    return {
      icono: AlertCircle,
      color: "#b91c1c",
      bg: "#fee2e2",
      etiqueta: "Stock crítico",
    };
  }
  if (tipo === "stock_bajo" || tipo === "stock_alerta" || severidad === "bajo") {
    return {
      icono: AlertTriangle,
      color: "#b45309",
      bg: "#fef3c7",
      etiqueta: "Stock bajo",
    };
  }
  if (tipo === "portal_upload") {
    return {
      icono: Upload,
      color: "#0e7490",
      bg: "#cffafe",
      etiqueta: "Portal cliente",
    };
  }
  // Cotización con productos sin peso: requiere revisión de un admin.
  if (tipo === "aprobacion_peso") {
    return {
      icono: AlertTriangle,
      color: "#6d28d9",
      bg: "#ede9fe",
      etiqueta: "Aprobación peso",
    };
  }
  if (tipo.startsWith("stock")) {
    return {
      icono: PackageSearch,
      color: "#0f766e",
      bg: "#ccfbf1",
      etiqueta: "Stock",
    };
  }
  return {
    icono: Bell,
    color: "#475569",
    bg: "#f1f5f9",
    etiqueta: "Aviso",
  };
}

function NotifItem({ notif, onMarcarLeida, onClickLink }) {
  const isLeida = Boolean(notif.leida_at);
  const v = getNotifVisuales(notif);
  const Icono = v.icono;

  return (
    <div
      className="notif-item"
      style={{
        position: "relative",
        padding: "12px 14px 12px 16px",
        borderBottom: "1px solid #f1f5f9",
        background: isLeida ? "#fff" : "linear-gradient(90deg, #f0f9ff 0%, #fff 70%)",
        display: "flex",
        gap: 12,
        transition: "background .15s ease",
      }}
    >
      {/* Indicador no leída — punto a la izquierda */}
      {!isLeida && (
        <span
          style={{
            position: "absolute",
            top: 18,
            left: 6,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#0ea5e9",
          }}
          aria-hidden
        />
      )}

      {/* Icono coloreado */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: v.bg,
          color: v.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icono size={17} />
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: v.color,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            {v.etiqueta}
          </span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            · {fmtCuandoFue(notif.creado_at)}
          </span>
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#0f172a",
            lineHeight: 1.45,
            fontWeight: isLeida ? 400 : 500,
            wordBreak: "break-word",
          }}
        >
          {notif.mensaje}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 8,
          }}
        >
          {notif.link && (
            <Link
              to={notif.link}
              onClick={() => {
                onClickLink?.();
                if (!isLeida) onMarcarLeida(notif.id);
              }}
              style={{
                fontSize: 12,
                color: v.color,
                fontWeight: 700,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                background: v.bg,
                borderRadius: 6,
                transition: "filter .15s ease",
              }}
            >
              Ver detalle <ExternalLink size={11} />
            </Link>
          )}
          {!isLeida && (
            <button
              type="button"
              onClick={() => onMarcarLeida(notif.id)}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: 11.5,
                fontWeight: 500,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Marcar leída
            </button>
          )}
        </div>
      </div>
    </div>
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
