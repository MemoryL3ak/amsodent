import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import Avatar from "./Avatar";
import DropdownSelect from "./ui/DropdownSelect";

const ROLES = [
  { value: "admin",                label: "Administrador" },
  { value: "jefe_ventas",          label: "Jefe de Ventas" },
  { value: "jefe_ventas_especial", label: "Jefe de Ventas Especial" },
  { value: "ventas",               label: "Ventas" },
  { value: "ventas_especial",      label: "Ventas Especial" },
  { value: "contabilidad",         label: "Contabilidad" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* (2026-10-22) Rediseño: la ventana crecía con cada campo nuevo hasta salirse
   de la pantalla (en un 13" no se veían ni el título ni los botones). Ahora
   los campos van de a dos por fila, la lista de oficinas es corta y con
   scroll propio, y la tarjeta se acota al alto de la ventana. Además el
   correo de acceso pasó a ser editable (antes era solo lectura). */
export default function ModalEditarUsuario({ user, perfiles = [], close, onToast }) {
  const emailOriginal = String(user.email || "").trim().toLowerCase();

  const [nombre, setNombre] = useState(user.nombre || "");
  const [rol,    setRol]    = useState(user.rol    || "ventas");
  const [email,  setEmail]  = useState(user.email  || "");
  const [emailAlterno, setEmailAlterno] = useState(user.email_alterno || "");
  // Al cambiar el correo de acceso, el anterior se propone como alterno: así
  // el historial (ventas, bitácora, marcajes) sigue resolviendo a esta persona.
  const [conservarAnterior, setConservarAnterior] = useState(true);
  const [perfilId, setPerfilId] = useState(user.permission_profile_id ? String(user.permission_profile_id) : "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || "");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const emailNuevo  = email.trim().toLowerCase();
  const cambiaEmail = emailNuevo !== emailOriginal;
  const alternoEfectivo = useMemo(() => {
    const a = emailAlterno.trim().toLowerCase();
    if (a) return a;
    if (cambiaEmail && conservarAnterior && emailOriginal) return emailOriginal;
    return "";
  }, [emailAlterno, cambiaEmail, conservarAnterior, emailOriginal]);

  const opcionesPerfil = useMemo(() => [
    { value: "", label: "Acceso por rol (predeterminado)" },
    ...perfiles.map((p) => ({ value: String(p.id), label: p.nombre, detalle: p.descripcion || undefined })),
  ], [perfiles]);

  async function subirAvatar(file) {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.putForm(`/usuarios/profiles/${user.id}/avatar`, fd);
      setAvatarUrl(r?.avatar_url || "");
      onToast?.({ type: "success", message: "Foto actualizada." });
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: e?.message || "No se pudo subir la foto. ¿Creaste el bucket 'avatars'?" });
    }
  }

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
    if (!emailNuevo) {
      setError("El correo de acceso no puede quedar vacío: es con el que la persona inicia sesión. Si quieres desligar esta casilla, reemplázala por otra.");
      return;
    }
    if (!EMAIL_RE.test(emailNuevo)) { setError("El correo de acceso no es válido."); return; }
    const alternoEscrito = emailAlterno.trim().toLowerCase();
    if (alternoEscrito && !EMAIL_RE.test(alternoEscrito)) { setError("El correo alterno no es válido."); return; }
    if (alternoEfectivo && alternoEfectivo === emailNuevo) { setError("El correo alterno no puede ser el mismo que el de acceso."); return; }

    setSaving(true);
    // Vía backend con AdminGuard (contención auditoría 2026-09-04): el update
    // directo a profiles desde el navegador permitía a cualquiera cambiar
    // roles; ahora la tabla queda cerrada por RLS y solo el backend escribe.
    try {
      await api.put(`/usuarios/profiles/${user.id}`, {
        nombre: nombre.trim(),
        rol,
        permission_profile_id: perfilId || null,
        email_alterno: alternoEfectivo || null,
        ...(cambiaEmail ? { email: emailNuevo } : {}),
      });
    } catch (e) {
      setSaving(false);
      setError(e?.message || "Error al guardar los cambios.");
      console.error(e);
      return;
    }

    // Oficinas de marcaje: se guardan con el correo que quedó vigente.
    const emailOficinas = cambiaEmail ? emailNuevo : (user.email || "");
    if (emailOficinas) {
      try {
        await api.put("/marcajes/oficinas-trabajador", {
          email: emailOficinas,
          oficina_ids: oficinaIds,
        });
      } catch (errOf) {
        console.warn("No se pudieron guardar las oficinas:", errOf?.message);
      }
    }

    setSaving(false);
    onToast?.({
      type: "success",
      message: cambiaEmail
        ? `Usuario actualizado. Desde ahora inicia sesión con ${emailNuevo}.`
        : "Usuario actualizado correctamente.",
    });
    close();
  }

  // Dos campos por fila; bajo ~460px de ancho caen a una columna.
  const dosColumnas = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,23,42,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) close(); }}
    >
      <div style={{
        background: "var(--surface)", borderRadius: "var(--radius-lg)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        width: "min(560px, 100%)", maxHeight: "calc(100vh - 32px)",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: "1px solid var(--border)",
      }}>
        {/* Header: foto + título + correo actual */}
        <div style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <Avatar src={avatarUrl} nombre={nombre || user.email} size={44} editable onUpload={subirAvatar} title="Cambiar la foto del usuario" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1.2 }}>
              Editar usuario
            </h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email || "sin correo"} · clic en la cámara para cambiar la foto
            </div>
          </div>
          <button
            onClick={close}
            disabled={saving}
            aria-label="Cerrar"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, padding: "0 2px" }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0 }}>
          <div style={dosColumnas}>
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
              <DropdownSelect
                value={rol}
                onChange={setRol}
                options={ROLES}
                disabled={saving}
                minWidth={200}
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div style={dosColumnas}>
            <div className="field">
              <label className="field-label">Correo de acceso *</label>
              <input
                className="input"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
              />
            </div>
            {/* Correo alterno (alias): la plataforma reconoce ambos correos
                como la misma persona (nombres, vendedor, envío de correos). */}
            <div className="field">
              <label className="field-label">Correo alterno</label>
              <input
                className="input"
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="segunda casilla (opcional)"
                value={emailAlterno}
                onChange={(e) => setEmailAlterno(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          {cambiaEmail && (
            <div style={{
              padding: "9px 12px", borderRadius: "var(--radius)",
              background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e",
              fontSize: 12.5, lineHeight: 1.45,
            }}>
              <div>
                <strong>Cambia el correo con el que entra.</strong> Desde ahora inicia sesión con{" "}
                <strong>{emailNuevo || "…"}</strong>; su contraseña no cambia.
              </div>
              {emailOriginal && !emailAlterno.trim() && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={conservarAnterior}
                    onChange={(e) => setConservarAnterior(e.target.checked)}
                    disabled={saving}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    Conservar <strong>{emailOriginal}</strong> como correo alterno, para que su
                    historial (ventas, bitácora, marcajes) siga apareciendo a su nombre.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="field">
            <label className="field-label">Perfil de permisos</label>
            <DropdownSelect
              value={perfilId}
              onChange={(v) => setPerfilId(v ? String(v) : "")}
              options={opcionesPerfil}
              disabled={saving}
              minWidth={240}
              style={{ width: "100%" }}
            />
            <div className="field-hint">Un perfil fija módulo por módulo lo que ve el usuario, por encima de su rol.</div>
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
              <div style={{ display: "flex", flexDirection: "column", maxHeight: 132, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "4px 6px" }}>
                {oficinas.map((o) => (
                  <label
                    key={o.id}
                    title={o.direccion || ""}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 4px", cursor: "pointer", color: "var(--text)", minWidth: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={oficinaIds.includes(Number(o.id))}
                      onChange={() => toggleOficina(Number(o.id))}
                      disabled={saving}
                      style={{ flexShrink: 0 }}
                    />
                    <span style={{ fontWeight: 600, flexShrink: 0 }}>{o.nombre}</span>
                    {o.direccion ? (
                      <span style={{ color: "var(--text-muted)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {o.direccion}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
            <div className="field-hint">
              Solo podrá marcar asistencia en las oficinas seleccionadas. La casilla para enviar
              correos se conecta desde <strong>Mi Correo</strong>, no aquí.
            </div>
          </div>

          {error && (
            <div style={{
              padding: "9px 12px", borderRadius: "var(--radius)",
              background: "#fef2f2", border: "1px solid #fecaca",
              color: "#b91c1c", fontSize: 13, lineHeight: 1.45,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex", justifyContent: "flex-end", gap: 10, flexShrink: 0,
        }}>
          <button className="btn btn-secondary" onClick={close} disabled={saving}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={guardar} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
