import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Sparkles,
  Package,
  Image as ImageIcon,
  DollarSign,
  Ruler,
  FileText,
  Check,
  Loader2,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { api } from "../lib/api";
import { FACTOR_LISTA_3, calcularLista3 } from "../lib/listas";

// Paleta de la plataforma
const TEAL = "#25b7bd";
const TEAL_OSC = "#178a8f";
const TEAL_DEEP = "#0e6e74";
const TEAL_SOFT = "#e8f7f7";
const TEAL_MID = "#b2e4e5";

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

function formatearCLDesdeString(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("es-CL");
}

function numFromCL(value) {
  if (typeof value === "number") return value;
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

// Mapea nombres de columna técnicos a etiquetas amigables para los
// mensajes de error. Usado cuando el backend devuelve un mensaje que
// menciona una columna que falló validación (null value, check, etc).
const NOMBRES_COLUMNAS = {
  sku: "SKU",
  nombre: "Nombre del producto",
  marca: "Marca",
  categoria: "Categoría",
  formato: "Formato",
  presentacion: "Presentación",
  descripcion: "Descripción",
  composicion: "Composición",
  uso_indicaciones: "Uso/Indicaciones",
  beneficios: "Beneficios",
  modo_uso: "Modo de uso",
  almacenamiento: "Almacenamiento",
  datos_clave: "Datos clave",
  peso: "Peso",
  alto: "Alto",
  largo: "Largo",
  ancho: "Ancho",
  costo: "Costo",
  lista1: "Precio Lista 1",
  lista2: "Precio Lista 2",
  lista3: "Precio Lista 3",
  estado: "Estado",
  imagen_url: "Imagen",
};

// Traduce errores del backend (Postgres + NestJS) a mensajes claros.
// Devuelve { titulo, detalle, seccion } para que el modal sepa qué mostrar
// y qué pestaña abrir si el error es de un campo específico.
function interpretarError(error, contexto = "guardar") {
  const status = Number(error?.status || 0);
  const msg = String(error?.message || "").toLowerCase();
  const detail = String(error?.body?.message || error?.body?.error || "").toLowerCase();
  const full = `${msg} ${detail}`;

  // Permisos / sesión
  if (status === 401) {
    return { titulo: "Sesión expirada", detalle: "Vuelve a iniciar sesión y reintenta." };
  }
  if (status === 403) {
    return { titulo: "Sin permisos", detalle: "Tu rol no permite crear productos." };
  }

  // SKU duplicado (unique constraint)
  if (
    full.includes("duplicate key") ||
    full.includes("unique constraint") ||
    full.includes("23505")
  ) {
    return {
      titulo: "SKU duplicado",
      detalle: "Ya existe un producto con ese SKU. Usa otro o deja el campo vacío.",
      seccion: "general",
    };
  }

  // Columna obligatoria vacía
  const matchNullCol = full.match(/null value in column\s+["']?(\w+)["']?/);
  if (matchNullCol) {
    const col = matchNullCol[1];
    const label = NOMBRES_COLUMNAS[col] || col;
    return {
      titulo: "Campo obligatorio",
      detalle: `Falta completar: ${label}.`,
      seccion: inferirSeccion(col),
    };
  }

  // Check constraint
  if (full.includes("check constraint") || full.includes("violates check")) {
    return {
      titulo: "Valor no válido",
      detalle: "Uno de los valores no cumple las reglas del producto (revisa estado, listas o costo).",
      seccion: "precios",
    };
  }

  // Columna inexistente (migración pendiente)
  if (full.includes("does not exist") && full.includes("column")) {
    return {
      titulo: "Columna no disponible",
      detalle: "La base de datos no tiene una columna que el formulario espera. Avisa al admin para actualizar la migración.",
    };
  }

  // Upload errores
  if (contexto === "imagen") {
    if (status === 413 || full.includes("too large") || full.includes("payload too large")) {
      return { titulo: "Imagen demasiado grande", detalle: "Reduce el tamaño del archivo (máximo recomendado: 5 MB)." };
    }
    if (status === 415 || full.includes("mime") || full.includes("unsupported")) {
      return { titulo: "Formato no soportado", detalle: "Solo se permiten archivos JPG o PNG." };
    }
    if (full.includes("storage") || full.includes("bucket")) {
      return { titulo: "Error subiendo la imagen", detalle: "El servidor rechazó el archivo. Intenta con otra imagen." };
    }
    return { titulo: "Error subiendo la imagen", detalle: error?.message || "Intenta nuevamente." };
  }

  // Red / servidor caído
  if (status === 0 || full.includes("failed to fetch") || full.includes("network")) {
    return {
      titulo: "Sin conexión con el servidor",
      detalle: "Verifica tu conexión a internet y que el backend esté corriendo.",
    };
  }
  if (status >= 500) {
    return {
      titulo: "Error del servidor",
      detalle: error?.message || "El backend devolvió un error inesperado. Reintenta en unos segundos.",
    };
  }
  if (status >= 400) {
    return {
      titulo: "Error de validación",
      detalle: error?.message || "Revisa los datos del producto y reintenta.",
    };
  }

  return {
    titulo: "Error al guardar",
    detalle: error?.message || "Error desconocido. Revisa la consola del navegador.",
  };
}

function inferirSeccion(col) {
  const general = ["sku", "nombre", "marca", "categoria", "formato", "imagen_url", "estado"];
  const detalle = ["presentacion", "descripcion", "composicion", "uso_indicaciones", "beneficios", "modo_uso", "almacenamiento", "datos_clave"];
  const dims = ["peso", "alto", "largo", "ancho"];
  const precios = ["costo", "lista1", "lista2", "lista3", "lista4"];
  if (general.includes(col)) return "general";
  if (detalle.includes(col)) return "detalle";
  if (dims.includes(col)) return "dimensiones";
  if (precios.includes(col)) return "precios";
  return undefined;
}

// Mismo input monetario que CrearProducto pero con estilo del picker.
function MoneyInput({ value, onChange, readOnly = false, placeholder = "" }) {
  const display =
    typeof value === "number"
      ? value > 0
        ? value.toLocaleString("es-CL")
        : ""
      : value ?? "";
  return (
    <div style={{ position: "relative" }}>
      <span className="cpm-money-prefix">$</span>
      <input
        type="text"
        inputMode="numeric"
        readOnly={readOnly}
        placeholder={placeholder}
        className={`cpm-input cpm-money-input ${readOnly ? "is-readonly" : ""}`}
        value={display}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}

export default function CrearProductoModal({ onClose, onCreado }) {
  // ====================== PERFIL ======================
  const [rol, setRol] = useState(null);
  const [rolLoading, setRolLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setRolLoading(true);
        const perfil = await api.get("/auth/profile");
        if (!alive) return;
        setRol(perfil?.rol ?? null);
        setUserEmail(perfil?.email || "");
      } finally {
        if (alive) setRolLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ====================== ESTADO DEL FORM ======================
  const [sku, setSku] = useState("");
  const [nombre, setNombre] = useState("");
  const [marca, setMarca] = useState("");
  const [categoria, setCategoria] = useState("");
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
  const [linkReferencia, setLinkReferencia] = useState("");
  const [peso, setPeso] = useState("");
  const [alto, setAlto] = useState("");
  const [largo, setLargo] = useState("");
  const [ancho, setAncho] = useState("");
  const [imagenFile, setImagenFile] = useState(null);
  const [imagenPreview, setImagenPreview] = useState("");
  const [precios, setPrecios] = useState({ lista1: "", lista2: "" });
  const [guardando, setGuardando] = useState(false);
  // error = { titulo: string, detalle: string } | null
  const [error, setError] = useState(null);
  const [seccion, setSeccion] = useState("general"); // general | detalle | dimensiones | precios

  // ====================== REGLAS / ROLES ======================
  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const puedeIngresarSKU = rolNorm === "admin" || rolNorm === "administrador";
  const esAdmin = puedeIngresarSKU;
  const esVentasOJefe =
    rolNorm === "ventas" ||
    rolNorm === "ventas_especial" ||
    rolNorm === "jefe_ventas" ||
    rolNorm === "jefe_ventas_especial" ||
    rolNorm === "contabilidad";
  const esTransitorio = (sku ?? "").toString().trim() === "";

  const metroCubico = useMemo(() => {
    const a = Number(alto) || 0;
    const l = Number(largo) || 0;
    const an = Number(ancho) || 0;
    if (!a || !l || !an) return "";
    return (a * l * an).toFixed(3);
  }, [alto, largo, ancho]);

  const margenVentaNum = useMemo(() => {
    const precioVenta = numFromCL(precios.lista1);
    const costoNum = numFromCL(costo);
    if (precioVenta <= 0) return 0;
    return ((precioVenta - costoNum) / precioVenta) * 100;
  }, [precios.lista1, costo]);

  const margenLista1 = useMemo(() => {
    const precio = numFromCL(precios.lista1);
    const c = numFromCL(costo);
    if (precio <= 0) return "0.00%";
    return `${(((precio - c) / precio) * 100).toFixed(2)}%`;
  }, [precios.lista1, costo]);

  const margenLista2 = useMemo(() => {
    const precio = numFromCL(precios.lista2);
    const c = numFromCL(costo);
    if (precio <= 0) return "0.00%";
    return `${(((precio - c) / precio) * 100).toFixed(2)}%`;
  }, [precios.lista2, costo]);

  const lista3Calculada = useMemo(
    () => calcularLista3(numFromCL(precios.lista2)),
    [precios.lista2],
  );
  const lista3Display =
    lista3Calculada > 0 ? lista3Calculada.toLocaleString("es-CL") : "";
  const margenLista3 = useMemo(() => {
    const c = numFromCL(costo);
    if (lista3Calculada <= 0) return "0.00%";
    return `${(((lista3Calculada - c) / lista3Calculada) * 100).toFixed(2)}%`;
  }, [lista3Calculada, costo]);

  const estadoMostradoBase = sku.trim()
    ? "Activo"
    : margenVentaNum > 0 && margenVentaNum < 20
    ? "Pendiente Aprobación"
    : "Transitorio";
  const esPendienteAprobacion = estadoMostradoBase === "Pendiente Aprobación";

  const mostrarMargen =
    !esVentasOJefe || esTransitorio || esPendienteAprobacion;
  const puedeVerCosto =
    esAdmin || (esVentasOJefe && (esTransitorio || esPendienteAprobacion));

  // ====================== EFECTOS ======================
  // ESC para cerrar
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Preview de imagen
  useEffect(() => {
    if (!imagenFile) {
      setImagenPreview("");
      return;
    }
    const url = URL.createObjectURL(imagenFile);
    setImagenPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imagenFile]);

  // ====================== GUARDAR ======================
  function actualizarPrecio(lista, valor) {
    setPrecios((prev) => ({ ...prev, [lista]: formatearCLDesdeString(valor) }));
  }

  async function subirImagen() {
    if (!imagenFile) return "";
    const formData = new FormData();
    formData.append("file", imagenFile);
    const skuBase = (sku ?? "").toString().trim().toUpperCase();
    const res = await api.postForm(
      `/productos/upload-image?sku=${encodeURIComponent(skuBase)}`,
      formData,
    );
    return res.path;
  }

  async function guardar() {
    setError(null);
    const skuLimpio = (sku ?? "").toString().trim().toUpperCase();

    let estadoFinal = skuLimpio ? "Activo" : "Transitorio";
    if (!skuLimpio && margenVentaNum > 0 && margenVentaNum < 20) {
      estadoFinal = "Pendiente Aprobación";
    }

    const missing = [];
    if (!nombre.trim()) missing.push("Nombre del producto");
    if (!categoria.trim()) missing.push("Categoría");
    if (!formato.trim()) missing.push("Formato");
    if (!linkReferencia.trim()) missing.push("Link de referencia");
    if (!presentacion.trim()) missing.push("Presentación");
    if (!descripcion.trim()) missing.push("Descripción");
    if (!composicion.trim()) missing.push("Composición");
    if (!usoIndicaciones.trim()) missing.push("Uso/Indicaciones");
    if (!beneficios.trim()) missing.push("Beneficios");
    if (puedeVerCosto && !(numFromCL(costo) > 0)) missing.push("Costo");
    if (!(numFromCL(precios.lista1) > 0)) missing.push("Precio Lista 1");
    if (!(numFromCL(precios.lista2) > 0)) missing.push("Precio Lista 2");

    if (missing.length) {
      const enGeneral = ["Nombre del producto", "Categoría", "Formato", "Link de referencia"].some((m) => missing.includes(m));
      const enDetalle = ["Presentación", "Descripción", "Composición", "Uso/Indicaciones", "Beneficios"].some((m) => missing.includes(m));
      const enPrecios = ["Costo", "Precio Lista 1", "Precio Lista 2"].some((m) => missing.includes(m));
      setError({
        titulo: `Falta${missing.length > 1 ? "n" : ""} ${missing.length} campo${missing.length > 1 ? "s" : ""}`,
        detalle: missing.join(" · "),
      });
      if (enGeneral) setSeccion("general");
      else if (enDetalle) setSeccion("detalle");
      else if (enPrecios) setSeccion("precios");
      return;
    }

    setGuardando(true);
    try {
      let imagenUrl = "";
      if (imagenFile) {
        try {
          imagenUrl = await subirImagen();
        } catch (e) {
          console.error("[CrearProductoModal] error upload imagen:", e);
          setError(interpretarError(e, "imagen"));
          setSeccion("general");
          setGuardando(false);
          return;
        }
      }

      const skuPermitido = puedeIngresarSKU && skuLimpio ? skuLimpio : null;
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
        link_referencia: (linkReferencia || "").trim() || null,
        peso: Number(peso) || 0,
        alto: Number(alto) || 0,
        largo: Number(largo) || 0,
        ancho: Number(ancho) || 0,
        metro_cubico: Number(metroCubico) || 0,
        lista1: numFromCL(precios.lista1),
        lista2: numFromCL(precios.lista2),
        lista3: 0,
        lista4: 0,
        creado_por: userEmail || null,
      };
      if (puedeVerCosto) payload.costo = numFromCL(costo);

      const productoCreado = await api.post("/productos", payload);
      onCreado?.(productoCreado, estadoFinal);
    } catch (e) {
      console.error("[CrearProductoModal] error guardar:", e);
      const info = interpretarError(e, "guardar");
      setError(info);
      if (info.seccion) setSeccion(info.seccion);
    } finally {
      setGuardando(false);
    }
  }

  // ====================== RENDER ======================
  const overlay = (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 12000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        animation: "cpm-fade-in .2s ease",
      }}
    >
      <style>{ESTILOS_CPM}</style>

      <div
        style={{
          width: 920,
          maxWidth: "100%",
          maxHeight: "92vh",
          background: "#fff",
          borderRadius: 20,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 40px 90px -20px rgba(15,23,42,.55), 0 16px 32px -12px rgba(37,183,189,.3)",
          animation: "cpm-pop .3s cubic-bezier(.4, 0, .2, 1)",
        }}
      >
        {/* Header con gradiente y partículas */}
        <div
          style={{
            padding: "20px 26px",
            background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 60%, ${TEAL_DEEP} 100%)`,
            color: "#fff",
            position: "relative",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {/* deco */}
          <div className="cpm-deco cpm-deco-1" />
          <div className="cpm-deco cpm-deco-2" />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              position: "relative",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 13,
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,.28), rgba(255,255,255,.12))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backdropFilter: "blur(6px)",
                  boxShadow: "inset 0 1px 2px rgba(255,255,255,.3)",
                }}
              >
                <Sparkles size={22} strokeWidth={2.2} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 17,
                    letterSpacing: "-.01em",
                  }}
                >
                  Crear nuevo producto
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.88, marginTop: 2 }}>
                  Se agregará al catálogo y se seleccionará en esta cotización
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="cpm-close-btn"
              title="Cerrar (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 18,
              flexWrap: "wrap",
              position: "relative",
            }}
          >
            {[
              { id: "general", label: "Información general", icon: Package },
              { id: "detalle", label: "Detalle", icon: FileText },
              { id: "dimensiones", label: "Dimensiones", icon: Ruler },
              { id: "precios", label: "Precios", icon: DollarSign },
            ].map((t) => {
              const I = t.icon;
              const activo = seccion === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSeccion(t.id)}
                  className="cpm-tab"
                  style={{
                    background: activo
                      ? "rgba(255,255,255,.92)"
                      : "rgba(255,255,255,.15)",
                    color: activo ? TEAL_DEEP : "#fff",
                    fontWeight: activo ? 800 : 600,
                    boxShadow: activo
                      ? "0 4px 12px -4px rgba(0,0,0,.2)"
                      : "none",
                  }}
                >
                  <I size={13} strokeWidth={2.3} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "22px 26px 16px",
            background: "linear-gradient(180deg, #fafdfd 0%, #ffffff 100%)",
          }}
        >
          {error && (
            <div className="cpm-error-banner cpm-error-banner-top">
              <div className="cpm-error-icon">
                <AlertTriangle size={18} strokeWidth={2.5} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cpm-error-titulo">{error.titulo}</div>
                {error.detalle && (
                  <div className="cpm-error-detalle">{error.detalle}</div>
                )}
              </div>
              <button
                type="button"
                className="cpm-error-close"
                onClick={() => setError(null)}
                title="Cerrar mensaje"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {rolLoading ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#64748b",
                fontSize: 13,
              }}
            >
              <Loader2 size={18} className="cpm-spin" style={{ marginRight: 6, verticalAlign: "middle" }} />
              Cargando permisos…
            </div>
          ) : (
            <>
              {/* SECCIÓN: GENERAL */}
              {seccion === "general" && (
                <div className="cpm-section">
                  <div className="cpm-grid">
                    <div className="cpm-col-2">
                      <div className="cpm-field">
                        <label>Estado</label>
                        <input
                          className={`cpm-input ${
                            esPendienteAprobacion ? "is-warn" : "is-readonly"
                          }`}
                          value={estadoMostradoBase}
                          readOnly
                        />
                        {esPendienteAprobacion && (
                          <div className="cpm-hint cpm-hint-warn">
                            <AlertTriangle size={11} />
                            Requiere aprobación de admin (margen &lt; 20%).
                          </div>
                        )}
                      </div>

                      <div className="cpm-field">
                        <label>SKU</label>
                        <input
                          className={`cpm-input ${
                            !puedeIngresarSKU ? "is-readonly" : ""
                          }`}
                          value={sku}
                          disabled={!puedeIngresarSKU}
                          onChange={(e) => setSku(e.target.value.toUpperCase())}
                          placeholder="Ej: PH00001"
                        />
                        <div className="cpm-hint">
                          {puedeIngresarSKU
                            ? "Solo admin puede asignar SKU (opcional)."
                            : "Tu rol no permite asignar SKU."}
                        </div>
                      </div>

                      <div className="cpm-field cpm-col-span-2">
                        <label>Nombre del producto *</label>
                        <input
                          className="cpm-input"
                          value={nombre}
                          onChange={(e) => setNombre(e.target.value)}
                          placeholder="Ej: Pasta dental Curaprox enzymatic"
                        />
                      </div>

                      <div className="cpm-field">
                        <label>Marca</label>
                        <input
                          className="cpm-input"
                          value={marca}
                          onChange={(e) => setMarca(e.target.value)}
                          placeholder="Curaprox, Vitis, Dentaid…"
                        />
                      </div>

                      <div className="cpm-field">
                        <label>Categoría *</label>
                        <select
                          className="cpm-input"
                          value={categoria}
                          onChange={(e) => setCategoria(e.target.value)}
                        >
                          <option value="">Seleccione…</option>
                          {CATEGORIAS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="cpm-field cpm-col-span-2">
                        <label>Formato *</label>
                        <input
                          className="cpm-input"
                          value={formato}
                          onChange={(e) => setFormato(e.target.value)}
                          placeholder="Ej: Tubo 75 ml"
                        />
                      </div>

                      <div className="cpm-field cpm-col-span-2">
                        <label>Link de referencia *</label>
                        <input
                          className="cpm-input"
                          type="url"
                          value={linkReferencia}
                          onChange={(e) => setLinkReferencia(e.target.value)}
                          placeholder="https://… de dónde tomaste la información del producto"
                        />
                        <div className="cpm-hint">
                          Obligatorio para todos los productos. Una vez guardado, solo el administrador podrá modificarlo. No aparece en la ficha PDF.
                        </div>
                      </div>
                    </div>

                    {/* Imagen */}
                    <div className="cpm-col-1">
                      <div
                        className="cpm-imagen-card"
                        style={{
                          background: imagenPreview
                            ? "#fff"
                            : `linear-gradient(135deg, ${TEAL_SOFT} 0%, #ffffff 100%)`,
                          border: imagenPreview
                            ? `2px solid ${TEAL_MID}`
                            : `2px dashed ${TEAL_MID}`,
                        }}
                      >
                        {imagenPreview ? (
                          <img
                            src={imagenPreview}
                            alt="Preview"
                            style={{
                              maxWidth: "100%",
                              maxHeight: 180,
                              objectFit: "contain",
                            }}
                          />
                        ) : (
                          <>
                            <div
                              style={{
                                width: 56,
                                height: 56,
                                borderRadius: 14,
                                background: TEAL_SOFT,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: TEAL,
                                marginBottom: 10,
                              }}
                            >
                              <ImageIcon size={26} />
                            </div>
                            <div
                              style={{
                                fontSize: 12.5,
                                color: TEAL_DEEP,
                                fontWeight: 700,
                              }}
                            >
                              Sin imagen
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                              JPG o PNG, opcional
                            </div>
                          </>
                        )}
                      </div>
                      <label className="cpm-file-btn">
                        <Upload size={13} />
                        {imagenFile ? "Cambiar imagen" : "Subir imagen"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          style={{ display: "none" }}
                          onChange={(e) =>
                            setImagenFile(e.target.files?.[0] || null)
                          }
                        />
                      </label>
                      {imagenFile && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            marginTop: 6,
                            textAlign: "center",
                            wordBreak: "break-word",
                          }}
                        >
                          {imagenFile.name}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SECCIÓN: DETALLE */}
              {seccion === "detalle" && (
                <div className="cpm-section">
                  <div className="cpm-grid-2">
                    <div className="cpm-field">
                      <label>Presentación *</label>
                      <input
                        className="cpm-input"
                        value={presentacion}
                        onChange={(e) => setPresentacion(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Descripción *</label>
                      <textarea
                        rows={3}
                        className="cpm-input cpm-textarea"
                        value={descripcion}
                        onChange={(e) => setDescripcion(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Composición *</label>
                      <textarea
                        rows={3}
                        className="cpm-input cpm-textarea"
                        value={composicion}
                        onChange={(e) => setComposicion(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Uso / Indicaciones *</label>
                      <textarea
                        rows={3}
                        className="cpm-input cpm-textarea"
                        value={usoIndicaciones}
                        onChange={(e) => setUsoIndicaciones(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Beneficios *</label>
                      <textarea
                        rows={3}
                        className="cpm-input cpm-textarea"
                        value={beneficios}
                        onChange={(e) => setBeneficios(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Modo de uso</label>
                      <textarea
                        rows={3}
                        className="cpm-input cpm-textarea"
                        value={modoUso}
                        onChange={(e) => setModoUso(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Almacenamiento</label>
                      <textarea
                        rows={2}
                        className="cpm-input cpm-textarea"
                        value={almacenamiento}
                        onChange={(e) => setAlmacenamiento(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Datos clave</label>
                      <textarea
                        rows={3}
                        className="cpm-input cpm-textarea"
                        value={datosClave}
                        onChange={(e) => setDatosClave(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SECCIÓN: DIMENSIONES */}
              {seccion === "dimensiones" && (
                <div className="cpm-section">
                  <div className="cpm-grid-3">
                    <div className="cpm-field">
                      <label>Peso (kg)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="cpm-input"
                        value={peso}
                        onChange={(e) => setPeso(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Alto (cm)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="cpm-input"
                        value={alto}
                        onChange={(e) => setAlto(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Largo (cm)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="cpm-input"
                        value={largo}
                        onChange={(e) => setLargo(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field">
                      <label>Ancho (cm)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="cpm-input"
                        value={ancho}
                        onChange={(e) => setAncho(e.target.value)}
                      />
                    </div>
                    <div className="cpm-field cpm-col-span-2">
                      <label>Centímetro cúbico (cm³)</label>
                      <input
                        readOnly
                        className="cpm-input is-readonly"
                        value={metroCubico}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SECCIÓN: PRECIOS */}
              {seccion === "precios" && (
                <div className="cpm-section">
                  {puedeVerCosto && (
                    <div className="cpm-grid-3" style={{ marginBottom: 12 }}>
                      <div className="cpm-field">
                        <label>Costo *</label>
                        <MoneyInput
                          value={costo}
                          onChange={(v) => setCosto(formatearCLDesdeString(v))}
                        />
                      </div>
                      <div />
                      {mostrarMargen && <div />}
                    </div>
                  )}

                  <ListaPreciosFila
                    label={
                      esVentasOJefe ? "Precio Venta Neto 1 *" : "Lista 1 *"
                    }
                    value={precios.lista1}
                    onChange={(v) => actualizarPrecio("lista1", v)}
                    margen={mostrarMargen ? margenLista1 : null}
                  />
                  <ListaPreciosFila
                    label={
                      esVentasOJefe ? "Precio Venta Neto 2 *" : "Lista 2 *"
                    }
                    value={precios.lista2}
                    onChange={(v) => actualizarPrecio("lista2", v)}
                    margen={mostrarMargen ? margenLista2 : null}
                  />
                  <ListaPreciosFila
                    label={
                      esVentasOJefe ? "Precio Venta Neto 3" : "Lista 3"
                    }
                    value={lista3Display}
                    readOnly
                    margen={mostrarMargen ? margenLista3 : null}
                    hint={`Calculado: Lista 2 × ${FACTOR_LISTA_3}. Usado en Licitación 9 a 24 meses.`}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="cpm-footer">
          <div className="cpm-footer-msg">
            {error ? (
              <div className="cpm-error-banner">
                <div className="cpm-error-icon">
                  <AlertTriangle size={16} strokeWidth={2.5} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cpm-error-titulo">{error.titulo}</div>
                  {error.detalle && (
                    <div className="cpm-error-detalle">{error.detalle}</div>
                  )}
                </div>
                <button
                  type="button"
                  className="cpm-error-close"
                  onClick={() => setError(null)}
                  title="Cerrar mensaje"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {esPendienteAprobacion ? (
                  <span style={{ color: "#92400e", fontWeight: 600 }}>
                    ⚠ Quedará Pendiente Aprobación (margen &lt; 20%).
                  </span>
                ) : (
                  "Los campos con * son obligatorios."
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              className="cpm-btn-cancel"
              disabled={guardando}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              className="cpm-btn-save"
              disabled={guardando || rolLoading}
            >
              {guardando ? (
                <>
                  <Loader2 size={14} className="cpm-spin" /> Guardando…
                </>
              ) : (
                <>
                  <Check size={14} strokeWidth={3} /> Crear y agregar
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function ListaPreciosFila({ label, value, onChange, readOnly, margen, hint }) {
  const neto = numFromCL(value);
  const bruto = Math.round(neto * 1.19);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: margen ? "1.6fr 1fr 1fr" : "2fr 1fr",
        gap: 10,
        marginBottom: 10,
        alignItems: "end",
      }}
    >
      <div className="cpm-field">
        <label>{label}</label>
        <MoneyInput value={value} onChange={onChange} readOnly={readOnly} />
        {hint && <div className="cpm-hint">{hint}</div>}
      </div>
      <div className="cpm-field">
        <label>Bruto (IVA)</label>
        <MoneyInput value={bruto > 0 ? bruto : ""} readOnly />
      </div>
      {margen && (
        <div className="cpm-field">
          <label>Margen</label>
          <input className="cpm-input is-readonly" readOnly value={margen} />
        </div>
      )}
    </div>
  );
}

const ESTILOS_CPM = `
@keyframes cpm-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cpm-pop {
  from { opacity: 0; transform: translateY(20px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
@keyframes cpm-spin { to { transform: rotate(360deg); } }
.cpm-spin { animation: cpm-spin 1s linear infinite; }

@keyframes cpm-deco-float-1 {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(8px, -10px); }
}
@keyframes cpm-deco-float-2 {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-12px, 8px); }
}
.cpm-deco {
  position: absolute; border-radius: 50%; pointer-events: none;
}
.cpm-deco-1 {
  top: -60px; right: -40px; width: 200px; height: 200px;
  background: radial-gradient(circle, rgba(255,255,255,.22), transparent 70%);
  animation: cpm-deco-float-1 6s ease-in-out infinite;
}
.cpm-deco-2 {
  bottom: -50px; left: -50px; width: 180px; height: 180px;
  background: radial-gradient(circle, rgba(255,255,255,.13), transparent 70%);
  animation: cpm-deco-float-2 7s ease-in-out infinite;
}

.cpm-close-btn {
  background: rgba(255,255,255,.18); border: none; color: #fff;
  cursor: pointer; padding: 8px; border-radius: 9px;
  display: inline-flex; transition: background .15s, transform .15s;
}
.cpm-close-btn:hover { background: rgba(255,255,255,.32); transform: scale(1.05); }

.cpm-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 999px;
  border: none; cursor: pointer;
  font-size: 12px; letter-spacing: .02em;
  transition: background .15s, color .15s, transform .12s;
}
.cpm-tab:hover { transform: translateY(-1px); }

.cpm-section {
  animation: cpm-section-in .25s cubic-bezier(.4, 0, .2, 1);
}
@keyframes cpm-section-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}

.cpm-grid {
  display: grid; grid-template-columns: 2fr 1fr; gap: 18px;
}
.cpm-grid-2 {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
}
.cpm-grid-3 {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px;
}
.cpm-col-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-content: start; }
.cpm-col-span-2 { grid-column: span 2; }
.cpm-col-1 { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }

.cpm-field { display: flex; flex-direction: column; gap: 4px; }
.cpm-field label {
  font-size: 11.5px; color: #475569; font-weight: 700;
  text-transform: uppercase; letter-spacing: .04em;
}

.cpm-input {
  width: 100%; height: 38px; padding: 0 12px;
  border-radius: 9px; border: 1.5px solid #e2e8f0;
  font-size: 13px; outline: none; background: #fff;
  box-sizing: border-box;
  transition: border-color .15s, box-shadow .15s, background .15s;
  font-family: inherit;
}
.cpm-textarea { height: auto; padding: 10px 12px; min-height: 70px; resize: vertical; }
.cpm-input:focus { border-color: ${TEAL}; box-shadow: 0 0 0 3px rgba(37,183,189,.18); }
.cpm-input.is-readonly { background: #f1f5f9; color: #475569; }
.cpm-input.is-warn { background: #fffbeb; border-color: #fde68a; color: #92400e; }
.cpm-input:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }

.cpm-money-prefix {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: ${TEAL}; font-weight: 800; font-size: 13px; pointer-events: none;
}
.cpm-money-input { padding-left: 26px !important; }

.cpm-hint {
  font-size: 10.5px; color: #94a3b8; margin-top: 2px;
  display: inline-flex; align-items: center; gap: 4px;
}
.cpm-hint-warn { color: #d97706; font-weight: 600; }

.cpm-imagen-card {
  border-radius: 14px;
  padding: 18px; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 200px;
  transition: border-color .15s, background .15s;
}

.cpm-file-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  margin-top: 10px; height: 36px; padding: 0 14px;
  border-radius: 10px; cursor: pointer;
  background: linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%);
  color: #fff; font-size: 12.5px; font-weight: 700;
  border: none;
  box-shadow: 0 3px 8px -2px rgba(37,183,189,.45);
  transition: transform .15s, box-shadow .15s;
}
.cpm-file-btn:hover { transform: translateY(-1px); box-shadow: 0 5px 12px -3px rgba(37,183,189,.6); }

.cpm-footer {
  padding: 14px 22px;
  border-top: 1px solid #eef2f5;
  background: linear-gradient(180deg, #ffffff 0%, #f4fafb 100%);
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  flex-shrink: 0;
}
.cpm-footer-msg { flex: 1; min-width: 0; }

/* Banner de error — versión inline (footer) y prominente (top) */
.cpm-error-banner {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: linear-gradient(180deg, #fef2f2 0%, #ffe4e6 100%);
  border: 1px solid #fecaca;
  box-shadow: 0 2px 8px -2px rgba(220,38,38,.15);
  animation: cpm-error-in .25s cubic-bezier(.4, 0, .2, 1);
}
.cpm-error-banner-top {
  margin-bottom: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  box-shadow: 0 4px 14px -3px rgba(220,38,38,.22);
}
@keyframes cpm-error-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: none; }
}
.cpm-error-icon {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px -1px rgba(220,38,38,.4);
}
.cpm-error-titulo {
  font-size: 13.5px; font-weight: 800; color: #991b1b;
  letter-spacing: -.005em;
}
.cpm-error-detalle {
  font-size: 12px; color: #7f1d1d; margin-top: 2px;
  line-height: 1.4; word-break: break-word;
}
.cpm-error-close {
  flex-shrink: 0;
  background: transparent; border: none; cursor: pointer;
  color: #b91c1c; opacity: .6;
  padding: 4px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: opacity .15s, background .15s;
}
.cpm-error-close:hover { opacity: 1; background: rgba(220,38,38,.1); }

.cpm-btn-cancel {
  height: 38px; padding: 0 16px; border-radius: 9px;
  background: #fff; color: #475569;
  border: 1.5px solid #e2e8f0;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.cpm-btn-cancel:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.cpm-btn-cancel:disabled { opacity: .5; cursor: not-allowed; }

.cpm-btn-save {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 18px; border-radius: 9px;
  background: linear-gradient(135deg, ${TEAL} 0%, ${TEAL_OSC} 100%);
  color: #fff; font-size: 13px; font-weight: 800; cursor: pointer;
  border: none;
  letter-spacing: .02em;
  box-shadow: 0 5px 14px -4px rgba(37,183,189,.55), 0 2px 4px rgba(15,23,42,.1);
  transition: transform .15s, box-shadow .15s;
}
.cpm-btn-save:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px -4px rgba(37,183,189,.7), 0 2px 4px rgba(15,23,42,.1);
}
.cpm-btn-save:disabled { opacity: .65; cursor: not-allowed; transform: none; }

@media (max-width: 640px) {
  .cpm-grid, .cpm-grid-2, .cpm-grid-3 { grid-template-columns: 1fr !important; }
  .cpm-col-2 { grid-template-columns: 1fr !important; }
  .cpm-col-span-2 { grid-column: span 1 !important; }
}
`;
