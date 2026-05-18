import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Mail, CheckCircle2, AlertTriangle, ExternalLink, Trash2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import Toast from "../components/Toast";

// Pantalla de perfil del usuario. Por ahora solo expone la conexión con Gmail
// (Google OAuth). En el futuro pueden vivir aquí más settings personales.
export default function Perfil() {
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [googleEmail, setGoogleEmail] = useState("");
  const [connectedAt, setConnectedAt] = useState(null);
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [toast, setToast] = useState(null);

  async function cargarStatus() {
    setLoading(true);
    try {
      const r = await api.get("/auth/google/status");
      setConectado(Boolean(r?.connected));
      setGoogleEmail(r?.google_email || "");
      setConnectedAt(r?.connected_at || null);
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo cargar el estado de la conexión." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargarStatus();
  }, []);

  // Si llegamos a /perfil con ?gmail=ok|error (por algún flujo previo) o si la
  // pestaña hija /perfil/gmail-conectado disparó un postMessage, refrescamos.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const gmail = params.get("gmail");
    if (gmail === "ok") {
      setToast({ type: "success", message: "Gmail conectado correctamente." });
      cargarStatus();
    } else if (gmail === "error") {
      const reason = params.get("reason") || "Error desconocido";
      setToast({ type: "error", message: `No se pudo conectar Gmail: ${reason}` });
    }
  }, [location.search]);

  async function conectarGmail() {
    setConectando(true);
    try {
      const r = await api.get("/auth/google/connect");
      if (r?.url) {
        // Redirigimos en la misma ventana. Google nos devolverá al callback
        // del backend, que a su vez redirige a /perfil/gmail-conectado.
        window.location.href = r.url;
        return;
      }
      setToast({ type: "error", message: "No se obtuvo URL de autorización." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: `Error iniciando OAuth: ${e?.message || ""}` });
    } finally {
      setConectando(false);
    }
  }

  async function desconectarGmail() {
    if (!confirm("¿Seguro que deseas desconectar tu cuenta de Gmail? La app dejará de poder enviar correos en tu nombre.")) {
      return;
    }
    setDesconectando(true);
    try {
      await api.post("/auth/google/disconnect", {});
      setConectado(false);
      setGoogleEmail("");
      setConnectedAt(null);
      setToast({ type: "success", message: "Cuenta de Gmail desconectada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: `No se pudo desconectar: ${e?.message || ""}` });
    } finally {
      setDesconectando(false);
    }
  }

  return (
    <div className="page">
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}

      <div className="page-header">
        <h1 className="page-title">Mi perfil</h1>
      </div>

      <div className="surface" style={{ maxWidth: 720 }}>
        <div className="surface-header">
          <h3 className="surface-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Mail size={16} /> Conexión con Gmail
          </h3>
        </div>
        <div className="surface-body">
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 0 }}>
            Al conectar tu cuenta de Gmail, podrás enviar correos a los clientes desde la sección
            de Comunicaciones de cada cotización. Los correos saldrán literalmente desde tu cuenta
            (quedan en tu carpeta "Enviados" de Gmail), y las respuestas del cliente te llegan
            directo a tu bandeja.
          </p>

          {loading ? (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              Cargando estado…
            </div>
          ) : conectado ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                borderRadius: 8,
                marginTop: 12,
              }}
            >
              <CheckCircle2 size={20} color="#15803d" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "#15803d", fontSize: 14 }}>
                  Gmail conectado
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  Cuenta: <strong>{googleEmail}</strong>
                  {connectedAt && (
                    <> · desde {new Date(connectedAt).toLocaleDateString("es-CL")}</>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={cargarStatus}
                title="Refrescar estado"
              >
                <RefreshCw size={13} />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={desconectarGmail}
                disabled={desconectando}
              >
                <Trash2 size={13} /> {desconectando ? "Desconectando…" : "Desconectar"}
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                borderRadius: 8,
                marginTop: 12,
              }}
            >
              <AlertTriangle size={20} color="#b45309" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Sin conexión</div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  Aún no has autorizado a la app para enviar correos en tu nombre.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={conectarGmail}
                disabled={conectando}
              >
                <ExternalLink size={13} /> {conectando ? "Abriendo…" : "Conectar Gmail"}
              </button>
            </div>
          )}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--text-muted)" }}>
              ¿Qué permisos pide la app?
            </summary>
            <ul style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 8, paddingLeft: 20 }}>
              <li><code>gmail.send</code> — enviar correos desde tu cuenta. No lee tu bandeja.</li>
              <li><code>userinfo.email</code> — saber qué cuenta autorizaste.</li>
              <li><code>userinfo.profile</code> — tu nombre, para el header "De: …".</li>
            </ul>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              Puedes revocar el acceso en cualquier momento desde{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--primary)" }}
              >
                myaccount.google.com/permissions
              </a>{" "}
              o haciendo clic en "Desconectar" más arriba.
            </p>
          </details>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Link to="/listar" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          ← Volver
        </Link>
      </div>
    </div>
  );
}
