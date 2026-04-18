import { useState } from "react";

const ROLES = [
  { value: "admin",       label: "Administrador" },
  { value: "jefe_ventas", label: "Jefe de Ventas" },
  { value: "ventas",      label: "Ventas" },
];

export default function ModalCrearUsuario({ abierto, cerrar, onSuccess, onToast }) {
  const [email,        setEmail]       = useState("");
  const [nombre,       setNombre]      = useState("");
  const [rol,          setRol]         = useState("ventas");
  const [saving,       setSaving]      = useState(false);
  const [error,        setError]       = useState("");
  const [tempPassword, setTempPassword]= useState(null); // pantalla de éxito
  const [copied,       setCopied]      = useState(false);

  if (!abierto) return null;

  async function crearUsuario() {
    setError("");
    if (!email.trim())  { setError("El correo es obligatorio.");  return; }
    if (!nombre.trim()) { setError("El nombre es obligatorio.");  return; }

    setSaving(true);
    try {
      const endpoint = import.meta.env.VITE_CREATE_USER_ENDPOINT;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ email: email.trim(), nombre: nombre.trim(), rol }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al crear usuario");
        setSaving(false);
        return;
      }

      // Mostrar contraseña temporal si la devuelve el endpoint
      setTempPassword(data.password || data.temp_password || data.contraseña || null);
      onSuccess?.();

    } catch (err) {
      console.error(err);
      setError("Error inesperado al crear usuario.");
    } finally {
      setSaving(false);
    }
  }

  function copiarPassword() {
    if (!tempPassword) return;
    navigator.clipboard.writeText(tempPassword).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleClose() {
    if (saving) return;
    if (tempPassword) onToast?.({ type: "success", message: "Usuario creado correctamente." });
    setEmail(""); setNombre(""); setRol("ventas");
    setError(""); setTempPassword(null); setCopied(false);
    cerrar();
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px",
    }}>
      <div style={{
        background: "var(--surface)", borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.20)",
        width: "100%", maxWidth: "460px",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}>

        {/* ── PANTALLA ÉXITO (contraseña temporal) ── */}
        {tempPassword ? (
          <>
            <div style={{ padding: "32px 28px 24px", textAlign: "center" }}>
              {/* Icono check */}
              <div style={{
                width: "56px", height: "56px", borderRadius: "50%",
                background: "#f0fdf4", border: "2px solid #bbf7d0",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px",
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>
                Usuario creado
              </h2>
              <p style={{ fontSize: "13.5px", color: "var(--text-muted)", margin: "0 0 24px", lineHeight: 1.5 }}>
                Comparte estas credenciales con <strong style={{ color: "var(--text)" }}>{nombre}</strong>.<br />
                Al iniciar sesión por primera vez se le pedirá cambiar la contraseña.
              </p>

              {/* Credenciales */}
              <div style={{
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", padding: "16px 18px",
                textAlign: "left", marginBottom: "16px",
              }}>
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "3px" }}>
                    Correo
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text)", fontFamily: "monospace" }}>
                    {email}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: "3px" }}>
                    Contraseña temporal
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <code style={{
                      fontSize: "18px", fontWeight: 700, color: "var(--primary-dark)",
                      letterSpacing: "0.12em", flex: 1,
                    }}>
                      {tempPassword}
                    </code>
                    <button
                      onClick={copiarPassword}
                      style={{
                        display: "flex", alignItems: "center", gap: "5px",
                        padding: "5px 12px", borderRadius: "var(--radius)",
                        border: "1px solid var(--border-strong)",
                        background: copied ? "#f0fdf4" : "var(--surface)",
                        color: copied ? "#16a34a" : "var(--text-muted)",
                        fontSize: "12px", fontWeight: 600, cursor: "pointer",
                        transition: "all .15s",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {copied ? "✓ Copiado" : "Copiar"}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{
                fontSize: "12px", color: "var(--text-muted)",
                background: "#fffbeb", border: "1px solid #fde68a",
                borderRadius: "var(--radius)", padding: "10px 14px",
                textAlign: "left",
              }}>
                Guarda esta contraseña ahora — no podrás verla nuevamente.
              </div>
            </div>

            <div style={{ padding: "0 28px 24px" }}>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleClose}>
                Entendido, cerrar
              </button>
            </div>
          </>
        ) : (
          <>
            {/* ── FORMULARIO CREAR ── */}
            <div style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)", margin: 0 }}>
                Crear Usuario
              </h2>
              <button
                onClick={handleClose}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "20px", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="field">
                <label className="field-label">Nombre *</label>
                <input
                  className="input"
                  placeholder="Nombre completo"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="field">
                <label className="field-label">Correo electrónico *</label>
                <input
                  className="input"
                  type="email"
                  placeholder="correo@empresa.cl"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="field">
                <label className="field-label">Rol</label>
                <select
                  className="input"
                  value={rol}
                  onChange={(e) => setRol(e.target.value)}
                  disabled={saving}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div style={{
                  padding: "10px 14px", borderRadius: "var(--radius)",
                  background: "#fef2f2", border: "1px solid #fecaca",
                  color: "#b91c1c", fontSize: "13px",
                }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{
              padding: "14px 24px 20px",
              borderTop: "1px solid var(--border)",
              display: "flex", justifyContent: "flex-end", gap: "10px",
            }}>
              <button className="btn btn-secondary" onClick={handleClose} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={crearUsuario} disabled={saving}>
                {saving ? "Creando…" : "Crear Usuario"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
