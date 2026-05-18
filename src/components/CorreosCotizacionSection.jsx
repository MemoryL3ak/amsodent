import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Mail, Plus, RefreshCw, CheckCircle2, AlertTriangle, Clock, XCircle,
  ChevronDown, ChevronRight, X, MessageCircle, Inbox,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import ModalNuevoCorreo from "./ModalNuevoCorreo";

// Drawer lateral con el historial de correos de la cotización + botón para
// componer uno nuevo. Se monta vía portal sobre <body> para no ser afectado
// por el overflow del contenedor padre. Se anima entrando desde la derecha.
//
// Props:
//   open       → boolean, controla visibilidad del drawer
//   onClose    → callback al cerrar
//   licitacion → { id, id_licitacion, nombre_entidad, email, total_*}
//   onToast    → callback para mostrar toasts globales
export default function CorreosCotizacionSection({ open, onClose, licitacion, onToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [expandidos, setExpandidos] = useState({});
  // Respuestas indexadas por comunicacion_id: { [id]: [mensajesGmail] }
  const [respuestasPorComunicacion, setRespuestasPorComunicacion] = useState({});
  const [cargandoRespuestas, setCargandoRespuestas] = useState(false);

  const licitacionId = licitacion?.id;

  const cargar = useCallback(async () => {
    if (!licitacionId) return;
    setLoading(true);
    try {
      const r = await api.get(`/cotizaciones/${licitacionId}/comunicaciones`);
      setItems(Array.isArray(r) ? r : []);
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: `No se pudo cargar el historial: ${e?.message || ""}` });
    } finally {
      setLoading(false);
    }
  }, [licitacionId, onToast]);

  // Sincroniza respuestas desde Gmail. On-demand: solo cuando se abre el drawer
  // o al apretar Refrescar.
  const cargarRespuestas = useCallback(async () => {
    if (!licitacionId) return;
    setCargandoRespuestas(true);
    try {
      const r = await api.get(`/cotizaciones/${licitacionId}/comunicaciones/respuestas`);
      const mapa = {};
      (Array.isArray(r) ? r : []).forEach((g) => {
        mapa[g.comunicacion_id] = g.mensajes || [];
      });
      setRespuestasPorComunicacion(mapa);
    } catch (e) {
      // Silencioso: si no tiene permiso gmail.modify aún, no spammeamos toasts.
      console.warn("No se pudieron cargar respuestas:", e?.message);
    } finally {
      setCargandoRespuestas(false);
    }
  }, [licitacionId]);

  // Solo cargamos al abrirse para evitar requests innecesarias.
  useEffect(() => {
    if (open) {
      cargar();
      cargarRespuestas();
    }
  }, [open, cargar, cargarRespuestas]);

  // Status de Gmail: lo pedimos una sola vez al primer open.
  useEffect(() => {
    if (!open || gmailStatus !== null) return;
    (async () => {
      try {
        const r = await api.get("/auth/google/status");
        setGmailStatus(r);
      } catch {
        setGmailStatus({ connected: false });
      }
    })();
  }, [open, gmailStatus]);

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape" && !modalOpen) onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, modalOpen, onClose]);

  function abrirComposer() {
    if (gmailStatus && !gmailStatus.connected) {
      onToast?.({
        type: "warning",
        message:
          'Aún no conectaste tu cuenta de Gmail. Ve a "Mi perfil" o inicia sesión con Google para habilitar el envío.',
      });
      return;
    }
    setModalOpen(true);
  }

  async function cancelarProgramado(comunicacionId) {
    if (!confirm("¿Cancelar este correo programado?")) return;
    try {
      await api.delete(`/cotizaciones/${licitacionId}/comunicaciones/${comunicacionId}`);
      onToast?.({ type: "success", message: "Correo cancelado." });
      cargar();
    } catch (e) {
      onToast?.({ type: "error", message: `No se pudo cancelar: ${e?.message || ""}` });
    }
  }

  function toggleExpand(id) {
    setExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  if (!open) {
    // Aun cerrado, montamos el modal por separado para mantener su estado.
    // Pero el modal solo abre cuando el drawer está open, así que no hace falta.
    return null;
  }

  const drawer = (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, pointerEvents: "none" }}>
      {/* Overlay clickable para cerrar */}
      <div
        onClick={() => !modalOpen && onClose?.()}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15,23,42,0.35)",
          pointerEvents: "auto",
          animation: "comm-fade-in 0.2s ease-out",
        }}
      />

      {/* Panel lateral */}
      <aside
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(480px, 100vw)",
          background: "var(--surface)",
          boxShadow: "-12px 0 36px rgba(15,23,42,0.18)",
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
          animation: "comm-slide-in 0.22s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "linear-gradient(90deg, var(--primary-light) 0%, #f0f9f9 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Mail size={18} color="var(--primary)" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                Comunicaciones
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Cotización {licitacion?.id_licitacion}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label="Cerrar"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Subheader: status + acciones */}
        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: "space-between",
            background: "var(--bg)",
          }}
        >
          {gmailStatus && (
            <span style={{ fontSize: 12, color: gmailStatus.connected ? "#15803d" : "#b45309", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {gmailStatus.connected
                ? <>Enviando como <strong>{gmailStatus.google_email}</strong></>
                : "Gmail no conectado"}
            </span>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { cargar(); cargarRespuestas(); }}
              title="Refrescar historial y respuestas"
              disabled={cargandoRespuestas}
            >
              <RefreshCw size={13} style={cargandoRespuestas ? { animation: "spin 1s linear infinite" } : undefined} />
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={abrirComposer}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Plus size={13} /> Nuevo
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {!gmailStatus?.connected && (
            <div
              style={{
                padding: "10px 12px",
                border: "1px solid #fde68a",
                background: "#fffbeb",
                color: "#92400e",
                borderRadius: 8,
                fontSize: 12.5,
                marginBottom: 12,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
              <div>
                Para enviar correos necesitas conectar tu cuenta de Gmail.{" "}
                <Link to="/perfil" style={{ color: "var(--primary)", fontWeight: 600 }}>
                  Ir a Mi perfil →
                </Link>
              </div>
            </div>
          )}

          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Cargando historial…
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <Mail size={28} color="var(--text-muted)" style={{ opacity: 0.5, marginBottom: 8 }} />
              <div>Aún no se ha enviado ningún correo<br />desde esta cotización.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((c) => (
                <CorreoRow
                  key={c.id}
                  correo={c}
                  respuestas={respuestasPorComunicacion[c.id] || []}
                  expandido={!!expandidos[c.id]}
                  onToggle={() => toggleExpand(c.id)}
                  onCancelar={() => cancelarProgramado(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Animaciones */}
      <style>{`
        @keyframes comm-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes comm-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <ModalNuevoCorreo
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        licitacion={licitacion}
        onEnviado={cargar}
        onToast={onToast}
      />
    </div>
  );

  return createPortal(drawer, document.body);
}

function CorreoRow({ correo, respuestas = [], expandido, onToggle, onCancelar }) {
  const estado = correo.estado;
  const meta = estadoMeta(estado);
  const fechaPrincipal = correo.enviado_at || correo.programado_para || correo.creado_at;
  const hayRespuestas = respuestas.length > 0;
  const respuestasNoLeidas = respuestas.filter((m) => m.isUnread).length;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          cursor: "pointer",
        }}
      >
        {expandido ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <meta.icon size={13} color={meta.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={correo.asunto}
          >
            {correo.asunto}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Para: {(correo.para || []).join(", ") || "—"}
            {hayRespuestas && (
              <span
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: respuestasNoLeidas > 0 ? "#dbeafe" : "#f1f5f9",
                  color: respuestasNoLeidas > 0 ? "#1d4ed8" : "#475569",
                  fontWeight: 600,
                  fontSize: 10.5,
                }}
                title={`${respuestas.length} respuesta(s)`}
              >
                <MessageCircle size={10} />
                {respuestas.length}
                {respuestasNoLeidas > 0 && ` · ${respuestasNoLeidas} nueva${respuestasNoLeidas > 1 ? "s" : ""}`}
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: meta.color,
              background: meta.bg,
              padding: "1px 7px",
              borderRadius: 999,
            }}
          >
            {meta.label}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {formatearFecha(fechaPrincipal)}
          </span>
        </div>
      </div>

      {expandido && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", background: "var(--bg)" }}>
          <Linea label="De"   value={correo.google_email || correo.enviado_por} />
          <Linea label="Para" value={(correo.para || []).join(", ") || "—"} />
          {(correo.cc?.length > 0) && <Linea label="CC" value={correo.cc.join(", ")} />}
          {(correo.bcc?.length > 0) && <Linea label="CCO" value={correo.bcc.join(", ")} />}
          {estado === "programado" && (
            <Linea label="Programado" value={formatearFechaCompleta(correo.programado_para)} />
          )}
          {correo.enviado_at && <Linea label="Enviado" value={formatearFechaCompleta(correo.enviado_at)} />}
          {correo.error_mensaje && (
            <Linea label="Error" value={correo.error_mensaje} highlight="#b91c1c" />
          )}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.4 }}>
              Cuerpo
            </div>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                maxHeight: 280,
                overflowY: "auto",
                fontSize: 13,
                lineHeight: 1.5,
              }}
              dangerouslySetInnerHTML={{ __html: correo.cuerpo_html || "" }}
            />
          </div>
          {(correo.metadata?.adjuntos?.length > 0) && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-muted)" }}>
              <strong>Adjuntos:</strong>{" "}
              {correo.metadata.adjuntos.map((a, i) => (
                <span key={i}>
                  {a.filename} ({(a.size / 1024).toFixed(1)} KB)
                  {i < correo.metadata.adjuntos.length - 1 ? ", " : ""}
                </span>
              ))}
            </div>
          )}
          {estado === "programado" && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={onCancelar}
              >
                Cancelar envío programado
              </button>
            </div>
          )}

          {/* Respuestas del cliente leídas desde Gmail */}
          {hayRespuestas && (
            <div style={{ marginTop: 14, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Inbox size={12} />
                Respuestas ({respuestas.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {respuestas.map((m) => (
                  <RespuestaItem key={m.id} mensaje={m} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RespuestaItem({ mensaje }) {
  const [expandida, setExpandida] = useState(false);
  return (
    <div
      style={{
        border: `1px solid ${mensaje.isUnread ? "#93c5fd" : "var(--border)"}`,
        borderRadius: 8,
        background: mensaje.isUnread ? "#eff6ff" : "var(--surface)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpandida((v) => !v)}
        style={{
          padding: "8px 10px",
          cursor: "pointer",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        {expandida ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {mensaje.fromName || mensaje.fromEmail}
            {mensaje.isUnread && (
              <span style={{ marginLeft: 6, fontSize: 9.5, color: "#1d4ed8", fontWeight: 700 }}>
                NUEVO
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {mensaje.snippet || ""}
          </div>
        </div>
        <span style={{ fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {formatearFecha(mensaje.date)}
        </span>
      </div>
      {expandida && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", background: "var(--surface)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
            De: <strong style={{ color: "var(--text)" }}>{mensaje.fromName ? `${mensaje.fromName} <${mensaje.fromEmail}>` : mensaje.fromEmail}</strong>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            {formatearFechaCompleta(mensaje.date)}
          </div>
          {mensaje.bodyHtml ? (
            <div
              style={{ fontSize: 13, lineHeight: 1.5, maxHeight: 360, overflowY: "auto" }}
              dangerouslySetInnerHTML={{ __html: mensaje.bodyHtml }}
            />
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, fontFamily: "inherit", margin: 0 }}>
              {mensaje.bodyText || mensaje.snippet || ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Linea({ label, value, highlight }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 12, marginBottom: 2 }}>
      <span style={{ color: "var(--text-muted)", minWidth: 90, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ color: highlight || "var(--text)", wordBreak: "break-word", flex: 1 }}>{value}</span>
    </div>
  );
}

function estadoMeta(estado) {
  switch (estado) {
    case "enviado":    return { label: "Enviado",    color: "#15803d", bg: "#f0fdf4", icon: CheckCircle2 };
    case "programado": return { label: "Programado", color: "#1d4ed8", bg: "#eff6ff", icon: Clock };
    case "fallido":    return { label: "Fallido",    color: "#b91c1c", bg: "#fef2f2", icon: AlertTriangle };
    case "cancelado":  return { label: "Cancelado",  color: "#6b7280", bg: "#f3f4f6", icon: XCircle };
    default:           return { label: estado || "—", color: "#6b7280", bg: "#f3f4f6", icon: Mail };
  }
}

function formatearFecha(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hoy = new Date();
  const sameDay =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  if (sameDay) return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
}

function formatearFechaCompleta(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CL", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
