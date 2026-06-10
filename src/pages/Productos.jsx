import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal";
import Select from "react-select";
import {
  FileDown,
  Upload,
  X,
  Download,
  ChevronDown,
  Ban,
  RotateCcw,
  Trash2,
  AlertCircle,
} from "lucide-react";
import Toast from "../components/Toast";
import { descargarFichaTecnica } from "../utils/generarFichaTecnica";
import { calcularLista3 } from "../lib/listas";
import { useStickyState } from "../lib/useStickyState";

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

// Campos que deben estar llenos para considerar la ficha técnica "completa".
const CAMPOS_FICHA_TECNICA = [
  "presentacion",
  "descripcion",
  "composicion",
  "uso_indicaciones",
  "beneficios",
  "modo_uso",
  "almacenamiento",
  "datos_clave",
];

function fichaTecnicaCompleta(p) {
  // El listado liviano (/productos/list) ya trae el booleano calculado en el
  // servidor; si está presente lo usamos en vez de revisar los campos largos.
  if (typeof p?.ficha_completa === "boolean") return p.ficha_completa;
  return CAMPOS_FICHA_TECNICA.every(
    (k) => String(p?.[k] ?? "").trim().length > 0,
  );
}

// Menú desplegable de acciones (Inactivar / Eliminar) para roles con permiso.
const ANCHO_MENU_ACC = 210;

function MenuAccionesProducto({ producto, onToggleEstado, onEliminar }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  const estadoRow = (producto.estado || (producto.sku ? "Activo" : "Transitorio")).toString();
  const esInactivo = estadoRow === "Inactivo";
  const bloqueado = estadoRow === "Transitorio" || estadoRow === "Pendiente Aprobación";

  function alternar() {
    if (abierto) {
      setAbierto(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const altoMenu = 104;
      const abreArriba = r.bottom + altoMenu + 12 > window.innerHeight;
      setPos({
        top: abreArriba ? r.top - altoMenu - 6 : r.bottom + 6,
        left: Math.max(8, r.right - ANCHO_MENU_ACC),
      });
    }
    setAbierto(true);
  }

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={alternar}
        title="Más acciones del producto"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 30,
          padding: "0 10px",
          borderRadius: 7,
          border: "1px solid",
          borderColor: abierto ? "#0e7d83" : "#cbd5e1",
          background: abierto ? "#e8f5f5" : "#fff",
          color: abierto ? "#0e7d83" : "#475569",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all .14s ease",
        }}
      >
        Acciones
        <ChevronDown
          size={13}
          style={{
            transform: abierto ? "rotate(180deg)" : "none",
            transition: "transform .15s ease",
          }}
        />
      </button>

      {abierto &&
        createPortal(
          <>
            <div
              onClick={() => setAbierto(false)}
              style={{ position: "fixed", inset: 0, zIndex: 9000 }}
            />
            <div
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: ANCHO_MENU_ACC,
                zIndex: 9001,
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #e8edf2",
                boxShadow: "0 14px 36px -10px rgba(16,24,40,.34)",
                padding: 6,
                animation: "prodmenu-in .14s ease",
              }}
            >
              <style>{`
                @keyframes prodmenu-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
                .prodmenu-item { transition: background .12s ease; }
                .prodmenu-item:hover:not(:disabled) { background: #f1f5f9; }
                .prodmenu-item-danger:hover:not(:disabled) { background: #fef2f2; }
              `}</style>

              <button
                type="button"
                className="prodmenu-item"
                disabled={bloqueado}
                onClick={() => {
                  setAbierto(false);
                  onToggleEstado(producto);
                }}
                title={
                  bloqueado
                    ? "Los productos transitorios o pendientes no se pueden marcar manualmente"
                    : undefined
                }
                style={itemMenuAcc(bloqueado)}
              >
                <span
                  style={iconoMenuAcc(
                    esInactivo ? "#15803d" : "#b45309",
                    esInactivo ? "#dcfce7" : "#fef3c7",
                  )}
                >
                  {esInactivo ? <RotateCcw size={15} /> : <Ban size={15} />}
                </span>
                {esInactivo ? "Activar producto" : "Inactivar producto"}
              </button>

              <button
                type="button"
                className="prodmenu-item prodmenu-item-danger"
                onClick={() => {
                  setAbierto(false);
                  onEliminar(producto);
                }}
                style={{ ...itemMenuAcc(false), color: "#dc2626" }}
              >
                <span style={iconoMenuAcc("#dc2626", "#fee2e2")}>
                  <Trash2 size={15} />
                </span>
                Eliminar producto
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function itemMenuAcc(disabled) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 9px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    fontWeight: 600,
    color: "#334155",
    opacity: disabled ? 0.45 : 1,
    textAlign: "left",
  };
}

