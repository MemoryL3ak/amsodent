import { useState } from "react";
import { api } from "../lib/api";

export default function ModalResetClave({ user, cerrar, onToast }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!user) return null;

  function handleClose() {
    if (saving) return;
    setPassword("");
    setConfirm("");
    setMostrar(false);
    setError("");
    cerrar();
  }

  function generarSugerida() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let pass = "";
    for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    setPassword(pass);
    setConfirm(pass);
    setMostrar(true);
    setError("");
  }

  async function guardar() {
    setError("");
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    try {
      await api.post(`/usuarios/profiles/${user.id}/set-password`, { password });
      onToast?.({
        type: "success",
        message: `Contraseña actualizada para ${user.nombre || user.email}.`,
      });
      handleClose();
    } catch (e) {
      setError(e?.message || "Error al actualizar la contraseña.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-lg)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.20)",
          width: "100%", maxWidth: "460px",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)", margin: 0 }}>
            Cambiar contraseña
          </h2>
          <button
            onClick={handleClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", fontSize: "20px", lineHeight: 1,
            }}
            disabled={saving}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "10px 14px",
              fontSize: "13px",
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>
              Usuario
            </div>
            <div style={{ fontWeight: 500 }}>{user.nombre || "(Sin nombre)"}</div>
            <div style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "12.5px" }}>{user.email}</div>
          </div>

          <div className="field">
            <label className="field-label">Nueva contraseña *</label>
            <input
              className="input"
              type={mostrar ? "text" : "password"}
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
              autoComplete="new-password"
            />
          </div>

          <div className="field">
            <label className="field-label">Confirmar contraseña *</label>
            <input
              className="input"
              type={mostrar ? "text" : "password"}
              placeholder="Repetir nueva contraseña"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={saving}
              autoComplete="new-password"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12.5px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={mostrar}
                onChange={(e) => setMostrar(e.target.checked)}
                disabled={saving}
              />
              Mostrar contraseña
            </label>
            <button
              type="button"
              onClick={generarSugerida}
              disabled={saving}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--primary)", fontWeight: 600, fontSize: "12.5px",
              }}
            >
              Generar sugerida
            </button>
          </div>

          <div
            style={{
              fontSize: "12px", color: "var(--text-muted)",
              background: "#fffbeb", border: "1px solid #fde68a",
              borderRadius: "var(--radius)", padding: "10px 14px",
            }}
          >
            La contraseña se cambiará inmediatamente. Comparte la nueva clave con el usuario por un canal seguro.
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px", borderRadius: "var(--radius)",
                background: "#fef2f2", border: "1px solid #fecaca",
                color: "#b91c1c", fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "14px 24px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex", justifyContent: "flex-end", gap: "10px",
          }}
        >
          <button className="btn btn-secondary" onClick={handleClose} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={guardar} disabled={saving}>
            {saving ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </div>
      </div>
    </div>
  );
}
