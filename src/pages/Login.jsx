import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import {
  PERMISOS_GOOGLE,
  conectarCorreoDeGoogle,
  esCuentaNoRegistrada,
  leerErrorDeUrl,
  marcarIdaAGoogle,
  mensajeCuentaNoRegistrada,
  mensajeErrorGoogle,
  olvidarIdaAGoogle,
  vieneDeGoogle,
} from "../lib/ingresoEquipo";

/* ── Ingreso con Google (2026-11-12) ───────────────────────────────
   Google lleva a la MISMA cuenta que el correo y la contraseña (Supabase enlaza
   por correo). Al volver de Google se revisa que la cuenta sea del equipo: si
   el servidor dice que no tiene usuario, se cierra la sesión y se explica. */

// Con qué llegó la persona al login (se lee una vez, antes de limpiar la URL).
function leerLlegada() {
  if (typeof window === "undefined") return { errorUrl: null, aviso: "", deGoogle: false };
  const { search, hash } = window.location;
  return {
    errorUrl: leerErrorDeUrl(search, hash),
    aviso: new URLSearchParams(search).get("aviso") || "",
    deGoogle: vieneDeGoogle(hash),
  };
}

// Una sola revisión por carga de página, aunque el componente monte dos veces.
let revision = null;
function revisarCuentaDeGoogle() {
  if (!revision) {
    revision = (async () => {
      let sesion = null;
      try {
        const { data } = await supabase.auth.getSession();
        sesion = data?.session || null;
      } catch { /* sin sesión */ }
      olvidarIdaAGoogle();
      // Volvió sin sesión (canceló en Google o retrocedió): se queda en el login.
      if (!sesion) return { entra: false, mensaje: "" };
      try {
        await api.get("/auth/profile");
      } catch (e) {
        if (e?.status === 401 || e?.status === 403) {
          try { await supabase.auth.signOut(); } catch { /* ya sin sesión */ }
          if (esCuentaNoRegistrada(e)) return { entra: false, mensaje: mensajeCuentaNoRegistrada(sesion.user?.email) };
          if (e.status === 403) return { entra: false, mensaje: e.message || "No tienes acceso a la plataforma. Contacta a administración." };
          return { entra: false, mensaje: "No se pudo validar tu sesión. Intenta ingresar de nuevo." };
        }
        // El servidor no respondió claro (red, límite de pedidos): se entra igual;
        // cada pantalla vuelve a validar la cuenta contra el servidor.
      }
      // El correo queda conectado con esta misma cuenta de Google. Se espera un
      // momento a que el servidor lo guarde, pero entrar no depende de eso.
      await Promise.race([
        conectarCorreoDeGoogle(sesion),
        new Promise((listo) => setTimeout(listo, 6000)),
      ]);
      return { entra: true, mensaje: "" };
    })();
  }
  return revision;
}

/* ── Hero graphic ──────────────────────────────────────────────── */
function HeroGraphic() {
  return (
    <svg viewBox="0 0 340 260" style={{ width: "100%", maxWidth: "300px", height: "auto" }} aria-hidden="true">
      <defs>
        <style>{`
          @keyframes hg-float {
            0%,100% { transform: translateY(0px); }
            50%      { transform: translateY(-10px); }
          }
          @keyframes hg-spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
          .hg-float { animation: hg-float 5s ease-in-out infinite; }
          .hg-orbit { transform-origin: 170px 130px; animation: hg-spin 11s linear infinite; }
          .hg-orbit2 { transform-origin: 170px 130px; animation: hg-spin 17s linear infinite reverse; }
        `}</style>
        <radialGradient id="hg-bg1" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(40,174,177,0.14)" />
          <stop offset="100%" stopColor="rgba(40,174,177,0)"    />
        </radialGradient>
      </defs>

      {/* Soft background blobs */}
      <circle cx="70"  cy="50"  r="90" fill="url(#hg-bg1)" opacity="0.7" />
      <circle cx="280" cy="210" r="80" fill="url(#hg-bg1)" opacity="0.6" />

      {/* Orbit rings */}
      <circle cx="170" cy="130" r="100" fill="none" stroke="rgba(40,174,177,0.12)" strokeWidth="1"   strokeDasharray="5 7" />
      <circle cx="170" cy="130" r="72"  fill="none" stroke="rgba(40,174,177,0.08)" strokeWidth="1" />

      {/* Orbiting dots */}
      <g className="hg-orbit">
        <circle cx="270" cy="130" r="6" fill="rgba(40,174,177,0.55)" />
        <circle cx="70"  cy="130" r="4" fill="rgba(40,174,177,0.35)" />
      </g>
      <g className="hg-orbit2">
        <circle cx="170" cy="30"  r="5" fill="rgba(40,174,177,0.45)" />
        <circle cx="170" cy="230" r="3.5" fill="rgba(40,174,177,0.30)" />
      </g>

      {/* Center group */}
      <g className="hg-float">
        <circle cx="170" cy="130" r="56" fill="rgba(40,174,177,0.07)" />
        <circle cx="170" cy="130" r="42" fill="rgba(40,174,177,0.11)" />
        <circle cx="170" cy="130" r="30" fill="rgba(40,174,177,0.90)" />
        {/* Medical cross */}
        <rect x="165" y="117" width="10" height="26" rx="3.5" fill="white" />
        <rect x="157" y="125" width="26" height="10" rx="3.5" fill="white" />
      </g>

      {/* Pulsing ring */}
      <circle cx="170" cy="130" fill="none" stroke="rgba(40,174,177,0.28)" strokeWidth="1.5">
        <animate attributeName="r" values="32;64;32" dur="3.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0;0.5" dur="3.2s" repeatCount="indefinite" />
      </circle>

      {/* Corner accents */}
      <rect x="18" y="18" width="13" height="13" rx="3" fill="none" stroke="rgba(40,174,177,0.22)" strokeWidth="1.5" transform="rotate(18 24.5 24.5)" />
      <rect x="295" y="22" width="11" height="11" rx="3" fill="none" stroke="rgba(40,174,177,0.18)" strokeWidth="1.5" transform="rotate(-12 300.5 27.5)" />
      <circle cx="30"  cy="215" r="9" fill="none" stroke="rgba(40,174,177,0.18)" strokeWidth="1.5" />
      <circle cx="316" cy="190" r="6" fill="none" stroke="rgba(40,174,177,0.15)" strokeWidth="1.5" />
    </svg>
  );
}

