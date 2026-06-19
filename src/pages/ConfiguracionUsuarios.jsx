import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { MODULOS } from "../constants/modulos";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import ModalCrearUsuario from "../components/ModalCrearUsuario";
import ModalEditarUsuario from "../components/ModalEditarUsuario";
import ModalResetClave from "../components/ModalResetClave";
import { ShieldCheck, Pencil, Trash2, Plus } from "lucide-react";

const ROL_CONFIG = {
  admin:                { label: "Administrador",          text: "var(--primary-dark)", bg: "rgba(40,174,177,0.10)", border: "rgba(40,174,177,0.30)" },
  jefe_ventas:          { label: "Jefe de Ventas",         text: "#1d4ed8",             bg: "#eff6ff",               border: "#bfdbfe"               },
  jefe_ventas_especial: { label: "Jefe de Ventas Especial", text: "#0e7490",            bg: "#ecfeff",               border: "#a5f3fc"               },
  ventas:               { label: "Ventas",                 text: "#15803d",             bg: "#f0fdf4",               border: "#bbf7d0"               },
  ventas_especial:      { label: "Ventas Especial",        text: "#7c3aed",             bg: "#f5f3ff",               border: "#ddd6fe"               },
  contabilidad:         { label: "Contabilidad",           text: "#b45309",             bg: "#fffbeb",               border: "#fde68a"               },
};

function RolBadge({ rol }) {
  const cfg = ROL_CONFIG[rol] || ROL_CONFIG.usuario;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 10px", borderRadius: "999px",
      fontSize: "12px", fontWeight: 600,
      color: cfg.text, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      {cfg.label || rol}
    </span>
  );
}

export default function ConfiguracionUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
  const [modalCrear, setModalCrear]   = useState(false);
  const [modalEditar, setModalEditar] = useState(null);
  const [modalResetClave, setModalResetClave] = useState(null);
  const [confirmEliminar, setConfirmEliminar] = useState(null);

  // Perfiles de permisos.
  const [perfiles, setPerfiles] = useState([]);
  const [modalPerfil, setModalPerfil] = useState(null); // {} nuevo | perfil editar
  const [confirmEliminarPerfil, setConfirmEliminarPerfil] = useState(null);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await api.get("/usuarios/profiles");
      setUsuarios(data || []);
    } catch (error) {
      console.error("Error cargando usuarios:", error);
    }
    setLoading(false);
  }

  async function loadPerfiles() {
    try {
      const data = await api.get("/usuarios/perfiles");
      setPerfiles(Array.isArray(data) ? data : []);
    } catch { /* tabla puede no existir aún */ }
  }

  useEffect(() => { loadUsers(); loadPerfiles(); }, []);

  const perfilesMap = useMemo(() => {
    const m = {};
    perfiles.forEach((p) => { m[p.id] = p.nombre; });
    return m;
  }, [perfiles]);

  async function eliminarPerfilConfirmado() {
    const p = confirmEliminarPerfil;
    setConfirmEliminarPerfil(null);
    if (!p) return;
    try {
      await api.delete(`/usuarios/perfiles/${p.id}`);
      setToast({ type: "success", message: "Perfil eliminado." });
      loadPerfiles();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar el perfil." });
    }
  }

  async function enviarReset(email) {
    try {
      await api.post("/usuarios/reset-password", { email });
      setToast({ type: "success", message: `Correo de recuperación enviado a ${email}` });
    } catch (error) {
      setToast({ type: "error", message: "Error al enviar correo de recuperación" });
    }
  }

  function eliminarUsuario(u) {
    setConfirmEliminar(u);
  }

  async function confirmarEliminarUsuario() {
    const u = confirmEliminar;
    setConfirmEliminar(null);
    if (!u) return;
    try {
      await api.delete(`/usuarios/profiles/${u.id}`);
      setToast({ type: "success", message: "Usuario eliminado" });
      loadUsers();
    } catch (error) {
      setToast({ type: "error", message: "Error al eliminar usuario" });
    }
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={confirmEliminar !== null}
        title="¿Eliminar este usuario?"
        message={
          confirmEliminar
            ? `Vas a eliminar a "${confirmEliminar.nombre || confirmEliminar.email}". Esta acción no se puede deshacer.`
            : ""
        }
        confirmText="Eliminar usuario"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={confirmarEliminarUsuario}
        onCancel={() => setConfirmEliminar(null)}
      />

      {/* HEADER */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuarios</h1>
          <p className="page-subtitle">Gestión de cuentas y roles del sistema</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setModalCrear(true)}>
            + Crear Usuario
          </button>
        </div>
      </div>

      {/* TABLA */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Listado de usuarios</h3>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {usuarios.length} {usuarios.length === 1 ? "usuario" : "usuarios"}
          </span>
        </div>
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Perfil de permisos</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                      Cargando usuarios…
                    </td>
                  </tr>
                )}

                {!loading && usuarios.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                      No hay usuarios registrados.
                    </td>
                  </tr>
                )}

                {!loading && usuarios.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.nombre || <span style={{ color: "var(--text-muted)" }}>(Sin nombre)</span>}</td>
                    <td style={{ color: "var(--text-muted)" }}>{u.email}</td>
                    <td><RolBadge rol={u.rol} /></td>
                    <td style={{ color: u.permission_profile_id ? "var(--text)" : "var(--text-muted)", fontSize: 13 }}>
                      {u.permission_profile_id ? (perfilesMap[u.permission_profile_id] || "—") : "Por rol"}
                    </td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setModalResetClave(u)}
                          title="Establecer una nueva contraseña para este usuario"
                        >
                          Cambiar clave
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setModalEditar(u)}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => eliminarUsuario(u)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* PERFILES DE PERMISOS */}
      <div className="surface" style={{ marginTop: 20 }}>
        <div className="surface-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 className="surface-title" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <ShieldCheck size={16} /> Perfiles de permisos
          </h3>
          <button className="btn btn-sm btn-secondary" onClick={() => setModalPerfil({})} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Plus size={13} /> Nuevo perfil
          </button>
        </div>
        <div className="surface-body">
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 0 }}>
            Define perfiles con acceso a módulos específicos y asígnalos a cada usuario al editarlo. Un usuario sin perfil usa el acceso por su rol.
          </p>
          {perfiles.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>No hay perfiles creados.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {perfiles.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.nombre}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      {(p.permisos?.length || 0)} módulo(s){p.descripcion ? ` · ${p.descripcion}` : ""}
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "4px 8px" }} onClick={() => setModalPerfil(p)}><Pencil size={13} /></button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "4px 8px", color: "var(--danger)" }} onClick={() => setConfirmEliminarPerfil(p)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmEliminarPerfil !== null}
        title="¿Eliminar este perfil?"
        message={confirmEliminarPerfil ? `Se eliminará el perfil "${confirmEliminarPerfil.nombre}". Los usuarios que lo tenían volverán al acceso por su rol.` : ""}
        confirmText="Eliminar perfil"
        confirmTone="danger"
        onConfirm={eliminarPerfilConfirmado}
        onCancel={() => setConfirmEliminarPerfil(null)}
      />

      {modalPerfil && (
        <ModalPerfil
          perfil={modalPerfil}
          onCerrar={() => setModalPerfil(null)}
          onGuardado={() => { setModalPerfil(null); loadPerfiles(); setToast({ type: "success", message: "Perfil guardado." }); }}
          onError={(m) => setToast({ type: "error", message: m })}
        />
      )}

      {/* MODALES */}
      <ModalCrearUsuario
        abierto={modalCrear}
        cerrar={() => { setModalCrear(false); loadUsers(); }}
        onSuccess={loadUsers}
        onToast={setToast}
      />

      {modalEditar && (
        <ModalEditarUsuario
          user={modalEditar}
          perfiles={perfiles}
          close={() => { setModalEditar(null); loadUsers(); }}
          onToast={setToast}
        />
      )}

      {modalResetClave && (
        <ModalResetClave
          user={modalResetClave}
          cerrar={() => setModalResetClave(null)}
          onToast={setToast}
        />
      )}
    </div>
  );
}

