import { useState } from "react";
import { supabase } from "../lib/supabase";

const ROLES = [
  { value: "admin",       label: "Administrador" },
  { value: "jefe_ventas", label: "Jefe de Ventas" },
  { value: "ventas",      label: "Ventas" },
];

export default function ModalEditarUsuario({ user, close, onToast }) {
  const [nombre, setNombre] = useState(user.nombre || "");
  const [rol,    setRol]    = useState(user.rol    || "ventas");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  async function guardar() {
    setError("");
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }

    setSaving(true);
    const { error: e } = await supabase
      .from("profiles")
      .update({ nombre: nombre.trim(), rol })
      .eq("id", user.id);

    setSaving(false);

    if (e) {
      setError("Error al guardar los cambios.");
      console.error(e);
    } else {
      onToast?.({ type: "success", message: "Usuario actualizado correctamente." });
      close();
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px",
    }}>
      <div style={{
        background: "var(--surface)", borderRadius: "var(--radius-lg)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        width: "100%", maxWidth: "440px",
        border: "1px solid var(--border)",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)", margin: 0 }}>
            Editar Usuario
          </h2>
          <button
            onClick={close}
            disabled={saving}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "20px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Email (solo lectura) */}
          <div className="field">
            <label className="field-label">Correo electrónico</label>
            <input
              className="input"
              value={user.email || ""}
              readOnly
              style={{ background: "var(--bg)", color: "var(--text-muted)" }}
            />
          </div>

          <div className="field">
            <label className="field-label">Nombre *</label>
            <input
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
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

        {/* Footer */}
        <div style={{
          padding: "14px 24px 20px",
          borderTop: "1px solid var(--border)",
          display: "flex", justifyContent: "flex-end", gap: "10px",
        }}>
          <button className="btn btn-secondary" onClick={close} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={guardar} disabled={saving}>
            {saving ? "Guardando…" : "Guardar Cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
