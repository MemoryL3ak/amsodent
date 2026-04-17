import { useState } from "react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { Link } from "react-router-dom";
import { REGIONES_CHILE } from "../constants/regiones";

export default function CrearCliente() {
  const [rut, setRut] = useState("");
  const [nombre, setNombre] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [municipalidad, setMunicipalidad] = useState("");
  const [region, setRegion] = useState("");
  const [comuna, setComuna] = useState("");
  const [direccion, setDireccion] = useState("");
  const [contacto, setContacto] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [condVenta, setCondVenta] = useState("30 días");

  const [toast, setToast] = useState(null);

  async function guardarCliente() {
    if (!rut || !nombre || !region || !comuna || !direccion || !contacto || !email || !condVenta) {
      setToast({ type: "error", message: "Debes completar todos los campos obligatorios." });
      return;
    }

    try {
      await api.post("/clientes", {
        rut,
        nombre,
        departamento,
        municipalidad,
        region,
        comuna,
        direccion,
        contacto,
        email,
        telefono,
        condiciones_venta: condVenta,
      });

      setToast({ type: "success", message: "Cliente creado con éxito" });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", message: "Error al guardar el cliente." });
      return;
    }

    setRut("");
    setNombre("");
    setDepartamento("");
    setMunicipalidad("");
    setRegion("");
    setComuna("");
    setDireccion("");
    setContacto("");
    setEmail("");
    setTelefono("");
    setCondVenta("30 días");
  }

  return (
    <div className="page">
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}

      {/* HEADER */}
      <div className="page-header">
        <div>
          <Link
            to="/clientes"
            style={{ fontSize: "13px", color: "var(--text-muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "6px" }}
          >
            ← Volver al listado
          </Link>
          <h1 className="page-title">Crear Cliente</h1>
        </div>
      </div>

      {/* FORMULARIO */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Datos del cliente</h3>
        </div>
        <div className="surface-body">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

            <div className="field">
              <label className="field-label">RUT *</label>
              <input className="input" value={rut} onChange={(e) => setRut(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Nombre Cliente *</label>
              <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Departamento</label>
              <input className="input" value={departamento} onChange={(e) => setDepartamento(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Municipalidad</label>
              <input className="input" value={municipalidad} onChange={(e) => setMunicipalidad(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Región *</label>
              <select
                className="input"
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value);
                  setComuna("");
                }}
              >
                <option value="">Seleccione región</option>
                {Object.keys(REGIONES_CHILE).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Comuna *</label>
              <select
                className="input"
                value={comuna}
                onChange={(e) => setComuna(e.target.value)}
                disabled={!region}
              >
                <option value="">{region ? "Seleccione comuna" : "Seleccione región primero"}</option>
                {region && REGIONES_CHILE[region].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Dirección *</label>
              <input className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Contacto *</label>
              <input className="input" value={contacto} onChange={(e) => setContacto(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Email *</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Teléfono</label>
              <input className="input" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>

            <div className="field">
              <label className="field-label">Condiciones de Venta</label>
              <select
                className="input"
                value={condVenta}
                onChange={(e) => setCondVenta(e.target.value)}
              >
                <option value="">Seleccione…</option>
                <option value="30 días">30 días</option>
                <option value="Contado">Contado</option>
              </select>
            </div>

          </div>

          <div style={{ marginTop: "24px" }}>
            <button type="button" onClick={guardarCliente} className="btn btn-primary">
              Guardar Cliente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
