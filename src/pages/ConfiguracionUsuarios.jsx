import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Toast from "../components/Toast";
import ModalCrearUsuario from "../components/ModalCrearUsuario";
import ModalEditarUsuario from "../components/ModalEditarUsuario";

const ROL_CONFIG = {
  admin:       { label: "Administrador",   text: "var(--primary-dark)", bg: "rgba(40,174,177,0.10)", border: "rgba(40,174,177,0.30)" },
  jefe_ventas: { label: "Jefe de Ventas",  text: "#1d4ed8",             bg: "#eff6ff",               border: "#bfdbfe"               },
  ventas:      { label: "Ventas",          text: "#15803d",             bg: "#f0fdf4",               border: "#bbf7d0"               },
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

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("nombre", { ascending: true });
    if (!error) setUsuarios(data || []);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function enviarReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset-password",
    });
    if (error) {
      setToast({ type: "error", message: "Error al enviar correo de recuperación" });
    } else {
      setToast({ type: "success", message: `Correo de recuperación enviado a ${email}` });
    }
  }

  async function eliminarUsuario(u) {
    if (!confirm(`¿Eliminar al usuario "${u.nombre || u.email}"?`)) return;
    const { error } = await supabase.from("profiles").delete().eq("id", u.id);
    if (error) {
      setToast({ type: "error", message: "Error al eliminar usuario" });
    } else {
      setToast({ type: "success", message: "Usuario eliminado" });
      loadUsers();
    }
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

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
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                      Cargando usuarios…
                    </td>
                  </tr>
                )}

                {!loading && usuarios.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px" }}>
                      No hay usuarios registrados.
                    </td>
                  </tr>
                )}

                {!loading && usuarios.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.nombre || <span style={{ color: "var(--text-muted)" }}>(Sin nombre)</span>}</td>
                    <td style={{ color: "var(--text-muted)" }}>{u.email}</td>
                    <td><RolBadge rol={u.rol} /></td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => enviarReset(u.email)}
                          title="Enviar correo de recuperación"
                        >
                          Reset contraseña
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
          close={() => { setModalEditar(null); loadUsers(); }}
          onToast={setToast}
        />
      )}
    </div>
  );
}
