import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Clock, CalendarClock, Check, X } from "lucide-react";
import { api } from "../lib/api";

// Detector de recordatorios por tiempo de cotización (cierre próximo y
// resultados publicados). Los crea el scheduler del backend como
// notificaciones; aquí las mostramos como popup con acciones Sí / Aún no.

const POLL_MS = 60_000;
const TIPOS = ["cierre_proximo", "resultados_publicados"];

const META = {
  cierre_proximo: { titulo: "Cierre de cotización próximo", icon: Clock },
  resultados_publicados: { titulo: "Resultados de licitación", icon: CalendarClock },
};

export default function RecordatoriosCierre() {
  const navigate = useNavigate();
  const [pendientes, setPendientes] = useState([]);
  const descartadasRef = useRef(new Set());

  const fetchPendientes = useCallback(async () => {
    try {
      const r = await api.get("/notificaciones?soloNoLeidas=true");
      const lista = (Array.isArray(r) ? r : []).filter(
        (n) =>
          TIPOS.includes(n?.tipo) &&
          n?.metadata?.licitacion_id &&
          !descartadasRef.current.has(n.id),
      );
      setPendientes(lista);
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => {
    fetchPendientes();
    const id = setInterval(fetchPendientes, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPendientes]);

  const actual = pendientes.find((n) => !descartadasRef.current.has(n.id)) || null;

  async function marcarLeida(id) {
    descartadasRef.current.add(id);
    setPendientes((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.post(`/notificaciones/${id}/leer`, {});
    } catch {
      // si falla, queda descartada solo en sesión
    }
  }

  // "Sí, ya postulé": marca la cotización como postulada (corta recordatorios).
  async function confirmarPostulada(notif) {
    const licId = notif?.metadata?.licitacion_id;
    if (licId) {
      try {
        await api.put(`/licitaciones/${licId}`, { postulada: true });
      } catch {
        // si falla, igual cerramos el aviso
      }
    }
    await marcarLeida(notif.id);
  }

  if (!actual) return null;

  const meta = META[actual.tipo] || META.cierre_proximo;
  const Icono = meta.icon;
  const esCierre = actual.tipo === "cierre_proximo";
  const licId = actual?.metadata?.licitacion_id;

  const popup = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.55)",
        backdropFilter: "blur(2px)",
        zIndex: 10850,
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
            <Icono size={19} />
          </div>
          <strong style={{ fontSize: 15 }}>{meta.titulo}</strong>
        </div>

        <div style={{ padding: "18px 20px" }}>
          <p style={{ margin: 0, color: "var(--text)", fontSize: 14, lineHeight: 1.55 }}>
            {actual.mensaje}
          </p>
          {licId && (
            <button
              type="button"
              onClick={() => { marcarLeida(actual.id); navigate(`/detalle/${licId}`); }}
              style={{
                marginTop: 10,
                background: "none",
                border: "none",
                color: "var(--primary-dark)",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Ver cotización
            </button>
          )}
        </div>

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
          {esCierre ? (
            <>
              <button
                type="button"
                onClick={() => marcarLeida(actual.id)}
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
                <X size={14} /> Aún no
              </button>
              <button
                type="button"
                onClick={() => confirmarPostulada(actual)}
                style={{
                  padding: "9px 18px",
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
                }}
              >
                <Check size={15} /> Sí, ya postulé
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => marcarLeida(actual.id)}
              style={{
                padding: "9px 18px",
                borderRadius: "var(--radius)",
                border: "none",
                background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              Entendido
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
