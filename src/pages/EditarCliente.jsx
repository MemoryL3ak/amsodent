import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { Link, useParams } from "react-router-dom";
import { REGIONES_CHILE } from "../constants/regiones";

export default function EditarCliente() {
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

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
  const [condVenta, setCondVenta] = useState("");

  const comunasDisponibles = useMemo(() => {
    return (REGIONES_CHILE?.[region] ?? []);
  }, [region]);

  /* ============================================================
     CARGAR CLIENTE
  ============================================================ */
  useEffect(() => {
    async function cargarCliente() {
      setLoading(true);

      let data;
      try {
        data = await api.get(`/clientes/${id}`);
      } catch (error) {
        console.error(error);
        setToast({ type: "error", message: "Error cargando cliente" });
        setLoading(false);
        return;
      }

      const regionDB = (data.region || "").toString().trim();
      const comunaDB = (data.comuna || "").toString().trim();

      setRut((data.rut || "").toString());
      setNombre((data.nombre || "").toString());
      setDepartamento((data.departamento || "").toString());
      setMunicipalidad((data.municipalidad || "").toString());
      setRegion(regionDB);
      setComuna(comunaDB);
      setDireccion((data.direccion || "").toString());
      setContacto((data.contacto || "").toString());
      setEmail((data.email || "").toString());
      setTelefono((data.telefono || "").toString());
      setCondVenta((data.condiciones_venta || "").toString());

      setLoading(false);

      if (regionDB && !(regionDB in (REGIONES_CHILE || {}))) {
        setToast({
          type: "error",
          message: `La región guardada "${regionDB}" no existe en REGIONES_CHILE.\nSelecciona una región válida para continuar.`,
        });
      }
    }

    cargarCliente();
  }, [id]);

  /* ============================================================
     SI CAMBIA REGIÓN: reset comuna si no pertenece
  ============================================================ */
  useEffect(() => {
    if (!region) {
      if (comuna) setComuna("");
      return;
    }
    if (comuna && !(comunasDisponibles || []).includes(comuna)) {
      setComuna("");
    }
  }, [region, comunasDisponibles]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ============================================================
     GUARDAR CAMBIOS
  ============================================================ */
  async function guardarCambios() {
    if (!rut || !nombre || !region || !comuna || !direccion || !contacto || !email) {
      setToast({ type: "error", message: "Debes completar todos los campos obligatorios." });
      return;
    }

    try {
      await api.put(`/clientes/${id}`, {
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

      setToast({ type: "success", message: "Cliente actualizado correctamente" });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", message: "Error al guardar cambios" });
    }
  }

  /* ============================================================
     UI
  ============================================================ */
  if (loading) return <div className="page" style={{ color: "var(--text-muted)" }}>Cargando...</div>;

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
          <h1 className="page-title">Editar Cliente</h1>
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
                  setRegion((e.target.value || "").trim());
                  setComuna("");
                }}
              >
                <option value="">Seleccione región</option>
                {Object.keys(REGIONES_CHILE || {}).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">Comuna *</label>
              <select
                className="input"
                value={comuna}
                onChange={(e) => setComuna((e.target.value || "").trim())}
                disabled={!region}
              >
                <option value="">{region ? "Seleccione comuna" : "Seleccione región primero"}</option>
                {(comunasDisponibles ?? []).map((c) => (
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
            <button type="button" onClick={guardarCambios} className="btn btn-primary">
              Guardar Cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