/* ── Feature list item ─────────────────────────────────────────── */
function Feature({ icon, title, desc }) {
  return (
    <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
      <div style={{
        width: "34px", height: "34px", borderRadius: "9px", flexShrink: 0,
        background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.30)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#ffffff", lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.72)", marginTop: "2px", lineHeight: 1.4 }}>{desc}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
export default function Login() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPwd,  setShowPwd]  = useState(false);
  const [llegada] = useState(leerLlegada);
  const [error,    setError]    = useState(() => {
    if (llegada.errorUrl) return mensajeErrorGoogle(llegada.errorUrl);
    if (llegada.aviso === "cuenta_no_registrada") return mensajeCuentaNoRegistrada("");
    return "";
  });
  const [loading,  setLoading]  = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  // Volviendo de Google: mientras se revisa la cuenta no se muestra el formulario activo.
  const [verificando, setVerificando] = useState(llegada.deGoogle && !llegada.errorUrl);
  const ocupado = loading || loadingGoogle || verificando;

  useEffect(() => {
    let vivo = true;
    // El error de Google o el aviso ya quedó en pantalla: fuera de la barra de direcciones.
    if (llegada.errorUrl || llegada.aviso) {
      try { window.history.replaceState(null, "", "/login"); } catch { /* */ }
    }
    if (llegada.errorUrl || !llegada.deGoogle) {
      olvidarIdaAGoogle();
    } else {
      revisarCuentaDeGoogle().then((r) => {
        if (r.entra) { window.location.replace("/listar"); return; }
        if (!vivo) return;
        if (r.mensaje) setError(r.mensaje);
        setVerificando(false);
      });
    }
    // Si retrocede desde la pantalla de Google, el navegador devuelve esta página
    // tal como quedó («Conectando con Google…»): se reactiva.
    const alVolver = (ev) => {
      if (!ev.persisted) return;
      olvidarIdaAGoogle();
      setLoadingGoogle(false);
    };
    window.addEventListener("pageshow", alVolver);
    return () => {
      vivo = false;
      window.removeEventListener("pageshow", alVolver);
    };
  }, [llegada]);

  /* Además de identificar a la persona, pide los permisos de Gmail y Calendar
     para que su correo quede conectado al entrar (ver ingresoEquipo.js).
     `select_account` deja elegir la cuenta cuando el navegador tiene varias de
     Google abiertas; no se fuerza `consent`, así Google pregunta solo la
     primera vez y no en cada ingreso. */
  async function handleGoogleLogin() {
    if (ocupado) return;
    setError("");
    setLoadingGoogle(true);
    marcarIdaAGoogle();
    let err = null;
    try {
      const res = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/login`,
          // Permisos de Gmail y Calendar + acceso sin conexión: con esto Google
          // entrega el token con el que el correo queda conectado al entrar.
          scopes: PERMISOS_GOOGLE,
          queryParams: { prompt: "select_account", access_type: "offline" },
        },
      });
      err = res?.error || null;
    } catch (e) {
      err = e;
    }
    if (err) {
      olvidarIdaAGoogle();
      setLoadingGoogle(false);
      setError("No se pudo abrir el ingreso con Google. Intenta de nuevo o entra con tu correo y contraseña.");
    }
    // Si todo va bien, el navegador se va a Google y vuelve a /login.
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (ocupado) return;
    setError("");

    if (!email || !password) {
      setError("Debes ingresar correo y contraseña.");
      return;
    }

    setLoading(true);
    // Cuentas internas sin correo real: si escriben solo el username (sin "@"),
    // se completa con el dominio sintético interno (ej: lriquelme → lriquelme@amsodent.local).
    const identificador = email.includes("@") ? email.trim() : `${email.trim()}@amsodent.local`;
    const { error: err } = await supabase.auth.signInWithPassword({ email: identificador, password });
    setLoading(false);

    if (err) {
      setError("Credenciales incorrectas. Verifica tu correo y contraseña.");
      return;
    }

    window.location.href = "/listar";
  }


  return (
    <div className="login-shell">

      {/* ── LEFT: hero panel ──────────────────────────── */}
      <div className="login-hero">
        <div className="login-hero-noise" />
        <div className="login-hero-content">

          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
            <img
              src="/logo-amsodent.png"
              alt="Amsodent"
              style={{ width: "auto", maxWidth: "240px", height: "auto" }}
            />
          </div>

          {/* Graphic */}
          <div style={{ margin: "0 auto 16px", maxWidth: "300px" }}>
            <HeroGraphic />
          </div>

          {/* Tagline */}
          <h1 style={{
            fontSize: "24px", fontWeight: 800, color: "#ffffff",
            lineHeight: 1.25, margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}>
            Tu panel de gestión<br />
            <span style={{ color: "rgba(255,255,255,0.80)" }}>todo en un solo lugar.</span>
          </h1>
          <p style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.72)", margin: "0 0 32px", lineHeight: 1.6 }}>
            Cotizaciones, clientes, campañas y métricas<br />para el equipo Amsodent.
          </p>

          {/* Features */}
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <Feature
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
              title="Cotizaciones rápidas"
              desc="Genera y envía propuestas en minutos"
            />
            <Feature
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              title="Gestión de clientes"
              desc="Centraliza toda la información comercial"
            />
            <Feature
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.90)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
              title="Métricas en tiempo real"
              desc="Ventas, metas y campañas al instante"
            />
          </div>
        </div>
      </div>

      {/* ── RIGHT: form panel ─────────────────────────── */}
      <div className="login-form-panel">

        {/* Decorative rings */}
        <div className="lf-ring-1" />
        <div className="lf-ring-2" />
        <div className="lf-ring-3" />

        {/* Mobile logo */}
        <div className="login-mobile-logo">
          <img
            src="/logo-amsodent.png"
            alt="Amsodent"
            style={{ width: "48px", height: "auto", objectFit: "contain" }}
          />
        </div>

        <div className="login-form-inner">

          {/* Card header: logo centered + title */}
          <div className="lf-card-header">
            <img
              src="/logo-amsodent.png"
              alt="Amsodent"
              style={{ width: "160px", height: "auto", objectFit: "contain" }}
            />
            <div>
              <h2 className="login-form-title">Iniciar sesión</h2>
              <p className="login-form-sub">Ingresa tus credenciales para continuar</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="login-stack">
            <div className="field">
              <label className="field-label">Correo electrónico o usuario</label>
              <input
                type="text"
                className="input input-lg"
                placeholder="correo@amsodent.cl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div className="field">
              <label className="field-label">Contraseña</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPwd ? "text" : "password"}
                  className="input input-lg"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: "44px" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  style={{
                    position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-muted)", padding: "4px",
                    display: "flex", alignItems: "center",
                  }}
                  tabIndex={-1}
                >
                  {showPwd ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                padding: "11px 14px", borderRadius: "var(--radius)",
                background: "#fef2f2", border: "1px solid #fecaca",
                color: "#b91c1c", fontSize: "13.5px", lineHeight: 1.4,
                display: "flex", alignItems: "flex-start", gap: "8px",
              }}>
                <svg style={{ flexShrink: 0, marginTop: "1px" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button type="submit" className="login-btn" disabled={ocupado}>
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg className="login-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Verificando…
                </span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Ingresar al sistema
                </span>
              )}
            </button>

            <div className="login-sep" aria-hidden="true"><span>o</span></div>

            <button
              type="button"
              className="login-google-btn"
              onClick={handleGoogleLogin}
              disabled={ocupado}
              title="Entra con la cuenta de Google de tu correo de trabajo: llega al mismo usuario que con tu contraseña y deja tu correo conectado"
            >
              {loadingGoogle || verificando ? (
                <svg className="login-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
              )}
              <span>{verificando ? "Verificando tu cuenta…" : loadingGoogle ? "Conectando con Google…" : "Continuar con Google"}</span>
            </button>

            <p className="login-hint">
              Solo equipo Amsodent · usa el correo de tu usuario
            </p>
          </form>

          <div className="login-footer">
            <span>¿Olvidaste tu contraseña?</span>
            <a href="/reset-password" className="login-footer-link">Recupérala aquí</a>
          </div>

        </div>
      </div>

    </div>
  );
}
