import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2, Lock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { bloqueoSesionActual, liberarBloqueoSesion, marcarSalidaVoluntaria, suscribirBloqueoSesion } from "../lib/bloqueoSesion";

/* ── Ventana «Tu sesión se cerró» (2026-11-26) ───────────────────────────────
   Pedido de Ariel: «cuando se cierra la sesión, no se pierda la información en
   la que se está trabajando». Ver lib/bloqueoSesion.js.

   La sesión ya está cerrada (sin acceso a los datos), pero la pantalla sigue
   montada debajo, con todo lo que la persona tenía escrito. Esta ventana la
   tapa y pide la clave de ESA cuenta; al ingresarla se abre una sesión nueva y
   la pantalla queda tal cual. «Ir al inicio de sesión» sale del todo (para
   entrar con otra cuenta o con Google), avisando que lo no guardado se pierde. */
export default function SesionBloqueada() {
  const bloqueo = useSyncExternalStore(suscribirBloqueoSesion, bloqueoSesionActual, () => null);
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [salir, setSalir] = useState(false);
  const campo = useRef(null);

  useEffect(() => {
    if (!bloqueo) return undefined;
    setClave("");
    setError("");
    setSalir(false);
    const t = setTimeout(() => campo.current?.focus(), 50);
    // Mientras está bloqueada, el foco no debe escaparse a la pantalla de abajo.
    const retener = (e) => {
      const caja = document.querySelector(".sesion-bloqueada-caja");
      if (caja && !caja.contains(e.target)) { e.stopPropagation(); campo.current?.focus(); }
    };
    document.addEventListener("focusin", retener, true);
    return () => { clearTimeout(t); document.removeEventListener("focusin", retener, true); };
  }, [bloqueo]);

  if (!bloqueo) return null;

  async function continuar(e) {
    e?.preventDefault?.();
    if (ocupado) return;
    if (!clave) { setError("Escribe tu contraseña."); return; }
    if (!bloqueo.email) { setError("No se pudo reconocer la cuenta. Usa «Ir al inicio de sesión»."); return; }
    setOcupado(true);
    setError("");
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email: bloqueo.email, password: clave });
      if (err || !data?.session) {
        setError(/invalid login|invalid_credentials/i.test(String(err?.message || err?.code || "")) || err?.status === 400
          ? "Contraseña incorrecta."
          : `No se pudo abrir la sesión${err?.message ? `: ${err.message}` : ""}. Revisa tu conexión e inténtalo de nuevo.`);
        return;
      }
      // Por seguridad: la sesión nueva debe ser de la misma persona que estaba trabajando.
      if (bloqueo.userId && data.session.user?.id !== bloqueo.userId) {
        marcarSalidaVoluntaria();
        await supabase.auth.signOut();
        window.location.href = "/login";
        return;
      }
      setClave("");
      liberarBloqueoSesion();
    } catch (e2) {
      setError(`No se pudo abrir la sesión${e2?.message ? `: ${e2.message}` : ""}.`);
    } finally {
      setOcupado(false);
    }
  }

  function irAlLogin() {
    marcarSalidaVoluntaria();
    window.location.href = "/login";
  }

  const porInactividad = bloqueo.motivo === "inactividad";
  return createPortal(
    <div
      className="sesion-bloqueada"
      role="dialog"
      aria-modal="true"
      aria-label="Sesión cerrada"
      style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(15,23,42,.72)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <form
        className="sesion-bloqueada-caja"
        onSubmit={continuar}
        style={{ width: 400, maxWidth: "100%", background: "var(--surface, #fff)", borderRadius: 14, boxShadow: "0 30px 70px -20px rgba(15,23,42,.6)", padding: "24px 24px 20px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(40,174,177,.12)", color: "var(--primary-dark, #1c8a8c)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Lock size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text, #0f172a)" }}>Tu sesión se cerró</div>
            <div style={{ fontSize: 12.5, color: "var(--text-muted, #64748b)" }}>{porInactividad ? "Pasaron 30 minutos sin actividad." : "La sesión terminó en este navegador."}</div>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--text-soft, #475569)" }}>
          Lo que tenías en pantalla <b>sigue ahí</b>. Ingresa tu contraseña para continuar donde quedaste.
        </p>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted, #64748b)", marginBottom: 4 }}>Cuenta</span>
          <input className="input" value={bloqueo.email || "(cuenta no reconocida)"} readOnly tabIndex={-1} autoComplete="username" style={{ width: "100%", background: "var(--bg, #f8fafc)", color: "var(--text-soft, #475569)" }} />
        </label>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-muted, #64748b)", marginBottom: 4 }}>Contraseña</span>
          <input
            ref={campo}
            type="password"
            className="input campo-clave-bloqueo"
            value={clave}
            onChange={(e) => { setClave(e.target.value); setError(""); }}
            autoComplete="current-password"
            disabled={ocupado}
            style={{ width: "100%" }}
          />
        </label>
        {error && <div role="alert" style={{ fontSize: 12.5, color: "#b91c1c", fontWeight: 600, overflowWrap: "anywhere" }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={ocupado} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 40 }}>
          {ocupado ? <Loader2 size={15} className="spin" /> : null} {ocupado ? "Abriendo sesión…" : "Continuar donde quedé"}
        </button>
        {!salir ? (
          <button type="button" onClick={() => setSalir(true)} disabled={ocupado} className="table-link" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, padding: 0, alignSelf: "center" }}>
            Entrar con otra cuenta o con Google
          </button>
        ) : (
          <div style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "#78350f", lineHeight: 1.45 }}>
            Al ir al inicio de sesión se cierra esta pantalla y <b>se pierde lo que no hayas guardado</b>.
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSalir(false)}>Volver</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={irAlLogin} style={{ color: "#b91c1c" }}>Ir al inicio de sesión</button>
            </div>
          </div>
        )}
      </form>
    </div>,
    document.body,
  );
}
