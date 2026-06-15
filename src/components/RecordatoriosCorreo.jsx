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
const TIPOS_CORREO = ["oc_agradecimiento", "guia_despacho_enviar", "info_despacho_agradecimiento"];

// El popup de recordatorios (correo de agradecimiento de la OC y guía de
// despacho) SIEMPRE permite posponer/cerrar, sin importar el tiempo transcurrido
// ni el rol del usuario.

const TITULOS = {
  oc_agradecimiento: "Correo de agradecimiento pendiente",
  guia_despacho_enviar: "Guía de despacho por enviar",
  info_despacho_agradecimiento: "Correo de agradecimiento pendiente",
};

const LABEL_ENVIAR = {
  oc_agradecimiento: "Enviar ahora",
  guia_despacho_enviar: "Enviar notificación al cliente",
  info_despacho_agradecimiento: "Enviar ahora",
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
    // Cerrar sin enviar siempre pospone 2 h (snooze): el recordatorio vuelve a
    // aparecer más tarde hasta que se envíe el correo al cliente.
    const notifId = composer?.notifId;
    setComposer(null);
    if (!notifId) return;
    masTarde(notifId);
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
        background: "rgba(15,23,42,.55)",
        backdropFilter: "blur(2px)",
        zIndex: 10800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: 440,
          maxWidth: "100%",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        {/* Header con gradiente de marca */}
        <div
          style={{
            background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
            color: "#fff",
            padding: "18px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "rgba(255,255,255,.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Mail size={19} />
          </div>
          <div>
            <strong style={{ fontSize: 15, display: "block", lineHeight: 1.2 }}>
              {TITULOS[actual.tipo] || "Correo pendiente"}
            </strong>
            <span style={{ fontSize: 12, opacity: 0.85 }}>Amsodent Medical</span>
          </div>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: "18px 20px" }}>
          <p style={{ margin: 0, color: "var(--text)", fontSize: 14, lineHeight: 1.55 }}>
            {actual.mensaje}
          </p>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
          }}
        >
          <button
            type="button"
            onClick={() => masTarde(actual.id)}
            style={{
              padding: "9px 16px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border-strong)",
              background: "var(--surface)",
              color: "var(--text)",
              fontWeight: 600,
              fontSize: 13.5,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Clock size={14} /> Posponer
          </button>
          <button
            type="button"
            onClick={() => abrirComposer(actual)}
            style={{
              padding: "9px 20px",
              borderRadius: "var(--radius)",
              border: "none",
              background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13.5,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <Mail size={15} /> {LABEL_ENVIAR[actual.tipo] || "Enviar ahora"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
