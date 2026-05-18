import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";

// Página de aterrizaje tras el callback OAuth de Google. El backend redirige
// aquí con ?status=ok&email=... o ?status=error&reason=...
// Mostramos un mensaje breve y volvemos a /perfil al cabo de 2 segundos.
export default function GmailConectado() {
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);
  const status = params.get("status");
  const email = params.get("email") || "";
  const reason = params.get("reason") || "";

  useEffect(() => {
    const t = setTimeout(() => {
      navigate(`/perfil?gmail=${status === "ok" ? "ok" : "error"}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`, { replace: true });
    }, 1800);
    return () => clearTimeout(t);
  }, [navigate, status, reason]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 460,
          textAlign: "center",
          boxShadow: "0 10px 32px rgba(15,23,42,0.08)",
        }}
      >
        {status === "ok" ? (
          <>
            <CheckCircle2 size={48} color="#15803d" style={{ margin: "0 auto" }} />
            <h2 style={{ marginTop: 12, color: "#15803d" }}>Gmail conectado</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              {email
                ? <>Conectaste la cuenta <strong>{email}</strong>.</>
                : "La conexión se completó correctamente."}
            </p>
          </>
        ) : (
          <>
            <XCircle size={48} color="#b91c1c" style={{ margin: "0 auto" }} />
            <h2 style={{ marginTop: 12, color: "#b91c1c" }}>No pudimos conectar Gmail</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
              {reason || "Error desconocido. Vuelve a intentar desde tu perfil."}
            </p>
          </>
        )}
        <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 16 }}>
          Volviendo a tu perfil…
        </p>
      </div>
    </div>
  );
}