// Crear / editar un perfil de permisos (matriz de módulos por grupo).
function ModalPerfil({ perfil, onCerrar, onGuardado, onError }) {
  const [nombre, setNombre] = useState(perfil?.nombre || "");
  const [descripcion, setDescripcion] = useState(perfil?.descripcion || "");
  const [sel, setSel] = useState(new Set(Array.isArray(perfil?.permisos) ? perfil.permisos : []));
  const [guardando, setGuardando] = useState(false);

  const grupos = useMemo(() => {
    const m = {};
    MODULOS.forEach((mod) => { (m[mod.grupo] = m[mod.grupo] || []).push(mod); });
    return Object.entries(m);
  }, []);

  function toggle(key) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  async function guardar(e) {
    e.preventDefault();
    if (!nombre.trim()) { onError?.("El nombre del perfil es obligatorio."); return; }
    setGuardando(true);
    try {
      const payload = { nombre: nombre.trim(), descripcion: descripcion.trim() || null, permisos: [...sel] };
      if (perfil?.id) await api.put(`/usuarios/perfiles/${perfil.id}`, payload);
      else await api.post("/usuarios/perfiles", payload);
      onGuardado?.();
    } catch (err) {
      onError?.(err?.message || "No se pudo guardar el perfil.");
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={guardar} style={{ width: 620, maxWidth: "100%", maxHeight: "92vh", overflow: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 16 }}>{perfil?.id ? "Editar perfil" : "Nuevo perfil"}</strong>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label className="field-label">Nombre *</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Vendedor estándar" /></div>
            <div className="field"><label className="field-label">Descripción</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
          </div>
          <div>
            <label className="field-label">Módulos con acceso</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 6 }}>
              {grupos.map(([grupo, mods]) => (
                <div key={grupo} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--text-soft)", marginBottom: 6 }}>{grupo}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {mods.map((mod) => (
                      <label key={mod.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={sel.has(mod.key)} onChange={() => toggle(mod.key)} />
                        {mod.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? "Guardando…" : "Guardar perfil"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
