import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";

export default function Clientes() {
  const [clientes, setClientes] = useState([]);

  const [filtroRut, setFiltroRut] = useState("");
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroRegion, setFiltroRegion] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [clienteAEliminar, setClienteAEliminar] = useState(null);

  /* ============================================================
     CARGAR CLIENTES
  ============================================================ */
  async function cargar() {
    try {
      const data = await api.get("/clientes");
      if (!data) return;

      const clean = data.map((c) => ({
        ...c,
        rut: c.rut?.trim() ?? "",
        nombre: c.nombre?.trim() ?? "",
        region: c.region?.trim() ?? "",
        comuna: c.comuna?.trim() ?? "",
      }));

      setClientes(clean);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  /* ============================================================
     FILTROS
  ============================================================ */
  const clientesFiltrados = clientes.filter((c) => {
    const matchRut = c.rut.toLowerCase().includes(filtroRut.toLowerCase());
    const matchNombre = c.nombre.toLowerCase().includes(filtroNombre.toLowerCase());
    const matchRegion = filtroRegion ? c.region === filtroRegion : true;
    return matchRut && matchNombre && matchRegion;
  });

  const regionesUnicas = [...new Set(clientes.map((c) => c.region).filter(Boolean))];

  /* ============================================================
     ELIMINACIÓN
  ============================================================ */
  function solicitarEliminacion(cliente) {
    setClienteAEliminar(cliente);
    setModalOpen(true);
  }

  async function eliminarDefinitivo() {
    if (!clienteAEliminar) return;
    try {
      await api.delete(`/clientes/${clienteAEliminar.id}`);
    } catch (err) {
      console.error(err);
    }
    setModalOpen(false);
    setClienteAEliminar(null);
    cargar();
  }

  /* ============================================================
     UI
  ============================================================ */
  return (
    <div className="page">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">{clientesFiltrados.length} resultado{clientesFiltrados.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="page-actions">
          <Link to="/clientes/nuevo" className="btn btn-primary">
            + Crear Cliente
          </Link>
        </div>
      </div>

      {/* FILTROS */}
      <div className="filter-bar" style={{ marginBottom: "20px" }}>
        <div className="filter-field">
          <label className="filter-label">RUT</label>
          <input
            className="input"
            placeholder="Filtrar por RUT…"
            value={filtroRut}
            onChange={(e) => setFiltroRut(e.target.value)}
          />
        </div>

        <div className="filter-field">
          <label className="filter-label">Nombre</label>
          <input
            className="input"
            placeholder="Filtrar por Nombre…"
            value={filtroNombre}
            onChange={(e) => setFiltroNombre(e.target.value)}
          />
        </div>

        <div className="filter-field">
          <label className="filter-label">Región</label>
          <select
            className="input"
            value={filtroRegion}
            onChange={(e) => setFiltroRegion(e.target.value)}
          >
            <option value="">Todas las Regiones</option>
            {regionesUnicas.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      {/* TABLA */}
      <div className="table-wrap">
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 320px)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Región</th>
                <th>Comuna</th>
                <th>Contacto</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>

            <tbody>
              {clientesFiltrados.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.rut}</td>
                  <td>{c.nombre}</td>
                  <td>{c.region}</td>
                  <td>{c.comuna}</td>
                  <td>{c.contacto}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                      <Link
                        to={`/clientes/editar/${c.id}`}
                        className="btn btn-sm btn-secondary"
                      >
                        Editar
                      </Link>
                      <button
                        onClick={() => solicitarEliminacion(c)}
                        className="btn btn-sm btn-outline-danger"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {clientesFiltrados.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay clientes que coincidan con el filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      <ConfirmModal
        open={modalOpen}
        title="Confirmar eliminación"
        message={`¿Seguro que deseas eliminar el cliente "${clienteAEliminar?.nombre}"? Esta acción no se puede deshacer.`}
        onCancel={() => setModalOpen(false)}
        onConfirm={eliminarDefinitivo}
      />
    </div>
  );
}