function iconoMenuAcc(color, fondo) {
  return {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: fondo,
    color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

export default function Productos() {
  const [productos, setProductos] = useState([]);

  // Filtros persistentes: se conservan al ir a un detalle y volver atrás.
  const [filtroSKU, setFiltroSKU] = useStickyState("productos.filtroSKU", "");
  const [filtroProducto, setFiltroProducto] = useStickyState("productos.filtroProducto", "");
  const [filtroCategoria, setFiltroCategoria] = useStickyState("productos.filtroCategoria", "");
  const [filtroMarcas, setFiltroMarcas] = useStickyState("productos.filtroMarcas", []);
  const [filtroEstado, setFiltroEstado] = useStickyState("productos.filtroEstado", "");
  const [ordenTabla, setOrdenTabla] = useStickyState("productos.ordenTabla", { key: null, dir: "asc" });
  // Qué lista de precios muestra la columna "Precio Unitario" (lista1 | lista2 | lista3).
  // Lista 3 NO está en la DB: es un valor calculado = lista2 * FACTOR_LISTA_3.
  const [listaPrecio, setListaPrecio] = useStickyState("productos.listaPrecio", "lista1");

  function getPrecioPorLista(p, lista) {
    if (!p) return 0;
    if (lista === "lista3") {
      // Si el producto tiene Lista 3 explícita usamos ese valor; si no,
      // fallback al factor configurado (ver src/lib/listas.js).
      const explicit = Number(p.lista3 ?? 0);
      if (explicit > 0) return explicit;
      return calcularLista3(p.lista2);
    }
    return Number(p?.[lista] ?? 0);
  }

  const [modalOpen, setModalOpen] = useState(false);
  const [productoAEliminar, setProductoAEliminar] = useState(null);
  // Punto 37: modal de carga masiva
  const [cargaMasivaOpen, setCargaMasivaOpen] = useState(false);

  const [generandoFichaId, setGenerandoFichaId] = useState(null);
  const [toast, setToast] = useState(null);

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
      r === "jefe de ventas" ||
      r === "jefe_ventas_especial" ||
      r === "contabilidad"
    ) {
      return "jefe_ventas";
    }
    if (r === "ventas" || r === "ventas_especial") return "ventas";
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

  // Todos los roles pueden abrir el editor.
  // Los permisos finos por sección se controlan dentro de EditarProducto:
  // ventas en productos no-transitorios solo edita "Detalle del Producto".
  const puedeEditarProductoFila = useMemo(() => {
    return () => true;
  }, []);

  const puedeEliminarProductos = useMemo(() => {
    return rolNorm !== "ventas";
  }, [rolNorm]);

  /* ============================================================
     CARGAR PRODUCTOS
  ============================================================ */
  async function cargar() {
    let data;
    try {
      data = await api.get("/productos/list");
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

      // Estado: si la fila no trae estado, inferimos Activo/Transitorio según haya SKU.
      const estadoRow = (p.estado || (p.sku ? "Activo" : "Transitorio")).toString().trim();
      const matchEstado = filtroEstado ? estadoRow === filtroEstado : true;

      return matchSKU && matchProducto && matchCategoria && matchMarca && matchEstado;
    })
    .sort((a, b) => {
      if (!ordenTabla.key) return 0;

      const key = ordenTabla.key;
      const dir = ordenTabla.dir === "asc" ? 1 : -1;

      const getValue = (p) => {
        if (key === "precio") return getPrecioPorLista(p, listaPrecio);
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
    // No limpiar si los productos aún no cargan (marcasDisponibles vacío):
    // si no, al volver a la pestaña se perdería el filtro de marca guardado.
    if (productos.length === 0) return;
    setFiltroMarcas((prev) =>
      prev.filter((m) => marcasDisponibles.some((d) => d.value === m.value))
    );
  }, [marcasDisponibles, productos.length]);

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

  // Punto 38: alternar Activo/Inactivo desde la grilla.
  async function toggleEstadoActivo(producto) {
    if (!puedeEditarProductoFila(producto)) return;
    const actual = (producto.estado || "").toString();
    // Solo permitimos togglear entre Activo e Inactivo. "Transitorio" y "Pendiente Aprobación"
    // se manejan por la lógica de SKU/margen y no se tocan acá.
    if (actual === "Transitorio" || actual === "Pendiente Aprobación") {
      setToast({
        type: "info",
        message: "Este producto está en flujo de aprobación y no puede marcarse como Inactivo manualmente.",
      });
      return;
    }
    const nuevo = actual === "Inactivo" ? "Activo" : "Inactivo";
    try {
      await api.put(`/productos/${producto.id}`, { estado: nuevo });
      setToast({ type: "success", message: `${producto.sku || producto.nombre} ahora está ${nuevo}.` });
      cargar();
    } catch (err) {
      console.error(err);
      setToast({ type: "error", message: "No se pudo cambiar el estado del producto." });
    }
  }

  async function descargarFicha(producto) {
    if (generandoFichaId != null) return;
    setGenerandoFichaId(producto.id);
    setToast({ type: "info", message: `Generando ficha técnica de ${producto.sku || producto.nombre}…` });
    try {
      // Traemos el producto completo por si la tabla no trae todos los campos de la ficha
      let productoCompleto = producto;
      try {
        const full = await api.get(`/productos/${producto.id}`);
        if (full) productoCompleto = { ...producto, ...full };
      } catch {
        // si falla, usamos lo que ya tenemos
      }
      await descargarFichaTecnica(productoCompleto);
      setToast({ type: "success", message: "Ficha técnica descargada." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo generar la ficha técnica." });
    } finally {
      setGenerandoFichaId(null);
    }
  }

  /* ============================================================
     EXPORTAR LISTADO (respeta los filtros activos)
  ============================================================ */
  async function exportarProductos() {
    if (productosFiltrados.length === 0) {
      setToast({ type: "info", message: "No hay productos para exportar con el filtro actual." });
      return;
    }
    try {
      const XLSX = await import("xlsx");
      // El listado liviano (/productos/list) puede no traer el costo según la
      // versión del backend desplegada. Si falta, lo traemos del endpoint
      // completo /productos (que ya devuelve costo) para que el export no
      // muestre 0. El costo se incluye siempre, para todos los roles.
      const faltaCosto = productosFiltrados.every((p) => p.costo == null);
      const costoPorId = {};
      if (faltaCosto) {
        try {
          const full = await api.get("/productos");
          (full || []).forEach((fp) => {
            costoPorId[fp.id] = Number(fp.costo ?? 0);
          });
        } catch (e) {
          console.error("No se pudo obtener el costo para el export:", e);
        }
      }
      const filas = productosFiltrados.map((p) => {
        const estadoRow = (p.estado || (p.sku ? "Activo" : "Transitorio")).toString().trim();
        const costo = faltaCosto ? costoPorId[p.id] ?? 0 : Number(p.costo ?? 0);
        const fila = {
          SKU: p.sku || "",
          Producto: p.nombre || "",
          Marca: p.marca || "",
          Categoría: p.categoria || "",
          Formato: p.formato || "",
          Estado: estadoRow,
          Costo: costo,
          "Lista 1": Number(p.lista1 ?? 0),
          "Lista 2": Number(p.lista2 ?? 0),
          "Lista 3": getPrecioPorLista(p, "lista3"),
        };
        return fila;
      });
      const ws = XLSX.utils.json_to_sheet(filas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Productos");
      const fecha = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `productos-${fecha}.xlsx`);
      setToast({
        type: "success",
        message: `Exportados ${filas.length} producto${filas.length === 1 ? "" : "s"} (con el filtro actual).`,
      });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo exportar el listado." });
    }
  }

  /* ============================================================
     UI
  ============================================================ */
  if (perfilLoading) {
    return <div className="page"><p style={{color:"var(--text-muted)"}}>Cargando…</p></div>;
  }

  return (
    <div className="page">
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}

      {/* HEADER */}
      <div className="page-header">
        <h1 className="page-title">Productos</h1>
        <div className="btn-row">
          {(rolNorm === "admin" || rolNorm === "jefe_ventas") && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={exportarProductos}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              title="Descargar el listado en Excel (respeta los filtros actuales)"
            >
              <Download size={14} /> Exportar Excel
            </button>
          )}
          {(rolNorm === "admin" || rolNorm === "jefe_ventas") && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCargaMasivaOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Upload size={14} /> Carga Masiva
            </button>
          )}
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

        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select
            className="input"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="Activo">Activo</option>
            <option value="Inactivo">Inactivo</option>
            <option value="Transitorio">Transitorio</option>
            <option value="Pendiente Aprobación">Pendiente Aprobación</option>
          </select>
        </div>
      </div>

      {/* TABLA */}
      <div className="table-wrap">
        <div className="table-scroll" style={{maxHeight: 760}}>
          <table className="data-table" style={{tableLayout: "fixed", width: "100%", minWidth: 1340}}>
            <colgroup>
              <col style={{width: 110}} />   {/* SKU */}
              <col style={{width: 300}} />   {/* Producto */}
              <col style={{width: 140}} />   {/* Marca */}
              <col style={{width: 140}} />   {/* Categoría */}
              <col style={{width: 100}} />   {/* Formato */}
              <col style={{width: 130}} />   {/* Precio Neto */}
              <col style={{width: 130}} />   {/* Precio Bruto */}
              <col style={{width: 290}} />   {/* Acciones */}
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
                <th style={{ userSelect: "none", padding: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 1.15 }}>
                    <span
                      onClick={() => toggleSort("precio")}
                      style={{ cursor: "pointer" }}
                    >
                      Precio Neto{sortIndicator("precio")}
                    </span>
                    <select
                      value={listaPrecio}
                      onChange={(e) => setListaPrecio(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      title="Elegir qué lista de precios mostrar"
                      style={{
                        marginTop: 2,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        color: "var(--primary, #28aeb1)",
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "none",
                        letterSpacing: 0,
                        cursor: "pointer",
                        appearance: "auto",
                        width: "fit-content",
                      }}
                    >
                      <option value="lista1">Lista 1 ▾</option>
                      <option value="lista2">Lista 2 ▾</option>
                      <option value="lista3">Lista 3 ▾</option>
                    </select>
                  </div>
                </th>
                <th>Precio Bruto</th>
                <th>Acciones</th>
              </tr>
            </thead>

            <tbody>
              {productosFiltrados.map((p) => {
                const precioNormal = getPrecioPorLista(p, listaPrecio);
                const precioCampania = campaignPriceBySku.get(p.sku);
                const fichaCompleta = fichaTecnicaCompleta(p);

                return (
                  <tr key={p.id}>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{p.sku}</td>
                    <td style={{whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}} title={p.nombre}>
                      {p.nombre}
                    </td>
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

                    <td style={{fontWeight: 600}}>
                      {/* Punto 34: bruto (neto × 1.19) — IVA incluido */}
                      <div style={{lineHeight: 1.4}}>
                        <div>${Math.round(precioNormal * 1.19).toLocaleString("es-CL")}</div>
                        {precioCampania != null && (
                          <div style={{fontSize: 12, color: "#15803d"}}>
                            ${Math.round(Number(precioCampania) * 1.19).toLocaleString("es-CL")}{" "}
                            <span style={{fontSize: 11, fontWeight: 500}}>(Campaña)</span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td style={{textAlign: "right"}}>
                      <div className="btn-row" style={{justifyContent: "flex-end", flexWrap: "nowrap", gap: 4}}>
                        <button
                          type="button"
                          onClick={() => descargarFicha(p)}
                          className="btn btn-ghost btn-sm"
                          disabled={generandoFichaId === p.id}
                          title={
                            fichaCompleta
                              ? "Producto destacado · tiene ficha técnica — descargar PDF"
                              : "Descargar ficha técnica en PDF"
                          }
                          style={
                            fichaCompleta
                              ? {
                                  background: "linear-gradient(135deg, #f59e0b, #f97316)",
                                  color: "#fff",
                                  borderColor: "#f59e0b",
                                  fontWeight: 700,
                                  boxShadow: "0 2px 9px -2px rgba(245,158,11,.7)",
                                }
                              : undefined
                          }
                        >
                          <FileDown size={14} />
                          {generandoFichaId === p.id ? "Generando…" : "Ficha"}
                        </button>
                        <Link
                          to={`/productos/editar/${p.id}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Editar
                        </Link>
                        {rolNorm !== "ventas" && (
                          <MenuAccionesProducto
                            producto={p}
                            onToggleEstado={toggleEstadoActivo}
                            onEliminar={solicitarEliminacion}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {productosFiltrados.length === 0 && (
                <tr>
                  <td colSpan="8" style={{textAlign: "center", color: "var(--text-muted)", padding: "32px 16px"}}>
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

      {cargaMasivaOpen && (
        <CargaMasivaProductosModal
          onClose={() => setCargaMasivaOpen(false)}
          onSuccess={() => { setCargaMasivaOpen(false); cargar(); }}
          onToast={setToast}
        />
      )}
    </div>
  );
}

/* ============================================================
   Modal: Carga Masiva de Productos (Punto 37)
   ─ Acepta .xlsx, .xls o .csv
   ─ Match por SKU; si no existe → crea (upsert)
   ─ Campos editables: sku, nombre, categoria, marca, formato, costo,
     lista1, lista2, estado
============================================================ */
const COLUMNAS_PLANTILLA = ["sku", "nombre", "categoria", "marca", "formato", "costo", "lista1", "lista2", "estado"];

function CargaMasivaProductosModal({ onClose, onSuccess, onToast }) {
  const [archivo, setArchivo] = useState(null);
  const [filas, setFilas] = useState([]);
  const [duplicados, setDuplicados] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resumen, setResumen] = useState(null);

  async function manejarArchivo(file) {
    if (!file) return;
    setArchivo(file);
    setResumen(null);
    setDuplicados([]);
    setParsing(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // defval: "" para que columnas vacías vengan como string vacío y se descarten luego.
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      const normalizadas = raw.map((row) => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
          const key = String(k).trim().toLowerCase();
          if (!COLUMNAS_PLANTILLA.includes(key)) continue;
          let val = typeof v === "string" ? v.trim() : v;
          if (val === "" || val == null) continue;
          // Campos numéricos: quitar símbolos ($, espacios, NBSP, letras) y
          // luego puntos de miles y comas decimales. Así "$23.482" → 23482.
          if (["costo", "lista1", "lista2"].includes(key)) {
            const limpioNum = String(val).replace(/[^\d.,-]/g, "");
            if (limpioNum === "") continue;
            const n = Number(limpioNum.replace(/\./g, "").replace(",", "."));
            if (!Number.isFinite(n)) continue;
            val = Math.round(n);
          }
          out[key] = val;
        }
        return out;
      }).filter((r) => r.sku);
      setFilas(normalizadas);

      // Detectar SKUs repetidos dentro del archivo: la base no permite SKU
      // duplicado, y un solo repetido hace fallar el lote completo en el insert.
      // Avisamos ANTES de enviar para que se corrija sin cargas a medias.
      const conteo = new Map();
      for (const r of normalizadas) {
        const key = String(r.sku).trim().toUpperCase();
        if (!conteo.has(key)) conteo.set(key, { sku: String(r.sku).trim(), nombres: [] });
        conteo.get(key).nombres.push(r.nombre || "(sin nombre)");
      }
      setDuplicados([...conteo.values()].filter((x) => x.nombres.length > 1));
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: "No se pudo leer el archivo. ¿Es un .xlsx, .xls o .csv válido?" });
      setFilas([]);
      setDuplicados([]);
    } finally {
      setParsing(false);
    }
  }

  async function descargarPlantilla() {
    try {
      const XLSX = await import("xlsx");
      const ejemplo = [
        { sku: "EJ-001", nombre: "Producto ejemplo", categoria: "Categoría", marca: "Marca", formato: "1 unidad", costo: 1000, lista1: 2000, lista2: 2500, estado: "Activo" },
      ];
      const ws = XLSX.utils.json_to_sheet(ejemplo, { header: COLUMNAS_PLANTILLA });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Productos");
      XLSX.writeFile(wb, "plantilla_productos.xlsx");
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: "No se pudo generar la plantilla." });
    }
  }

  async function importar() {
    if (filas.length === 0) return;
    if (duplicados.length > 0) {
      onToast?.({ type: "error", message: "Hay SKU duplicados en el archivo. Corrígelos antes de importar." });
      return;
    }
    setEnviando(true);
    try {
      const res = await api.post("/productos/bulk-upsert", { rows: filas });
      setResumen(res);
      if (res.errores?.length > 0) {
        onToast?.({ type: "info", message: `Importado con ${res.errores.length} errores. Revisa el detalle.` });
      } else {
        onToast?.({ type: "success", message: `Listo: ${res.creados} creados, ${res.actualizados} actualizados.` });
      }
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: e?.message || "Error al importar." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
        pointerEvents: "auto",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 12,
          padding: "22px 24px",
          width: "min(640px, 100%)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Carga Masiva de Productos</h3>
          <button type="button" onClick={onClose} disabled={enviando} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginTop: 2, marginBottom: 16 }}>
          Sube un archivo .xlsx o .csv. El match es por <strong>SKU</strong>: si existe se actualiza, si no se crea.
          Las celdas vacías no sobrescriben los valores actuales.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button type="button" onClick={descargarPlantilla} className="btn btn-ghost btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download size={14} /> Descargar plantilla
          </button>
        </div>

        <label
          style={{
            display: "block",
            border: "2px dashed var(--border, #cbd5e1)",
            borderRadius: 10,
            padding: "20px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: archivo ? "#f0fdfa" : "var(--bg, #f8fafc)",
            transition: "background 0.15s",
          }}
        >
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => manejarArchivo(e.target.files?.[0])}
            style={{ display: "none" }}
            disabled={enviando}
          />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Upload size={22} color="var(--primary, #28aeb1)" />
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              {archivo ? archivo.name : "Haz clic o arrastra el archivo aquí"}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted, #64748b)" }}>
              Columnas reconocidas: {COLUMNAS_PLANTILLA.join(", ")}
            </span>
          </div>
        </label>

        {parsing && <p style={{ fontSize: 12, marginTop: 10 }}>Procesando archivo…</p>}

        {archivo && !parsing && (
          <p style={{ fontSize: 13, marginTop: 12 }}>
            <strong>{filas.length}</strong> {filas.length === 1 ? "fila lista" : "filas listas"} para importar
            {filas.length === 0 && " — ¿el archivo tiene la columna SKU?"}
          </p>
        )}

        {!parsing && duplicados.length > 0 && (
          <div style={{ marginTop: 10, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13 }}>
            <div style={{ color: "#b91c1c", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <AlertCircle size={15} /> {duplicados.length} SKU{duplicados.length === 1 ? "" : "s"} duplicado{duplicados.length === 1 ? "" : "s"} en el archivo
            </div>
            <p style={{ margin: "6px 0 8px", color: "#7f1d1d" }}>
              La base no permite SKU repetido. Corrige estos códigos en el archivo y vuelve a subirlo:
            </p>
            <ul style={{ margin: "0 0 0 18px", color: "#7f1d1d" }}>
              {duplicados.slice(0, 20).map((d) => (
                <li key={d.sku} style={{ marginBottom: 4 }}>
                  <strong>{d.sku}</strong> ({d.nombres.length}×): {d.nombres.slice(0, 3).join(" · ")}
                  {d.nombres.length > 3 ? " · …" : ""}
                </li>
              ))}
            </ul>
            {duplicados.length > 20 && (
              <p style={{ margin: "6px 0 0", color: "#7f1d1d" }}>…y {duplicados.length - 20} más.</p>
            )}
          </div>
        )}

        {resumen && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: "#f1f5f9", borderRadius: 8, fontSize: 13 }}>
            <div>✅ Creados: <strong>{resumen.creados}</strong></div>
            <div>🔄 Actualizados: <strong>{resumen.actualizados}</strong></div>
            <div>⚠️ Ignorados (sin SKU): <strong>{resumen.ignorados}</strong></div>
            {resumen.errores?.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: "#b91c1c" }}>
                  {resumen.errores.length} {resumen.errores.length === 1 ? "error" : "errores"}
                </summary>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12 }}>
                  {resumen.errores.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={enviando}>
            {resumen ? "Cerrar" : "Cancelar"}
          </button>
          {!resumen && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={importar}
              disabled={filas.length === 0 || enviando || duplicados.length > 0}
              title={duplicados.length > 0 ? "Corrige los SKU duplicados antes de importar" : undefined}
            >
              {enviando ? "Importando…" : `Importar ${filas.length || ""}`}
            </button>
          )}
          {resumen && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onSuccess}>
              Refrescar lista
            </button>
          )}
        </div>
      </div>
    </div>
  );
}





