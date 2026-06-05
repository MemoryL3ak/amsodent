import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Clock } from "lucide-react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import CorreoComposer from "./CorreoComposer";

// Detector global de correos pendientes (Fase 1 del sistema de correos).
// Sondea las notificaciones no leídas de tipo correo y, si hay alguna,
// levanta un popup para que el vendedor envíe el correo al cliente.
// Escucha el evento window "correos:check" para refrescar de inmediato
// (lo dispara DetalleLicitacion tras subir una OC o guía).

const POLL_MS = 45_000;
const TIPOS_CORREO = ["oc_agradecimiento", "guia_despacho_enviar"];

// Horas desde que se creó la notificación. UNA VEZ cumplido este plazo el
// recordatorio se vuelve firme: ya NO se puede posponer (sin botón "Posponer"),
// para forzar el envío del correo al cliente. Antes de cumplirse, se puede
// posponer/cerrar libremente.
const HORAS_FIRME = 24;

function horasDesdeCreacion(notif) {
  const ts = notif?.creado_at || notif?.created_at || notif?.fecha;
  if (!ts) return Infinity; // sin fecha → permitimos posponer (no trabar)
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

// El correo de agradecimiento de la OC se puede posponer/cerrar mientras no se
// cumplan 24 h; al cumplirse, queda firme (sin "Posponer") hasta que se envíe.
// La guía de despacho siempre se puede posponer. El admin SIEMPRE puede posponer.
function puedePosponer(notif, esAdmin) {
  if (esAdmin) return true;
  if (notif?.tipo !== "oc_agradecimiento") return true;
  return horasDesdeCreacion(notif) < HORAS_FIRME;
}

const TITULOS = {
  oc_agradecimiento: "Correo de agradecimiento pendiente",
  guia_despacho_enviar: "Guía de despacho por enviar",
};

const LABEL_ENVIAR = {
  oc_agradecimiento: "Enviar ahora",
  guia_despacho_enviar: "Enviar notificación al cliente",
};

export default function RecordatoriosCorreo() {
  const { rol } = useAuth();
  const esAdmin = (rol ?? "").toString().trim().toLowerCase() === "admin";
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
    // Cerrar sin enviar. Si la notificación aún NO cumple 24 h, la posponemos
    // 2 h (snooze). Si ya es "firme" (cumplió 24 h), NO se pospone: el recordatorio
    // vuelve a aparecer de inmediato hasta que se envíe el correo.
    const notifId = composer?.notifId;
    setComposer(null);
    if (!notifId) return;
    const notif = pendientes.find((n) => n.id === notifId);
    if (notif && !puedePosponer(notif, esAdmin)) {
      // firme: solo refrescamos para que el recordatorio reaparezca
      setTimeout(fetchPendientes, 200);
      return;
    }
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

  const firme = !puedePosponer(actual, esAdmin);

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
          {firme && (
            <div
              style={{
                marginTop: 14,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                background: "var(--warning-bg)",
                border: "1px solid var(--warning)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
              }}
            >
              <Clock size={15} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ color: "#854d0e", fontSize: 12.5, lineHeight: 1.5 }}>
                Ya se cumplieron 24 horas: este recordatorio se mantendrá hasta que envíes el correo al cliente.
              </span>
            </div>
          )}
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
          {!firme && (
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
          )}
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
