import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

const ROLES = [
  { value: "admin",                label: "Administrador" },
  { value: "jefe_ventas",          label: "Jefe de Ventas" },
  { value: "jefe_ventas_especial", label: "Jefe de Ventas Especial" },
  { value: "ventas",               label: "Ventas" },
  { value: "ventas_especial",      label: "Ventas Especial" },
  { value: "contabilidad",         label: "Contabilidad" },
];

export default function ModalEditarUsuario({ user, close, onToast }) {
  const [nombre, setNombre] = useState(user.nombre || "");
  const [rol,    setRol]    = useState(user.rol    || "ventas");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  // Oficinas de marcaje asignadas al usuario.
  const [oficinas, setOficinas] = useState([]);
  const [oficinaIds, setOficinaIds] = useState([]);
  const [cargandoOf, setCargandoOf] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setCargandoOf(true);
      try {
        const [ofs, asig] = await Promise.all([
          api.get("/marcajes/oficinas").catch(() => []),
          user.email
            ? api.get(`/marcajes/oficinas-trabajador?email=${encodeURIComponent(user.email)}`).catch(() => ({ ids: [] }))
            : Promise.resolve({ ids: [] }),
        ]);
        if (cancel) return;
        setOficinas(Array.isArray(ofs) ? ofs : []);
        setOficinaIds(Array.isArray(asig?.ids) ? asig.ids.map(Number) : []);
      } finally {
        if (!cancel) setCargandoOf(false);
      }
    })();
    return () => { cancel = true; };
  }, [user.email]);

  function toggleOficina(id) {
    setOficinaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function guardar() {
    setError("");
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }

    setSaving(true);
    const { error: e } = await supabase
      .from("profiles")
      .update({ nombre: nombre.trim(), rol })
      .eq("id", user.id);

    if (e) {
      setSaving(false);
      setError("Error al guardar los cambios.");
      console.error(e);
      return;
    }

    // Guardar oficinas de marcaje asignadas.
    if (user.email) {
      try {
        await api.put("/marcajes/oficinas-trabajador", {
          email: user.email,
          oficina_ids: oficinaIds,
        });
      } catch (errOf) {
        console.warn("No se pudieron guardar las oficinas:", errOf?.message);
      }
    }

    setSaving(false);
    onToast?.({ type: "success", message: "Usuario actualizado correctamente." });
    close();
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

          {/* Oficinas de marcaje asignadas */}
          <div className="field">
            <label className="field-label">Oficinas de marcaje</label>
            {cargandoOf ? (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Cargando oficinas…</div>
            ) : oficinas.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                No hay oficinas registradas. Créalas en «Monitoreo de Asistencia».
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "8px 10px" }}>
                {oficinas.map((o) => (
                  <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={oficinaIds.includes(Number(o.id))}
                      onChange={() => toggleOficina(Number(o.id))}
                      disabled={saving}
                    />
                    <span>
                      {o.nombre}
                      {o.direccion ? <span style={{ color: "var(--text-muted)", fontSize: 11.5 }}> · {o.direccion}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="field-hint">El usuario solo podrá marcar asistencia en las oficinas seleccionadas.</div>
          </div>

          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              color: "#0369a1",
              fontSize: "12px",
              lineHeight: 1.5,
            }}
          >
            La casilla de correo de cada vendedor ya no se configura aquí. Cada
            usuario conecta su propia cuenta de Google desde el módulo{" "}
            <strong>Mi Correo</strong>.
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
