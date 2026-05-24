import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Clock } from "lucide-react";
import { api } from "../lib/api";
import CorreoComposer from "./CorreoComposer";

// Detector global de correos pendientes (Fase 1 del sistema de correos).
// Sondea las notificaciones no leídas de tipo correo y, si hay alguna,
// levanta un popup para que el vendedor envíe el correo al cliente.
// Escucha el evento window "correos:check" para refrescar de inmediato
// (lo dispara DetalleLicitacion tras subir una OC o guía).

const POLL_MS = 45_000;
const TIPOS_CORREO = ["oc_agradecimiento", "guia_despacho_enviar"];

const TITULOS = {
  oc_agradecimiento: "Correo de agradecimiento pendiente",
  guia_despacho_enviar: "Guía de despacho por enviar",
};

export default function RecordatoriosCorreo() {
  const [pendientes, setPendientes] = useState([]);
  const [composer, setComposer] = useState(null);
  const descartadasRef = useRef(new Set());

  const fetchPendientes = useCallback(async () => {
    try {
      const r = await api.get("/notificaciones?soloNoLeidas=true");
      const lista = (Array.isArray(r) ? r : []).filter(
        (n) =>
          TIPOS_CORREO.includes(n?.tipo) &&
          n?.metadata?.licitacion_id &&
          n?.metadata?.documento_id &&
          !descartadasRef.current.has(n.id),
      );
      setPendientes(lista);
    } catch {
      // silencioso — no romper la UI por el recordatorio
    }
  }, []);

  useEffect(() => {
    fetchPendientes();
    const id = setInterval(fetchPendientes, POLL_MS);
    function onCheck() {
      // Pequeño respiro para que el backend alcance a crear la notificación.
      setTimeout(fetchPendientes, 1200);
    }
    window.addEventListener("correos:check", onCheck);
    return () => {
      clearInterval(id);
      window.removeEventListener("correos:check", onCheck);
    };
  }, [fetchPendientes]);

  // El primer pendiente no descartado es el que se muestra.
  const actual = pendientes.find((n) => !descartadasRef.current.has(n.id)) || null;

  // "Más tarde": pospone el aviso 2 horas vía backend (snooze_hasta).
  // Pasadas las 2 h el polling lo vuelve a mostrar automáticamente. Si la API
  // falla, descartamos solo en sesión para no bloquear la UI.
  async function masTarde(id) {
    descartadasRef.current.add(id);
    setPendientes((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.post(`/notificaciones/${id}/snooze`, { horas: 2 });
    } catch {
      // si falla el snooze, queda descartada solo en memoria
    }
  }

  function abrirComposer(notif) {
    setComposer({
      notifId: notif.id,
      tipo: notif.tipo,
      licitacionId: notif.metadata.licitacion_id,
      documentoId: notif.metadata.documento_id,
    });
  }

  async function onSent() {
    const notifId = composer?.notifId;
    if (notifId) {
      try {
        await api.post(`/notificaciones/${notifId}/leer`, {});
      } catch {
        // si falla, igual lo descartamos en sesión
      }
      descartadasRef.current.add(notifId);
      setPendientes((prev) => prev.filter((n) => n.id !== notifId));
    }
  }

  function cerrarComposer() {
    // Cerrar sin enviar: lo ocultamos por esta sesión (sigue no leído en la campana).
    if (composer?.notifId) masTarde(composer.notifId);
    setComposer(null);
  }

  if (composer) {
    return (
      <CorreoComposer
        tipo={composer.tipo}
        licitacionId={composer.licitacionId}
        documentoId={composer.documentoId}
        onSent={onSent}
        onClose={cerrarComposer}
      />
    );
  }

  if (!actual) return null;

  const popup = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.5)",
        zIndex: 10800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "100%",
          background: "#fff",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(15,23,42,.32)",
        }}
      >
        <div
          style={{
            background: "#0e7490",
            color: "#fff",
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Mail size={20} />
          <strong style={{ fontSize: 15 }}>
            {TITULOS[actual.tipo] || "Correo pendiente"}
          </strong>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ margin: 0, color: "#334155", fontSize: 14, lineHeight: 1.5 }}>
            {actual.mensaje}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "12px 20px",
            borderTop: "1px solid #e5e7eb",
            background: "#f8fafc",
          }}
        >
          <button
            type="button"
            onClick={() => masTarde(actual.id)}
            style={{
              padding: "9px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#334155",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Clock size={14} /> Más tarde
          </button>
          <button
            type="button"
            onClick={() => abrirComposer(actual)}
            style={{
              padding: "9px 18px",
              borderRadius: 8,
              border: "none",
              background: "#0e7490",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Mail size={15} /> Enviar ahora
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
