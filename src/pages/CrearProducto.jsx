// CrearProducto.jsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import { Link } from "react-router-dom";
import Select from "react-select";

/* ============================================================
   BUSCADOR MEJORADO (igual que CrearLicitacion)
============================================================ */
function normalizarTexto(str) {
  return (str ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filtrarPorTerminos(option, inputValue) {
  const q = normalizarTexto(inputValue);
  if (!q) return true;

  const label = normalizarTexto(option.label);
  const terms = q.split(" ").filter(Boolean);
  return terms.every((t) => label.includes(t));
}

/* ============================================================
   CATEGORÍAS (LISTA)
   ✅ se guardan tal cual (texto)
============================================================ */
const CATEGORIAS = [
  "Prevención e Higiene",
  "Consumibles",
  "Blanqueamiento",
  "Operatoria",
  "Endodoncia",
  "Periodoncia",
  "Cirugía",
  "Ortodoncia",
  "Equipos y Otros",
  "Esterilización",
  "Fresas y Pulido",
  "Instrumental",
  "Radiología",
  "Impresión",
  "Laboratorio",
  "Insumos Médicos",
  "Desinfección",
];

const opcionesCategoria = CATEGORIAS.map((c) => ({ value: c, label: c }));

/* ============================================================
   ESTILOS react-select
   ✅ Igual al input "Marca" (rounded-md, bg-gray-50, border, text-sm)
============================================================ */
const customStyles = {
  control: (base) => ({
    ...base,
    minHeight: "42px",
    height: "42px",
    borderRadius: "6px",        // rounded-md
    borderColor: "#d1d5db",     // border-gray-300
    backgroundColor: "#f9fafb", // bg-gray-50
    boxShadow: "none",
    fontFamily: "inherit",
    fontSize: "14px",           // text-sm
    paddingLeft: "2px",
    ":hover": { borderColor: "#d1d5db" },
  }),

  valueContainer: (base) => ({
    ...base,
    height: "42px",
    padding: "0 12px",          // px-3
    fontFamily: "inherit",
    fontSize: "14px",
  }),

  input: (base) => ({
    ...base,
    margin: 0,
    padding: 0,
    fontFamily: "inherit",
    fontSize: "14px",
    color: "#111827",
  }),

  singleValue: (base) => ({
    ...base,
    fontFamily: "inherit",
    fontSize: "14px",
    color: "#111827",
  }),

  placeholder: (base) => ({
    ...base,
    fontFamily: "inherit",
    fontSize: "14px",
    color: "#6b7280",
  }),

  indicatorSeparator: () => ({ display: "none" }),

  dropdownIndicator: (base) => ({
    ...base,
    padding: "0 8px",
    color: "#6b7280",
  }),

  option: (base, state) => ({
    ...base,
    fontFamily: "inherit",
    fontSize: "14px",
    backgroundColor: state.isFocused ? "#1A73E8" : "white",
    color: state.isFocused ? "white" : "#111827",
    cursor: "pointer",
  }),

  // ✅ para que el menú no quede detrás de otros elementos
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
};

export default function CrearProducto() {
  const [sku, setSku] = useState("");
  const [estado, setEstado] = useState("Transitorio");
  const [nombre, setNombre] = useState("");
  const [marca, setMarca] = useState("");
  const [categoria, setCategoria] = useState(""); // ✅ ahora viene del Select
  const [formato, setFormato] = useState("");
  const [costo, setCosto] = useState("");
  const [presentacion, setPresentacion] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [composicion, setComposicion] = useState("");
  const [usoIndicaciones, setUsoIndicaciones] = useState("");
  const [beneficios, setBeneficios] = useState("");
  const [modoUso, setModoUso] = useState("");
  const [almacenamiento, setAlmacenamiento] = useState("");
  const [datosClave, setDatosClave] = useState("");
  const [peso, setPeso] = useState("");
  const [alto, setAlto] = useState("");
  const [largo, setLargo] = useState("");
  const [ancho, setAncho] = useState("");
  const [imagenFile, setImagenFile] = useState(null);
  const [imagenPreview, setImagenPreview] = useState("");

  const [precios, setPrecios] = useState({
    lista1: "",
    lista2: "",
    lista3: "",
    lista4: "",
  });

  const [toast, setToast] = useState(null);

  const [rol, setRol] = useState(null);
  const [rolLoading, setRolLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");

  /* ==========================================================
     Cargar rol del usuario
  ========================================================== */
  useEffect(() => {
    let alive = true;

    async function obtenerRol() {
      try {
        setRolLoading(true);

        const perfil = await api.get("/auth/profile");
        if (alive) {
          setRol(perfil?.rol ?? null);
          setUserEmail(perfil?.email || "");
        }
      } finally {
        if (alive) setRolLoading(false);
      }
    }

    obtenerRol();
    return () => {
      alive = false;
    };
  }, []);

  const rolNorm = useMemo(() => (rol ?? "").toString().trim().toLowerCase(), [rol]);
  // ✅ En tu DB el rol suele ser "admin" (y por compatibilidad también "Administrador")
  const puedeIngresarSKU = useMemo(() => {
    return rol === "admin" || rol === "Administrador";
  }, [rol]);
  const esAdmin = puedeIngresarSKU;
  const esVentasOJefe = useMemo(
    () => rolNorm === "ventas" || rolNorm === "jefe_ventas",
    [rolNorm]
  );
  const esTransitorio = (sku ?? "").toString().trim() === "";
  const mostrarMargen =
    !esVentasOJefe || esTransitorio || esPendienteAprobacion;
  const puedeVerCosto =
    esAdmin || (esVentasOJefe && (esTransitorio || esPendienteAprobacion));

  const metroCubico = useMemo(() => {
    const a = Number(alto) || 0;
    const l = Number(largo) || 0;
    const an = Number(ancho) || 0;
    if (!a || !l || !an) return "";
    return (a * l * an).toFixed(3);
  }, [alto, largo, ancho]);

  const margenVenta = useMemo(() => {
    const precioVenta = Number(precios.lista1) || 0;
    const costoNum = Number(costo) || 0;
    if (precioVenta <= 0) return "0.00%";
    const margen = ((precioVenta - costoNum) / precioVenta) * 100;
    return `${margen.toFixed(2)}%`;
  }, [precios.lista1, costo]);

  const margenVentaNum = useMemo(() => {
    const precioVenta = Number(precios.lista1) || 0;
    const costoNum = Number(costo) || 0;
    if (precioVenta <= 0) return 0;
    return ((precioVenta - costoNum) / precioVenta) * 100;
  }, [precios.lista1, costo]);

  const estadoMostrado = useMemo(() => {
    if (sku.trim()) return "Activo";
    return estado || "Transitorio";
  }, [sku, estado]);

  const esPendienteAprobacion = estadoMostrado === "Pendiente Aprobación";

  useEffect(() => {
    if (!imagenFile) {
      setImagenPreview("");
      return;
    }

    const url = URL.createObjectURL(imagenFile);
    setImagenPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imagenFile]);

  function actualizarPrecio(lista, valor) {
    setPrecios((prev) => ({ ...prev, [lista]: valor }));
  }

  async function subirImagenProducto() {
    if (!imagenFile) return "";

    const formData = new FormData();
    formData.append("file", imagenFile);

    const skuBase = (sku ?? "").toString().trim().toUpperCase();
    const res = await api.postForm(`/productos/upload-image?sku=${encodeURIComponent(skuBase)}`, formData);
    return res.path;
  }

  async function guardarProducto() {
    setToast(null);

    const skuLimpio = (sku ?? "").toString().trim().toUpperCase();
    let estadoFinal = skuLimpio ? "Activo" : "Transitorio";
    if (!skuLimpio && margenVentaNum > 0 && margenVentaNum < 15) {
      estadoFinal = "Pendiente Aprobación";
    }

    const missing = [];
    if (!(nombre ?? "").toString().trim()) missing.push("Nombre del Producto");
    if (!(categoria ?? "").toString().trim()) missing.push("Categoría");
    if (!(formato ?? "").toString().trim()) missing.push("Formato");
    if (!(presentacion ?? "").toString().trim()) missing.push("Presentación");
    if (!(descripcion ?? "").toString().trim()) missing.push("Descripción");
    if (!(composicion ?? "").toString().trim()) missing.push("Composición");
    if (!(usoIndicaciones ?? "").toString().trim()) missing.push("Uso/Indicaciones");
    if (!(beneficios ?? "").toString().trim()) missing.push("Beneficios");
    if (puedeVerCosto && !(Number(costo) > 0)) missing.push("Costo");
    if (!(Number(precios.lista1) > 0)) missing.push("Precio de Venta (Lista 1)");

    if (missing.length) {
      setToast({
        type: "error",
        message: `Debes completar: ${missing.join(", ")}.`,
      });
      return;
    }

    // ✅ Solo admin puede enviar sku; si está vacío => null (evita constraint)
    const skuPermitido = puedeIngresarSKU && skuLimpio ? skuLimpio : null;

    let imagenUrl = "";
    try {
      imagenUrl = await subirImagenProducto();
    } catch (e) {
      console.error(e);
      setToast({
        type: "error",
        message: "Error subiendo la imagen del producto.",
      });
      return;
    }

    const payload = {
      sku: skuPermitido,
      estado: estadoFinal,
      nombre,
      marca,
      categoria,
      formato,
      imagen_url: imagenUrl || null,
      presentacion,
      descripcion,
      composicion,
      uso_indicaciones: usoIndicaciones,
      beneficios,
      modo_uso: modoUso,
      almacenamiento,
      datos_clave: datosClave,
      peso: Number(peso) || 0,
      alto: Number(alto) || 0,
      largo: Number(largo) || 0,
      ancho: Number(ancho) || 0,
      metro_cubico: Number(metroCubico) || 0,
      lista1: Number(precios.lista1) || 0,
      lista2: Number(precios.lista2) || 0,
      lista3: 0,
      lista4: 0,
      creado_por: userEmail || null,
    };

    if (puedeVerCosto) {
      payload.costo = Number(costo) || 0;
    }

    try {
      await api.post("/productos", payload);
    } catch (error) {
      console.error(error);
      setToast({
        type: "error",
        message: "Error al guardar el producto.",
      });
      return;
    }

    if (estadoFinal === "Pendiente Aprobación") {
      setToast({
        type: "warning",
        message:
          "Producto creado en estado \"Pendiente Aprobación\" (margen < 15%).",
      });
    } else {
      setToast({
        type: "success",
        message: "Producto creado con éxito",
      });
    }

    setSku("");
    setEstado(estadoFinal);
    setNombre("");
    setMarca("");
    setCategoria("");
    setFormato("");
    setCosto("");
    setPresentacion("");
    setDescripcion("");
    setComposicion("");
    setUsoIndicaciones("");
    setBeneficios("");
    setModoUso("");
    setAlmacenamiento("");
    setDatosClave("");
    setPeso("");
    setAlto("");
    setLargo("");
    setAncho("");
    setImagenFile(null);
    setPrecios({ lista1: "", lista2: "", lista3: "", lista4: "" });
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      <h1 className="text-3xl font-semibold text-gray-900 mb-8">
        Crear Producto
      </h1>

      <Link
        to="/productos"
        className="text-blue-600 hover:text-blue-800 text-sm mb-4 block"
      >
        ← Volver al listado
      </Link>

      <div className="bg-white border border-gray-300 rounded-xl shadow-sm p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* INFORMACIÓN GENERAL */}
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
              Información General
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Estado
                    </label>
                    <input
                      className={`w-full rounded-md border px-3 py-2 ${
                        esPendienteAprobacion
                          ? "border-orange-400 bg-orange-50 text-orange-900"
                          : "border-gray-300 bg-gray-100"
                      }`}
                      value={estadoMostrado}
                      readOnly
                    />
                    {esPendienteAprobacion && (
                      <p className="text-xs text-orange-700 mt-1">
                        Requiere aprobación de admin (margen &lt; 15%).
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      SKU
                    </label>
                    <input
                      className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                      value={sku}
                      disabled={rolLoading || !puedeIngresarSKU}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setSku(val);
                        setEstado(val.trim() ? "Activo" : "Transitorio");
                      }}
                      placeholder="Ej: PH00001"
                    />

                    {rolLoading ? (
                      <p className="text-xs text-gray-500 mt-1">Cargando permisos…</p>
                    ) : !puedeIngresarSKU ? (
                      <p className="text-xs text-red-600 mt-1">
                        Tu rol no permite ingresar SKU.
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500 mt-1">
                        Solo admin puede asignar SKU (opcional).
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nombre del Producto *
                    </label>
                    <input
                      className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Marca
                    </label>
                    <input
                      className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                      value={marca}
                      onChange={(e) => setMarca(e.target.value)}
                      placeholder="Ej: Curaprox, Vitis, Dentaid"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Categoría
                    </label>

                    <Select
                      options={opcionesCategoria}
                      styles={customStyles}
                      placeholder="Seleccione categoría…"
                      menuPortalTarget={document.body}
                      isSearchable={true}
                      filterOption={filtrarPorTerminos}
                      value={
                        opcionesCategoria.find((o) => o.value === categoria) || null
                      }
                      onChange={(op) => setCategoria(op ? op.value : "")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Formato *
                    </label>
                    <input
                      className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                      value={formato}
                      onChange={(e) => setFormato(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold text-gray-800 mb-3">
                    Imagen del Producto
                  </div>

                  {imagenPreview ? (
                    <div className="h-56 w-full rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                      <img
                        src={imagenPreview}
                        alt="Preview"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="h-56 w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 flex items-center justify-center">
                      Sin imagen
                    </div>
                  )}

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      JPG o PNG
                    </label>
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                        Seleccionar imagen
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          className="hidden"
                          onChange={(e) =>
                            setImagenFile(e.target.files?.[0] || null)
                          }
                        />
                      </label>
                      <span className="text-xs text-gray-500 truncate">
                        {imagenFile?.name || "Sin archivo"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* DETALLE DEL PRODUCTO */}
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
              Detalle del Producto
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Presentación *
                </label>
                <input
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={presentacion}
                  onChange={(e) => setPresentacion(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Descripción *
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Composición *
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={composicion}
                  onChange={(e) => setComposicion(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Uso/Indicaciones *
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={usoIndicaciones}
                  onChange={(e) => setUsoIndicaciones(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Beneficios *
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={beneficios}
                  onChange={(e) => setBeneficios(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Modo de uso
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={modoUso}
                  onChange={(e) => setModoUso(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Almacenamiento
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={almacenamiento}
                  onChange={(e) => setAlmacenamiento(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Datos Clave
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={datosClave}
                  onChange={(e) => setDatosClave(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* DIMENSIONES */}
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
              Dimensiones y Peso
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Peso (kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={peso}
                  onChange={(e) => setPeso(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Alto (cm)
                </label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={alto}
                  onChange={(e) => setAlto(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Largo (cm)
                </label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={largo}
                  onChange={(e) => setLargo(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Ancho (cm)
                </label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                  value={ancho}
                  onChange={(e) => setAncho(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Centímetro cúbico (cm³)
                </label>
                <input
                  readOnly
                  className="w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2"
                  value={metroCubico}
                />
              </div>
            </div>
          </div>

          {/* LISTA DE PRECIOS */}
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">
              Lista de Precios
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {puedeVerCosto && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Costo *
                  </label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                    value={costo}
                    onChange={(e) => setCosto(e.target.value)}
                  />
                </div>
              )}

              {(esVentasOJefe ? ["lista1"] : ["lista1", "lista2"]).map((list) => (
                <div key={list}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {list === "lista1"
                      ? esVentasOJefe
                        ? "Precio Venta Neto *"
                        : "Listado de Precios 1 *"
                      : "Listado de Precios 2"}
                  </label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2"
                    value={precios[list]}
                    onChange={(e) => actualizarPrecio(list, e.target.value)}
                  />
                </div>
              ))}

              {mostrarMargen && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Margen
                  </label>
                  <input
                    readOnly
                    className="w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2"
                    value={margenVenta}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={guardarProducto}
            className="cursor-pointer bg-blue-600 text-white px-6 py-2 rounded-md shadow hover:bg-blue-700 transition-colors"
          >
            Guardar Producto
          </button>
        </div>
      </div>
    </div>
  );
}
