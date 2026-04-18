import { useState } from "react";
import { supabase } from "../lib/supabase";

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
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Debes ingresar correo y contraseña.");
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
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
              src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
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
            src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
            alt="Amsodent"
            style={{ width: "48px", height: "auto", objectFit: "contain" }}
          />
        </div>

        <div className="login-form-inner">

          {/* Card header: logo centered + title */}
          <div className="lf-card-header">
            <img
              src="https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png"
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
              <label className="field-label">Correo electrónico</label>
              <input
                type="email"
                className="input input-lg"
                placeholder="correo@amsodent.cl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
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

            <button type="submit" className="login-btn" disabled={loading}>
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
