import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
import Select from "react-select";

/* ============================================================
   HELPERS FILTRO PRODUCTO (TOKENS + NORMALIZACIÓN)
============================================================ */
function normalizarTexto(s = "") {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contieneTodosLosTokens(texto, query) {
  const t = normalizarTexto(texto);
  const tokens = normalizarTexto(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((tok) => t.includes(tok));
}

export default function Productos() {
  const [productos, setProductos] = useState([]);

  const [filtroSKU, setFiltroSKU] = useState("");
  const [filtroProducto, setFiltroProducto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroMarcas, setFiltroMarcas] = useState([]);
  const [ordenTabla, setOrdenTabla] = useState({ key: null, dir: "asc" });

  const [modalOpen, setModalOpen] = useState(false);
  const [productoAEliminar, setProductoAEliminar] = useState(null);

  // ✅ precios de campaña vigentes por SKU (cache)
  const [campaignPriceBySku, setCampaignPriceBySku] = useState(new Map());

  // ✅ PERFIL / ROL
  const [perfilLoading, setPerfilLoading] = useState(true);
  const [rol, setRol] = useState(null);
  const rolNorm = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    if (!r) return "";
    if (
      r === "jefe_ventas" ||
      r === "jefe ventas" ||
      r === "jefe-ventas" ||
      r === "jefe de ventas"
    ) {
      return "jefe_ventas";
    }
    if (r === "ventas") return "ventas";
    return r;
  }, [rol]);

  useEffect(() => {
    async function cargarPerfil() {
      setPerfilLoading(true);

      try {
        const perfil = await api.get("/auth/profile");
        setRol(perfil?.rol ?? null);
      } catch {
        setRol(null);
      }
      setPerfilLoading(false);
    }

    cargarPerfil();
  }, []);

  // ? Ventas: puede editar solo transitorios; no puede eliminar
  const puedeEditarProductoFila = useMemo(() => {
    return (producto) => {
      if (rolNorm !== "ventas") return true;
      const estado = (producto?.estado ?? "").toString().trim().toLowerCase();
      if (estado) return estado === "transitorio" || estado === "transsitorio";
      const sku = (producto?.sku ?? "").toString().trim();
      return sku === "";
    };
  }, [rolNorm]);

  const puedeEliminarProductos = useMemo(() => {
    return rolNorm !== "ventas";
  }, [rolNorm]);

  /* ============================================================
     CARGAR PRODUCTOS
  ============================================================ */
  async function cargar() {
    let data;
    try {
      data = await api.get("/productos");
    } catch (err) {
      console.error(err);
      return;
    }
    if (!data) return;

    const clean = data.map((p) => {
      const nombre =
        (p.nombre?.trim() || "") || (p.descripcion?.trim() || "");

      return {
        ...p,
        sku: p.sku?.trim() ?? "",
        nombre,
        categoria: p.categoria?.trim() ?? "",
        formato: p.formato?.trim() ?? "",
        marca: p.marca?.trim() ?? "",
      };
    });

    setProductos(clean);
  }

  useEffect(() => {
    cargar();
  }, []);

  /* ============================================================
     CARGAR PRECIOS DE CAMPAÑAS VIGENTES (HOY)
  ============================================================ */
  useEffect(() => {
    async function cargarCampaniasVigentes() {
      try {
        const data = await api.get("/productos/campaign-prices");

        const m = new Map();
        (data || []).forEach((row) => {
          const sku = row?.sku;
          if (!sku) return;
          if (!m.has(sku)) m.set(sku, Number(row.precio_campania || 0));
        });

        setCampaignPriceBySku(m);
      } catch (error) {
        console.error("Error cargando campañas vigentes:", error);
        setCampaignPriceBySku(new Map());
      }
    }

    cargarCampaniasVigentes();
  }, []);

  /* ============================================================
     MARCAS DISPONIBLES (DINÁMICAS SEGÚN FILTRO PRODUCTO)
  ============================================================ */
  const marcasDisponibles = useMemo(() => {
    const marcas = productos
      .filter((p) => contieneTodosLosTokens(p.nombre, filtroProducto))
      .map((p) => p.marca)
      .filter(Boolean);

    return [...new Set(marcas)].map((m) => ({
      value: m,
      label: m,
    }));
  }, [productos, filtroProducto]);

  /* ============================================================
     FILTROS + ORDEN
  ============================================================ */
  const productosFiltrados = productos
    .filter((p) => {
      const matchSKU = p.sku.toLowerCase().includes(filtroSKU.toLowerCase());
      const matchProducto = contieneTodosLosTokens(p.nombre, filtroProducto);
      const matchCategoria = filtroCategoria ? p.categoria === filtroCategoria : true;

      const matchMarca =
        filtroMarcas.length > 0
          ? filtroMarcas.some((m) => m.value === p.marca)
          : true;

      return matchSKU && matchProducto && matchCategoria && matchMarca;
    })
    .sort((a, b) => {
      if (!ordenTabla.key) return 0;

      const key = ordenTabla.key;
      const dir = ordenTabla.dir === "asc" ? 1 : -1;

      const getValue = (p) => {
        if (key === "precio") return Number(p.lista1 ?? 0);
        return String(p?.[key] ?? "").toLowerCase();
      };

      const va = getValue(a);
      const vb = getValue(b);

      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return va.localeCompare(vb, "es", { sensitivity: "base" }) * dir;
    });

  function toggleSort(key) {
    setOrdenTabla((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  }

  function sortIndicator(key) {
    if (ordenTabla.key !== key) return "";
    return ordenTabla.dir === "asc" ? " ^" : " v";
  }

  /* ============================================================
     LIMPIAR MARCAS NO VÁLIDAS CUANDO CAMBIA EL FILTRO PRODUCTO
  ============================================================ */
  useEffect(() => {
    setFiltroMarcas((prev) =>
      prev.filter((m) => marcasDisponibles.some((d) => d.value === m.value))
    );
  }, [marcasDisponibles]);

  const categoriasUnicas = [
    ...new Set(productos.map((p) => p.categoria).filter(Boolean)),
  ];

  /* ============================================================
     ELIMINACIÓN
  ============================================================ */
  function solicitarEliminacion(producto) {
    if (!puedeEliminarProductos) return;
    setProductoAEliminar(producto);
    setModalOpen(true);
  }

  async function eliminarDefinitivo() {
    if (!productoAEliminar) return;
    if (!puedeEliminarProductos) return;

    try {
      await api.delete(`/productos/${productoAEliminar.id}`);
    } catch (err) {
      console.error(err);
    }
    setModalOpen(false);
    setProductoAEliminar(null);
    cargar();
  }

  /* ============================================================
     UI
  ============================================================ */
  if (perfilLoading) {
    return <div className="page"><p style={{color:"var(--text-muted)"}}>Cargando…</p></div>;
  }

  return (
    <div className="page">
      {/* HEADER */}
      <div className="page-header">
        <h1 className="page-title">Productos</h1>
        <div className="btn-row">
          <Link to="/productos/nuevo" className="btn btn-primary">
            + Crear Producto
          </Link>
        </div>
      </div>

      {/* FILTROS */}
      <div className="filter-bar" style={{zIndex: 20, position: "relative"}}>
        <div className="filter-field">
          <label className="filter-label">SKU</label>
          <input
            className="input"
            placeholder="Filtrar por SKU…"
            value={filtroSKU}
            onChange={(e) => setFiltroSKU(e.target.value)}
          />
        </div>

        <div className="filter-field" style={{flex: 2, minWidth: 200}}>
          <label className="filter-label">Producto</label>
          <input
            className="input"
            placeholder="Filtrar por Producto…"
            value={filtroProducto}
            onChange={(e) => setFiltroProducto(e.target.value)}
          />
        </div>

        <div className="filter-field">
          <label className="filter-label">Categoría</label>
          <select
            className="input"
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
          >
            <option value="">Todas las Categorías</option>
            {categoriasUnicas.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="filter-field" style={{flex: 2, minWidth: 180}}>
          <label className="filter-label">Marca</label>
          <Select
            isMulti
            options={marcasDisponibles}
            value={filtroMarcas}
            onChange={(val) => setFiltroMarcas(val || [])}
            placeholder="Todas las marcas…"
            classNamePrefix="react-select"
            styles={{
              control: (base) => ({
                ...base,
                minHeight: "36px",
                height: "36px",
                borderColor: "var(--border-strong)",
                borderRadius: "var(--radius)",
                fontSize: "13.5px",
                boxShadow: "none",
              }),
              valueContainer: (base) => ({ ...base, padding: "0 10px" }),
              indicatorsContainer: (base) => ({ ...base, height: "36px" }),
              menu: (base) => ({ ...base, zIndex: 50 }),
            }}
          />
        </div>
      </div>

      {/* TABLA */}
      <div className="table-wrap">
        <div className="table-scroll" style={{maxHeight: 760}}>
          <table className="data-table" style={{tableLayout: "fixed", width: "100%"}}>
            <colgroup>
              <col style={{width: 110}} />
              <col />
              <col style={{width: 150}} />
              <col style={{width: 150}} />
              <col style={{width: 110}} />
              <col style={{width: 150}} />
              <col style={{width: 170}} />
            </colgroup>
            <thead>
              <tr>
                <th style={{cursor:"pointer", userSelect:"none"}} onClick={() => toggleSort("sku")}>
                  SKU{sortIndicator("sku")}
                </th>
                <th style={{cursor:"pointer", userSelect:"none"}} onClick={() => toggleSort("nombre")}>
                  Producto{sortIndicator("nombre")}
                </th>
                <th style={{cursor:"pointer", userSelect:"none"}} onClick={() => toggleSort("marca")}>
                  Marca{sortIndicator("marca")}
                </th>
                <th style={{cursor:"pointer", userSelect:"none"}} onClick={() => toggleSort("categoria")}>
                  Categoría{sortIndicator("categoria")}
                </th>
                <th style={{cursor:"pointer", userSelect:"none"}} onClick={() => toggleSort("formato")}>
                  Formato{sortIndicator("formato")}
                </th>
                <th style={{cursor:"pointer", userSelect:"none"}} onClick={() => toggleSort("precio")}>
                  Precio Unitario{sortIndicator("precio")}
                </th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {productosFiltrados.map((p) => {
                const precioNormal = Number(p.lista1 ?? 0);
                const precioCampania = campaignPriceBySku.get(p.sku);

                return (
                  <tr key={p.id}>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.sku}</td>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}} title={p.nombre}>{p.nombre}</td>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.marca || "—"}</td>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.categoria}</td>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.formato}</td>
                    <td style={{fontWeight: 600}}>
                      <div style={{lineHeight: 1.4}}>
                        <div>${precioNormal.toLocaleString("es-CL")}</div>
                        {precioCampania != null && (
                          <div style={{fontSize: 12, color: "#15803d"}}>
                            ${Number(precioCampania).toLocaleString("es-CL")}{" "}
                            <span style={{fontSize: 11, fontWeight: 500}}>(Campaña)</span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td style={{textAlign: "right"}}>
                      <div className="btn-row" style={{justifyContent: "flex-end"}}>
                        {puedeEditarProductoFila(p) ? (
                          <>
                            <Link
                              to={`/productos/editar/${p.id}`}
                              className="btn btn-secondary btn-sm"
                            >
                              Editar
                            </Link>
                            <button
                              onClick={() => puedeEliminarProductos ? solicitarEliminacion(p) : undefined}
                              className={puedeEliminarProductos ? "btn btn-danger btn-sm" : "btn btn-sm"}
                              disabled={!puedeEliminarProductos}
                              title={!puedeEliminarProductos ? "Tu rol no permite eliminar productos" : undefined}
                              type="button"
                            >
                              Eliminar
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn btn-sm" disabled title="Tu rol no permite editar productos">
                              Editar
                            </button>
                            <button type="button" className="btn btn-sm" disabled title="Tu rol no permite eliminar productos">
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {productosFiltrados.length === 0 && (
                <tr>
                  <td colSpan="7" style={{textAlign: "center", color: "var(--text-muted)", padding: "32px 16px"}}>
                    No hay productos que coincidan con el filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={modalOpen}
        title="Confirmar eliminación"
        message={`¿Seguro que deseas eliminar el producto "${productoAEliminar?.nombre}"?`}
        onCancel={() => setModalOpen(false)}
        onConfirm={eliminarDefinitivo}
      />
    </div>
  );
}





