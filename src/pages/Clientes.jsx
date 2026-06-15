import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
import useAuth from "../hooks/useAuth";

export default function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [vendedores, setVendedores] = useState([]);

  const { rol } = useAuth();
  const esAdmin = ["admin", "administrador"].includes((rol || "").trim().toLowerCase());

  const [filtroRut, setFiltroRut] = useState("");
  const [filtroNombre, setFiltroNombre] = useState("");
  const [filtroRegion, setFiltroRegion] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

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

  // El vendedor asignado solo se muestra al admin; cargamos los perfiles para
  // poder mostrar el nombre en vez del correo.
  useEffect(() => {
    if (!esAdmin) return;
    api
      .get("/usuarios/profiles")
      .then((p) => setVendedores(p || []))
      .catch(() => {});
  }, [esAdmin]);

  const vendedoresMap = useMemo(() => {
    const m = {};
    (vendedores || []).forEach((p) => {
      const e = (p?.email || "").trim().toLowerCase();
      if (e) m[e] = (p?.nombre || "").trim();
    });
    return m;
  }, [vendedores]);

  const esClienteParticular = (c) =>
    (c?.tipo_cliente || "").toString().toLowerCase().includes("particular");

  const nombreVendedor = (email) => {
    const e = (email || "").trim().toLowerCase();
    if (!e) return "Sin asignar";
    return vendedoresMap[e] || email;
  };

  /* ============================================================
     FILTROS
  ============================================================ */
  const clientesFiltrados = clientes.filter((c) => {
    const matchRut = c.rut.toLowerCase().includes(filtroRut.toLowerCase());
    const matchNombre = c.nombre.toLowerCase().includes(filtroNombre.toLowerCase());
    const matchRegion = filtroRegion ? c.region === filtroRegion : true;
    const matchTipo = filtroTipo ? (c.tipo_cliente || "") === filtroTipo : true;
    return matchRut && matchNombre && matchRegion && matchTipo;
  });

  const regionesUnicas = [...new Set(clientes.map((c) => c.region).filter(Boolean))];
  const tiposUnicos = [...new Set(clientes.map((c) => c.tipo_cliente).filter(Boolean))];

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

        <div className="filter-field">
          <label className="filter-label">Tipo de cliente</label>
          <select
            className="input"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
          >
            <option value="">Todos los tipos</option>
            {tiposUnicos.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* TABLA */}
      <div className="table-wrap">
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 320px)" }}>
          <table className="data-table" style={{ tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 150 }} />
              <col style={{ width: 180 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 180 }} />
              {esAdmin && <col style={{ width: 170 }} />}
              <col style={{ width: 180 }} />
            </colgroup>
            <thead>
              <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Región</th>
                <th>Comuna</th>
                <th>Contacto</th>
                {esAdmin && <th>Vendedor asignado</th>}
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>

            <tbody>
              {clientesFiltrados.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.rut}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.nombre}>{c.nombre}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.tipo_cliente || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.region}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.comuna}</td>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.contacto}>{c.contacto}</td>
                  {esAdmin && (
                    <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {esClienteParticular(c) ? (
                        <span title={c.vendedor_asignado || ""}>{nombreVendedor(c.vendedor_asignado)}</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                  )}
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <Link
                        to={`/clientes/editar/${c.id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Editar
                      </Link>
                      <button
                        type="button"
                        onClick={() => solicitarEliminacion(c)}
                        className="btn btn-danger btn-sm"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {clientesFiltrados.length === 0 && (
                <tr>
                  <td colSpan={esAdmin ? 8 : 7} style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
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
