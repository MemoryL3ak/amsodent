import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { Link } from "react-router-dom";
import { REGIONES_CHILE } from "../constants/regiones";

export default function CrearCliente() {
  const [tipoCliente, setTipoCliente] = useState("");
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
  const [vendedorAsignado, setVendedorAsignado] = useState("");

  const [userEmail, setUserEmail] = useState("");
  const [esAdmin, setEsAdmin] = useState(false);
  const [esJefeVentasEspecial, setEsJefeVentasEspecial] = useState(false);
  const [vendedores, setVendedores] = useState([]);

  const [toast, setToast] = useState(null);

  const esParticular = tipoCliente === "Cliente Particular";
  // Crédito "30 días" en cliente particular: solo el administrador puede autorizarlo.
  const puede30dias = esAdmin;
  const bloquea30 = esParticular && !puede30dias;

  // Perfil del creador (para asignarlo por defecto) + lista de vendedores.
  useEffect(() => {
    (async () => {
      try {
        const perfil = await api.get("/auth/profile");
        const e = (perfil?.email || "").trim();
        const r = (perfil?.rol || "").toString().trim().toLowerCase();
        setUserEmail(e);
        setEsAdmin(r === "admin" || r === "administrador");
        setEsJefeVentasEspecial(r === "jefe_ventas_especial");
        setVendedorAsignado(e.toLowerCase());
      } catch { /* */ }
      try {
        const perfiles = await api.get("/usuarios/profiles");
        setVendedores(perfiles || []);
      } catch { /* */ }
    })();
  }, []);

  // Si el usuario no puede asignar "30 días" a un particular, fuerza "Contado".
  useEffect(() => {
    if (bloquea30 && condVenta === "30 días") {
      setCondVenta("Contado");
    }
  }, [bloquea30, condVenta]);

  const vendedoresMap = useMemo(() => {
    const m = {};
    (vendedores || []).forEach((p) => {
      const e = (p?.email || "").trim().toLowerCase();
      if (e) m[e] = (p?.nombre || "").trim();
    });
    return m;
  }, [vendedores]);

  const vendedorAsignadoNombre = useMemo(() => {
    const e = (vendedorAsignado || "").trim().toLowerCase();
    if (!e) return "Sin asignar";
    return vendedoresMap[e] || vendedorAsignado;
  }, [vendedorAsignado, vendedoresMap]);

  const opcionesVendedores = useMemo(() => {
    const roles = ["ventas", "ventas_especial", "jefe_ventas", "jefe_ventas_especial"];
    const lista = (vendedores || [])
      .filter((p) => roles.includes((p?.rol || "").toString().trim().toLowerCase()))
      .map((p) => ({ value: (p?.email || "").trim().toLowerCase(), label: (p?.nombre || p?.email || "").trim() }))
      .filter((o) => o.value);
    const actual = (vendedorAsignado || "").trim().toLowerCase();
    if (actual && !lista.some((o) => o.value === actual)) {
      lista.push({ value: actual, label: vendedoresMap[actual] || vendedorAsignado });
    }
    return lista.sort((a, b) => a.label.localeCompare(b.label));
  }, [vendedores, vendedorAsignado, vendedoresMap]);

  async function guardarCliente() {
    if (!tipoCliente || !rut || !nombre || !region || !comuna || !direccion || !contacto || !email || !condVenta) {
      setToast({ type: "error", message: "Debes completar todos los campos obligatorios." });
      return;
    }

    if (bloquea30 && condVenta === "30 días") {
      setToast({ type: "error", message: "Solo el administrador puede autorizar el crédito de '30 días' a un cliente particular." });
      return;
    }

    try {
      await api.post("/clientes", {
        tipo_cliente: tipoCliente,
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
        // Cliente particular: queda anexado a un vendedor (por defecto, el creador).
        vendedor_asignado: esParticular ? ((vendedorAsignado || "").trim() || null) : null,
      });

      setToast({ type: "success", message: "Cliente creado con éxito" });
    } catch (error) {
      console.error(error);
      setToast({ type: "error", message: "Error al guardar el cliente." });
      return;
    }

    setTipoCliente("");
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
    setVendedorAsignado((userEmail || "").toLowerCase());
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
              <label className="field-label">Tipo de Cliente *</label>
              <select
                className="input"
                value={tipoCliente}
                onChange={(e) => setTipoCliente(e.target.value)}
              >
                <option value="">Seleccione tipo de cliente…</option>
                <option value="Cliente Particular">Cliente Particular</option>
                <option value="Entidad Pública">Entidad Pública</option>
              </select>
            </div>

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
              <label className="field-label">Condiciones de Venta *</label>
              <select
                className="input"
                value={condVenta}
                onChange={(e) => setCondVenta(e.target.value)}
              >
                <option value="">Seleccione…</option>
                {!bloquea30 && <option value="30 días">30 días</option>}
                <option value="Contado">Contado</option>
              </select>
              {bloquea30 && (
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  El crédito "30 días" para clientes particulares solo puede autorizarlo el administrador.
                </p>
              )}
            </div>

            {esParticular && (
              <div className="field">
                <label className="field-label">Vendedor Asignado</label>
                {esAdmin ? (
                  <select
                    className="input"
                    value={(vendedorAsignado || "").trim().toLowerCase()}
                    onChange={(e) => setVendedorAsignado(e.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {opcionesVendedores.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    style={{ background: "var(--bg)" }}
                    readOnly
                    value={vendedorAsignadoNombre}
                  />
                )}
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {esAdmin
                    ? "Por defecto se asigna a ti. Como admin puedes asignarlo a otro vendedor."
                    : "Se te asigna automáticamente. Solo el administrador puede cambiarlo."}
                </p>
              </div>
            )}

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
