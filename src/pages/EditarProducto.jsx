// EditarProducto.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { useParams, useNavigate } from "react-router-dom";
import Toast from "../components/Toast";
import Select from "react-select";
import { pdf } from "@react-pdf/renderer";
import { FichaTecnicaDocument } from "../components/FichaTecnica";
import { FACTOR_LISTA_3, calcularLista3 } from "../lib/listas";
import EquivalentesProducto from "../components/EquivalentesProducto";

/* ============================================================
   BUSCADOR MEJORADO (igual que licitaciones)
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

// Formato monetario CLP — agrupa miles con punto, sin decimales.
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

// Input monetario CLP con "$" como prefijo. Comparte estética con el resto
// de inputs del form (class "input" del design system).
function MoneyInput({ value, onChange, readOnly = false, placeholder = "" }) {
  const display = typeof value === "number"
    ? (value > 0 ? value.toLocaleString("es-CL") : "")
    : (value ?? "");
  return (
    <div style={{ position: "relative" }}>
      <span
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-muted)",
          fontSize: 13.5,
          pointerEvents: "none",
        }}
      >
        $
      </span>
      <input
        type="text"
        inputMode="numeric"
        readOnly={readOnly}
        placeholder={placeholder}
        className="input"
        style={{ paddingLeft: 22, background: readOnly ? "var(--bg)" : undefined }}
        value={display}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}

/* ============================================================
   ESTILOS react-select — design system
============================================================ */
const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "36px",
    height: "36px",
    borderRadius: "var(--radius)",
    borderColor: state.isFocused ? "var(--primary)" : "var(--border-strong)",
    backgroundColor: "var(--surface)",
    boxShadow: state.isFocused ? "0 0 0 2px rgba(40,174,177,.15)" : "none",
    fontSize: "13.5px",
    ":hover": { borderColor: "var(--primary)" },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 10px" }),
  indicatorsContainer: (base) => ({ ...base, height: "36px" }),
  indicatorSeparator: () => ({ display: "none" }),
  menu: (base) => ({ ...base, zIndex: 50, fontSize: "13.5px" }),
  menuPortal: (base) => ({ ...base, zIndex: 99999 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? "var(--primary-light)" : "white",
    color: state.isFocused ? "var(--primary-dark)" : "var(--text)",
    cursor: "pointer",
  }),
};

export default function EditarProducto() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const [rol, setRol] = useState(null);

  // ✅ guardamos el SKU original para evitar "borrados" accidentales
  const [skuOriginal, setSkuOriginal] = useState("");

  const [producto, setProducto] = useState({
    sku: "",
    estado: "",
    nombre: "",
    marca: "",
    sku_marca: "",
    equivalente_1: "",
    equivalente_2: "",
    equivalente_3: "",
    categoria: "",
    formato: "",
    imagen_url: "",
    presentacion: "",
    descripcion: "",
    composicion: "",
    uso_indicaciones: "",
    beneficios: "",
    modo_uso: "",
    almacenamiento: "",
    datos_clave: "",
    peso: 0,
    alto: 0,
    largo: 0,
    ancho: 0,
    metro_cubico: 0,
    costo: 0,
    lista1: 0,
    lista2: 0,
    lista3: 0,
    link_referencia: "",
    creado_por: "",
    created_at: "",
  });
  const [imagenFile, setImagenFile] = useState(null);
  const [imagenPreview, setImagenPreview] = useState("");
  const [imagenDisplayUrl, setImagenDisplayUrl] = useState("");
  const [generandoFicha, setGenerandoFicha] = useState(false);
  const [creadoPorNombre, setCreadoPorNombre] = useState("");

  /* ==========================================================
     Rol
  ========================================================== */
  const rolNorm = useMemo(() => {
    const r = (rol ?? "").toString().trim().toLowerCase();
    if (!r) return "";
    if (r === "admin" || r === "administrador") return "admin";
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

  const esAdmin = useMemo(
    () => rolNorm === "admin" || rolNorm === "administrador",
    [rolNorm]
  );

  const metroCubico = useMemo(() => {
    const a = Number(producto.alto) || 0;
    const l = Number(producto.largo) || 0;
    const an = Number(producto.ancho) || 0;
    if (!a || !l || !an) return "";
    return (a * l * an).toFixed(3);
  }, [producto.alto, producto.largo, producto.ancho]);

  const margenVenta = useMemo(() => {
    const precioVenta = numFromCL(producto.lista1);
    const costoNum = numFromCL(producto.costo);
    if (precioVenta <= 0) return "0.00%";
    const margen = ((precioVenta - costoNum) / precioVenta) * 100;
    return `${margen.toFixed(2)}%`;
  }, [producto.lista1, producto.costo]);

  const margenVentaNum = useMemo(() => {
    const precioVenta = numFromCL(producto.lista1);
    const costoNum = numFromCL(producto.costo);
    if (precioVenta <= 0) return 0;
    return ((precioVenta - costoNum) / precioVenta) * 100;
  }, [producto.lista1, producto.costo]);

  const margenVentaLista2 = useMemo(() => {
    const precioVenta = numFromCL(producto.lista2);
    const costoNum = numFromCL(producto.costo);
    if (precioVenta <= 0) return "0.00%";
    const margen = ((precioVenta - costoNum) / precioVenta) * 100;
    return `${margen.toFixed(2)}%`;
  }, [producto.lista2, producto.costo]);

  // Lista 3 siempre calculada (Lista 2 × factor), no editable.
  const lista3Calculada = useMemo(() => {
    return calcularLista3(numFromCL(producto.lista2));
  }, [producto.lista2]);

  const lista3Display = useMemo(() => {
    return lista3Calculada > 0 ? lista3Calculada.toLocaleString("es-CL") : "";
  }, [lista3Calculada]);

  const margenVentaLista3 = useMemo(() => {
    const precioVenta = lista3Calculada;
    const costoNum = numFromCL(producto.costo);
    if (precioVenta <= 0) return "0.00%";
    const margen = ((precioVenta - costoNum) / precioVenta) * 100;
    return `${margen.toFixed(2)}%`;
  }, [lista3Calculada, producto.costo]);

  // 1) ✅ ventas NO debe editar productos
    const esVentasOJefe = useMemo(
    () => rolNorm === "ventas" || rolNorm === "jefe_ventas",
    [rolNorm]
  );

  const esProductoTransitorio = useMemo(() => {
    const estado = (producto?.estado ?? "").toString().trim().toLowerCase();
    if (estado) return estado === "transitorio" || estado === "transsitorio";
    const sku = (producto?.sku ?? "").toString().trim();
    return sku === "";
  }, [producto]);

  const puedeEditarProducto = useMemo(() => {
    if (!rolNorm) return false;
    // Ventas: puede acceder siempre. Si el producto NO es transitorio, solo
    // podrá editar la sección "Detalle del Producto" (controlado por
    // esVentasNoTransitorio más abajo). Si es transitorio, edita todo.
    return true;
  }, [rolNorm]);

  // Ventas mirando un producto ya activo: solo edita "Detalle del Producto";
  // el resto de secciones quedan readonly u ocultas.
  const esVentasNoTransitorio = useMemo(
    () => rolNorm === "ventas" && !esProductoTransitorio,
    [rolNorm, esProductoTransitorio]
  );

  const estadoMostrado =
    producto.estado ||
    ((producto.sku ?? "").toString().trim() ? "Activo" : "Transitorio");
  const esPendienteAprobacion = estadoMostrado === "Pendiente Aprobación";
  const mostrarMargen =
    !esVentasOJefe || esProductoTransitorio || esPendienteAprobacion;

  // 2) ✅ admin y jefe_ventas pueden editar SKU
  const puedeEditarSKU = esAdmin || rolNorm === "jefe_ventas";

  useEffect(() => {
    async function obtenerRol() {
      try {
        const perfil = await api.get("/auth/profile");
        setRol(perfil?.rol ?? null);
      } catch {
        setRol(null);
      }
    }

    obtenerRol();
  }, []);

  /* ============================================================
     Cargar datos producto
  ============================================================ */
  useEffect(() => {
    async function cargar() {
      setLoading(true);

      let data;
      try {
        data = await api.get(`/productos/${id}`);
      } catch {
        setToast({ type: "error", message: "Error cargando producto" });
        setLoading(false);
        return;
      }

      const skuDb = (data.sku ?? "").toString().trim();
      const estadoDb = (data.estado ?? (skuDb ? "Activo" : "Transitorio"))
        .toString()
        .trim();

      setSkuOriginal(skuDb);

      setProducto({
        sku: skuDb,
        estado: estadoDb,
        nombre: data.nombre ?? "",
        marca: data.marca ?? "",
        sku_marca: data.sku_marca ?? "",
        equivalente_1: data.equivalente_1 ?? "",
        equivalente_2: data.equivalente_2 ?? "",
        equivalente_3: data.equivalente_3 ?? "",
        categoria: data.categoria ?? "",
        formato: data.formato ?? "",
        imagen_url: data.imagen_url ?? "",
        presentacion: data.presentacion ?? "",
        descripcion: data.descripcion ?? "",
        composicion: data.composicion ?? "",
        uso_indicaciones: data.uso_indicaciones ?? "",
        beneficios: data.beneficios ?? "",
        modo_uso: data.modo_uso ?? "",
        almacenamiento: data.almacenamiento ?? "",
        datos_clave: data.datos_clave ?? "",
        peso: data.peso ?? 0,
        alto: data.alto ?? 0,
        largo: data.largo ?? 0,
        ancho: data.ancho ?? 0,
        metro_cubico: data.metro_cubico ?? 0,
        // Guardamos los precios como string formateado para mostrarlos con
        // separador de miles directamente en el input.
        costo: formatearCLDesdeString(String(data.costo ?? "")),
        lista1: formatearCLDesdeString(String(data.lista1 ?? "")),
        lista2: formatearCLDesdeString(String(data.lista2 ?? "")),
        lista3: 0,
        link_referencia: data.link_referencia ?? "",
        creado_por: data.creado_por ?? "",
        created_at: data.created_at ?? "",
      });

      setLoading(false);
    }

    cargar();
  }, [id]);

  // Resuelve el nombre del creador a partir de su email (creado_por).
  useEffect(() => {
    const email = (producto.creado_por || "").trim().toLowerCase();
    if (!email) {
      setCreadoPorNombre("");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const perfiles = await api.post("/usuarios/profiles/by-emails", { emails: [email] });
        if (!alive) return;
        const p = (perfiles || []).find(
          (x) => (x?.email || "").trim().toLowerCase() === email,
        );
        setCreadoPorNombre((p?.nombre || "").trim());
      } catch {
        if (alive) setCreadoPorNombre("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [producto.creado_por]);

  useEffect(() => {
    if (!imagenFile) {
      setImagenPreview("");
      return;
    }

    const url = URL.createObjectURL(imagenFile);
    setImagenPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imagenFile]);

  function sanitizeFilePath(value) {
    return (value ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 _.\\-]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }
  function normalizarNombreArchivo(value) {
    return (value ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "")
      .toLowerCase();
  }

  async function urlToDataUrl(url) {
    if (!url) return "";
    if (url.startsWith("data:")) return url;
    if (url.includes("/storage/v1/object/")) {
      const path = extractStoragePathFromUrl(url, "product-images");
      return (await dataUrlFromStoragePath("product-images", path)) || "";
    }
    try {
      const res = await fetch(url);
      if (!res.ok) return "";
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || "");
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    } catch {
      return "";
    }
  }

  async function dataUrlFromStoragePath(bucket, path) {
    if (!bucket || !path) return "";
    try {
      const signedData = await api.get(`/licitaciones/storage/signed-url?bucket=${bucket}&path=${encodeURIComponent(path)}`);
      if (!signedData?.signedUrl) return "";
      const res = await fetch(signedData.signedUrl);
      if (!res.ok) return "";
      const data = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || "");
        reader.onerror = () => resolve("");
        reader.readAsDataURL(data);
      });
    } catch {
      return "";
    }
  }

  function extractStoragePathFromUrl(url, bucket) {
    if (!url || !bucket) return "";
    try {
      const marker = `/${bucket}/`;
      const idx = url.indexOf(marker);
      if (idx === -1) return "";
      return url.slice(idx + marker.length);
    } catch {
      return "";
    }
  }

  async function blobToBase64(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  useEffect(() => {
    let alive = true;

    async function resolverUrl() {
      if (!producto.imagen_url || imagenFile) {
        if (alive) setImagenDisplayUrl("");
        return;
      }

      const raw = producto.imagen_url;
      if (raw.startsWith("http")) {
        if (alive) setImagenDisplayUrl(raw);
        return;
      }

      try {
        const signedData = await api.get(`/licitaciones/storage/signed-url?bucket=product-images&path=${encodeURIComponent(raw)}`);
        if (!alive) return;
        setImagenDisplayUrl(signedData?.signedUrl || "");
      } catch (error) {
        if (!alive) return;
        // La ruta guardada apunta a un archivo que ya no existe en el storage
        // (imagen borrada o nunca subida): se muestra sin imagen, no es fatal.
        console.warn(`Imagen del producto no encontrada en storage (${raw}):`, error?.message || error);
        setImagenDisplayUrl("");
      }
    }

    resolverUrl();
    return () => {
      alive = false;
    };
  }, [producto.imagen_url, imagenFile]);

  async function subirImagenProducto() {
    if (!imagenFile) return "";

    const skuBase = (producto.sku || skuOriginal || "").toString().trim().toUpperCase();
    const formData = new FormData();
    formData.append("file", imagenFile);
    const res = await api.postForm(`/productos/upload-image?sku=${encodeURIComponent(skuBase)}`, formData);
    return res.path;
  }

  async function resolverImagenFicha() {
    if (imagenPreview) return imagenPreview;
    if (imagenDisplayUrl) return imagenDisplayUrl;

    const raw = producto.imagen_url || "";
    if (!raw) return "";
    if (raw.startsWith("http")) return raw;

    const dataUrl = await dataUrlFromStoragePath("product-images", raw);
    if (!dataUrl) return "";
    return dataUrl;
  }
  async function guardarCambios() {
    setToast(null);

    if (!puedeEditarProducto) {
      setToast({
        type: "error",
        message: "Tu rol no permite editar productos.",
      });
      return;
    }

    if (!producto.nombre || !producto.categoria || !producto.formato) {
      setToast({
        type: "error",
        message: "Debes completar Nombre, Categoria y Formato.",
      });
      return;
    }

    const puedeVerCosto =
      esAdmin || (esVentasOJefe && (esProductoTransitorio || esPendienteAprobacion));

    const missing = [];
    if (puedeVerCosto && !(numFromCL(producto.costo) > 0)) missing.push("Costo");
    if (!(numFromCL(producto.lista1) > 0)) {
      missing.push(esVentasOJefe ? "Precio Venta Neto 1" : "Listado de Precios 1");
    }
    if (!(numFromCL(producto.lista2) > 0)) {
      missing.push(esVentasOJefe ? "Precio Venta Neto 2" : "Listado de Precios 2");
    }

    if (missing.length) {
      setToast({
        type: "error",
        message: `Debes completar: ${missing.join(", ")}.`,
      });
      return;
    }

    let skuFinal = skuOriginal;

    if (puedeEditarSKU) {
      const skuLimpio = (producto.sku ?? "").toString().trim().toUpperCase();
      skuFinal = skuLimpio || skuOriginal;
    }

    skuFinal = (skuFinal ?? "").toString().trim();
    skuFinal = skuFinal.length ? skuFinal : null;

    let estadoFinal = skuFinal ? "Activo" : "Transitorio";
    if (producto.estado === "Pendiente Aprobación" && !esAdmin) {
      estadoFinal = "Pendiente Aprobación";
    }

    let imagenUrl = producto.imagen_url || "";
    if (imagenFile) {
      try {
        imagenUrl = await subirImagenProducto();
      } catch (e) {
        console.error(e);
        setToast({ type: "error", message: "Error subiendo la imagen del producto." });
        return;
      }
    }

    const payload = {
      sku: skuFinal,
      estado: estadoFinal,
      nombre: producto.nombre,
      marca: producto.marca,
      sku_marca: (producto.sku_marca || "").trim() || null,
      categoria: producto.categoria,
      formato: producto.formato,
      imagen_url: imagenUrl || null,
      presentacion: producto.presentacion,
      descripcion: producto.descripcion,
      composicion: producto.composicion,
      uso_indicaciones: producto.uso_indicaciones,
      beneficios: producto.beneficios,
      modo_uso: producto.modo_uso,
      almacenamiento: producto.almacenamiento,
      datos_clave: producto.datos_clave,
      peso: Number(producto.peso) || 0,
      alto: Number(producto.alto) || 0,
      largo: Number(producto.largo) || 0,
      ancho: Number(producto.ancho) || 0,
      metro_cubico: Number(metroCubico) || 0,
      lista1: numFromCL(producto.lista1),
      lista2: numFromCL(producto.lista2),
      // Lista 3 siempre derivada (Lista 2 × 1.08); guardamos 0 y el frontend
      // hace fallback al leer.
      lista3: 0,
      equivalente_1: (producto.equivalente_1 || "").trim() || null,
      equivalente_2: (producto.equivalente_2 || "").trim() || null,
      equivalente_3: (producto.equivalente_3 || "").trim() || null,
    };

    if (esAdmin || (esVentasOJefe && (esProductoTransitorio || esPendienteAprobacion))) {
      payload.costo = numFromCL(producto.costo);
    }

    // El link de referencia solo lo puede modificar el administrador.
    if (esAdmin) {
      payload.link_referencia = (producto.link_referencia || "").trim() || null;
    }

    try {
      await api.put(`/productos/${id}`, payload);
    } catch (error) {
      console.error(error);
      setToast({ type: "error", message: "Error al guardar cambios" });
      return;
    }

    setSkuOriginal(skuFinal ?? "");
    setProducto((prev) => ({
      ...prev,
      sku: skuFinal ?? "",
      estado: estadoFinal,
      imagen_url: imagenUrl || "",
    }));

    setToast({ type: "success", message: "Producto actualizado" });
  }

  async function aprobarProducto() {
    if (!esAdmin) return;
    if (guardando) return;
    if (producto.estado !== "Pendiente Aprobación") return;

    setToast(null);
    setGuardando(true);

    try {
      await api.put(`/productos/${id}`, { estado: "Transitorio" });

      setProducto((prev) => ({ ...prev, estado: "Transitorio" }));
      setToast({ type: "success", message: "Producto aprobado." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "No se pudo aprobar el producto." });
    } finally {
      setGuardando(false);
    }
  }

    
  async function cargarProductoActualizado() {
    const data = await api.get(`/productos/${id}`);
    if (!data) throw new Error("No se pudo obtener el producto actualizado");

    return {
      sku: (data.sku ?? "").toString().trim(),
      nombre: data.nombre ?? "",
      marca: data.marca ?? "",
      sku_marca: data.sku_marca ?? "",
      categoria: data.categoria ?? "",
      formato: data.formato ?? "",
      imagen_url: data.imagen_url ?? "",
      presentacion: data.presentacion ?? "",
      descripcion: data.descripcion ?? "",
      composicion: data.composicion ?? "",
      uso_indicaciones: data.uso_indicaciones ?? "",
      beneficios: data.beneficios ?? "",
      modo_uso: data.modo_uso ?? "",
      almacenamiento: data.almacenamiento ?? "",
      datos_clave: data.datos_clave ?? "",
      peso: data.peso ?? 0,
      alto: data.alto ?? 0,
      largo: data.largo ?? 0,
      ancho: data.ancho ?? 0,
      metro_cubico: data.metro_cubico ?? 0,
    };
  }

  async function generarFichaTecnica() {
    if (generandoFicha) return;
    setGenerandoFicha(true);
    setToast({ type: "info", message: "Generando ficha tecnica..." });

    const logoUrl = `${window.location.origin}/logo_superior_ficha.png`;
    const marcaAguaUrl = `${window.location.origin}/logo_marca_agua.png`;

    const productoFicha = await cargarProductoActualizado();

try {
      const [logoData, marcaAguaData] = await Promise.all([
        urlToDataUrl(logoUrl),
        urlToDataUrl(marcaAguaUrl),
      ]);
      const productoImg = await resolverImagenFicha();
      const productoImgData = await urlToDataUrl(productoImg);

      const logoSrc      = logoData     || null;
      const marcaAguaSrc = marcaAguaData || null;
      const productoSrc  = productoImgData || productoImg || null;

      const pdfBlob = await pdf(
        <FichaTecnicaDocument
          producto={productoFicha}
          logoSrc={logoSrc}
          marcaAguaSrc={marcaAguaSrc}
          productoSrc={productoSrc}
        />
      ).toBlob();

      const sku = (productoFicha.sku || "").toString().trim();
      const safeSku = (sku || "producto")
        .replace(/[\\/]+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      const downloadName = `${safeSku}.pdf`;

      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      try {
        const pdfBase64 = await blobToBase64(pdfBlob);
        const uploadName = sanitizeFilePath(downloadName);
        const { error: fnError, data: fnData } = await supabase.functions.invoke(
          "upload_ficha",
          {
            body: {
              filePath: uploadName,
              pdfBase64,
            },
          }
        );
        if (fnError) {
          console.error("Error subiendo ficha (Edge Function):", fnError);
        } else if (fnData?.error) {
          console.error("Error subiendo ficha (Edge Function):", fnData.error);
        }
      } catch (uploadErr) {
        console.error("Error subiendo ficha (Edge Function):", uploadErr);
      }

      setToast({
        type: "success",
        message: "Ficha tecnica generada.",
      });
    } catch (e) {
      console.error(e);
      setToast({
        type: "error",
        message: "No se pudo generar la ficha tecnica.",
      });
    } finally {
      if (container) document.body.removeChild(container);
      setGenerandoFicha(false);
    }
  }




















  if (loading) return <div className="page"><p style={{color:"var(--text-muted)"}}>Cargando…</p></div>;

  if (!puedeEditarProducto) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body">
            <p style={{fontWeight:600, marginBottom:6}}>Acceso restringido</p>
            <p style={{color:"var(--text-soft)", fontSize:13.5}}>
              {rolNorm === "ventas"
                ? "El rol ventas solo puede editar productos en estado Transitorio."
                : "Tu rol no permite editar productos."}
            </p>
            <p style={{color:"var(--text-muted)", fontSize:12, marginTop:4}}>
              Rol detectado: <b>{rol ?? "sin rol"}</b>
            </p>
            <div className="btn-row" style={{marginTop:16}}>
              <button type="button" onClick={() => navigate("/productos")} className="btn btn-ghost">← Volver</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {/* HEADER */}
      <div className="page-header">
        <h1 className="page-title">Editar Producto</h1>
        <div className="btn-row">
          {esAdmin && producto.estado === "Pendiente Aprobación" && (
            <button type="button" onClick={aprobarProducto} className="btn btn-primary" disabled={guardando}>
              {guardando ? "Aprobando…" : "Aprobar Producto"}
            </button>
          )}
          <button type="button" onClick={() => navigate("/productos")} className="btn btn-ghost">← Volver</button>
        </div>
      </div>

      {/* INFORMACIÓN GENERAL */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Información General</h3>
        </div>
        <div className="surface-body">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Estado</label>
                  <input
                    className="input"
                    style={esPendienteAprobacion ? {borderColor:"#f59e0b", background:"#fffbeb", color:"#92400e"} : {background:"var(--bg)"}}
                    value={estadoMostrado}
                    readOnly
                  />
                  {esPendienteAprobacion && (
                    <p style={{fontSize:12, color:"#b45309", marginTop:4}}>Requiere aprobación de admin (margen &lt; 15%).</p>
                  )}
                </div>

                <div>
                  <label className="label">SKU</label>
                  <input
                    className="input"
                    value={producto.sku}
                    disabled={!puedeEditarSKU}
                    onChange={(e) => setProducto((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }))}
                    placeholder="Ej: PH00001"
                  />
                  {!puedeEditarSKU && (
                    <p style={{fontSize:12, color:"var(--text-muted)", marginTop:4}}>Solo admin o jefe de ventas puede editar el SKU.</p>
                  )}
                </div>

                <div>
                  <label className="label">Nombre del Producto</label>
                  <input className="input" value={producto.nombre}
                    disabled={esVentasNoTransitorio}
                    onChange={(e) => setProducto((prev) => ({ ...prev, nombre: e.target.value }))} />
                </div>

                <div>
                  <label className="label">Marca</label>
                  <input className="input" value={producto.marca}
                    disabled={esVentasNoTransitorio}
                    onChange={(e) => setProducto((prev) => ({ ...prev, marca: e.target.value }))} />
                </div>

                <div>
                  <label className="label">SKU Marca</label>
                  <input className="input" value={producto.sku_marca}
                    disabled={esVentasNoTransitorio}
                    placeholder="Código del fabricante (opcional)"
                    onChange={(e) => setProducto((prev) => ({ ...prev, sku_marca: e.target.value }))} />
                </div>

                <div className="md:col-span-2">
                  <EquivalentesProducto
                    value={[producto.equivalente_1, producto.equivalente_2, producto.equivalente_3]}
                    onChange={(eqs) => setProducto((prev) => ({ ...prev, equivalente_1: eqs[0] || "", equivalente_2: eqs[1] || "", equivalente_3: eqs[2] || "" }))}
                    excludeSku={producto.sku}
                  />
                </div>

                <div>
                  <label className="label">Categoría</label>
                  <Select
                    options={opcionesCategoria}
                    styles={selectStyles}
                    placeholder="Seleccione categoría…"
                    menuPortalTarget={document.body}
                    isSearchable
                    isDisabled={esVentasNoTransitorio}
                    filterOption={filtrarPorTerminos}
                    value={opcionesCategoria.find((o) => o.value === producto.categoria) || null}
                    onChange={(op) => setProducto((prev) => ({ ...prev, categoria: op ? op.value : "" }))}
                  />
                </div>

                <div>
                  <label className="label">Formato</label>
                  <input className="input" value={producto.formato}
                    disabled={esVentasNoTransitorio}
                    onChange={(e) => setProducto((prev) => ({ ...prev, formato: e.target.value }))} />
                </div>

                <div>
                  <label className="label">Creado por</label>
                  <input className="input" style={{ background: "var(--bg)" }} readOnly
                    value={creadoPorNombre || producto.creado_por || "—"} />
                </div>

                <div>
                  <label className="label">Fecha de creación</label>
                  <input className="input" style={{ background: "var(--bg)" }} readOnly
                    value={producto.created_at ? new Date(producto.created_at).toLocaleString("es-CL") : "—"} />
                </div>

                <div className="md:col-span-2">
                  <label className="label">Link de referencia</label>
                  <input
                    className="input"
                    type="url"
                    value={producto.link_referencia || ""}
                    disabled={!esAdmin}
                    style={!esAdmin ? { background: "var(--bg)" } : undefined}
                    onChange={(e) => setProducto((prev) => ({ ...prev, link_referencia: e.target.value }))}
                    placeholder="https://…"
                  />
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                    {esAdmin
                      ? "Solo el administrador puede modificar este link. No aparece en la ficha PDF."
                      : "Link de referencia (solo el administrador puede modificarlo). No aparece en la ficha PDF."}
                  </p>
                </div>
              </div>
            </div>

            {/* Imagen */}
            <div className="lg:col-span-1">
              <div className="surface" style={{margin:0}}>
                <div className="surface-header">
                  <h3 className="surface-title">Imagen del Producto</h3>
                </div>
                <div className="surface-body">
                  {(imagenPreview || imagenDisplayUrl) ? (
                    <div style={{height:180, borderRadius:"var(--radius)", border:"1px solid var(--border)", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", background:"#fff"}}>
                      <img src={imagenPreview || imagenDisplayUrl} alt="Preview" style={{maxHeight:"100%", maxWidth:"100%", objectFit:"contain"}} />
                    </div>
                  ) : (
                    <div style={{height:180, borderRadius:"var(--radius)", border:"1px dashed var(--border-strong)", background:"var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text-muted)", fontSize:13.5}}>
                      Sin imagen
                    </div>
                  )}
                  <div style={{marginTop:12}}>
                    <p style={{fontSize:11, color:"var(--text-muted)", marginBottom:6}}>JPG o PNG</p>
                    <div className="flex items-center gap-2">
                      <label className="btn btn-secondary btn-sm" style={{cursor:"pointer"}}>
                        Seleccionar imagen
                        <input type="file" accept="image/png,image/jpeg" style={{display:"none"}}
                          onChange={(e) => setImagenFile(e.target.files?.[0] || null)} />
                      </label>
                      <span style={{fontSize:12, color:"var(--text-muted)"}}>{imagenFile?.name || "Sin archivo"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DETALLE DEL PRODUCTO */}
      <div className="surface">
        <div className="surface-header">
          <h3 className="surface-title">Detalle del Producto</h3>
        </div>
        <div className="surface-body">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Presentación</label>
              <input className="input" value={producto.presentacion}
                onChange={(e) => setProducto((prev) => ({ ...prev, presentacion: e.target.value }))} />
            </div>
            <div>
              <label className="label">Descripción</label>
              <textarea rows={3} className="input" value={producto.descripcion}
                onChange={(e) => setProducto((prev) => ({ ...prev, descripcion: e.target.value }))} />
            </div>
            <div>
              <label className="label">Composición</label>
              <textarea rows={3} className="input" value={producto.composicion}
                onChange={(e) => setProducto((prev) => ({ ...prev, composicion: e.target.value }))} />
            </div>
            <div>
              <label className="label">Uso / Indicaciones</label>
              <textarea rows={3} className="input" value={producto.uso_indicaciones}
                onChange={(e) => setProducto((prev) => ({ ...prev, uso_indicaciones: e.target.value }))} />
            </div>
            <div>
              <label className="label">Beneficios</label>
              <textarea rows={3} className="input" value={producto.beneficios}
                onChange={(e) => setProducto((prev) => ({ ...prev, beneficios: e.target.value }))} />
            </div>
            <div>
              <label className="label">Modo de uso</label>
              <textarea rows={3} className="input" value={producto.modo_uso}
                onChange={(e) => setProducto((prev) => ({ ...prev, modo_uso: e.target.value }))} />
            </div>
            <div>
              <label className="label">Almacenamiento</label>
              <textarea rows={2} className="input" value={producto.almacenamiento}
                onChange={(e) => setProducto((prev) => ({ ...prev, almacenamiento: e.target.value }))} />
            </div>
            <div>
              <label className="label">Datos Clave</label>
              <textarea rows={3} className="input" value={producto.datos_clave}
                onChange={(e) => setProducto((prev) => ({ ...prev, datos_clave: e.target.value }))} />
            </div>
          </div>
        </div>
      </div>

      {/* DIMENSIONES Y PESO — oculto para ventas en productos no transitorios */}
      {!esVentasNoTransitorio && (
        <div className="surface">
          <div className="surface-header">
            <h3 className="surface-title">Dimensiones y Peso</h3>
          </div>
          <div className="surface-body">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">Peso (kg)</label>
                <input type="number" step="0.01" className="input" value={producto.peso}
                  onChange={(e) => setProducto((prev) => ({ ...prev, peso: e.target.value }))} />
              </div>
              <div>
                <label className="label">Alto (cm)</label>
                <input type="number" step="0.1" className="input" value={producto.alto}
                  onChange={(e) => setProducto((prev) => ({ ...prev, alto: e.target.value }))} />
              </div>
              <div>
                <label className="label">Largo (cm)</label>
                <input type="number" step="0.1" className="input" value={producto.largo}
                  onChange={(e) => setProducto((prev) => ({ ...prev, largo: e.target.value }))} />
              </div>
              <div>
                <label className="label">Ancho (cm)</label>
                <input type="number" step="0.1" className="input" value={producto.ancho}
                  onChange={(e) => setProducto((prev) => ({ ...prev, ancho: e.target.value }))} />
              </div>
              <div>
                <label className="label">Centímetro cúbico (cm³)</label>
                <input readOnly className="input" style={{background:"var(--bg)"}} value={metroCubico} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LISTA DE PRECIOS — oculto para ventas en productos no transitorios */}
      {!esVentasNoTransitorio && (
        <div className="surface">
          <div className="surface-header">
            <h3 className="surface-title">Lista de Precios</h3>
          </div>
          <div className="surface-body">
            <div className={`grid grid-cols-1 ${mostrarMargen ? "md:grid-cols-3" : "md:grid-cols-2"} gap-4`}>
              {(esAdmin || (esVentasOJefe && (esProductoTransitorio || esPendienteAprobacion))) && (
                <>
                  <div>
                    <label className="label">Costo *</label>
                    <MoneyInput
                      value={producto.costo}
                      onChange={(v) => setProducto((prev) => ({ ...prev, costo: formatearCLDesdeString(v) }))}
                    />
                  </div>
                  <div />
                  {mostrarMargen && <div />}
                </>
              )}

              <div>
                <label className="label">
                  {esVentasOJefe ? "Precio Venta Neto 1 *" : "Listado de Precios 1 *"}
                </label>
                <MoneyInput
                  value={producto.lista1}
                  onChange={(v) => setProducto((prev) => ({ ...prev, lista1: formatearCLDesdeString(v) }))}
                />
              </div>
              <div>
                <label className="label">Precio Bruto 1</label>
                <input
                  readOnly
                  className="input"
                  style={{background:"var(--bg)"}}
                  value={`$${Math.round((Number(String(producto.lista1).replace(/\./g, "")) || 0) * 1.19).toLocaleString("es-CL")}`}
                />
              </div>
              {mostrarMargen && (
                <div>
                  <label className="label">{esVentasOJefe ? "Margen Venta Neto 1" : "Margen Lista 1"}</label>
                  <input readOnly className="input" style={{background:"var(--bg)"}} value={margenVenta} />
                </div>
              )}

              <div>
                <label className="label">
                  {esVentasOJefe ? "Precio Venta Neto 2 *" : "Listado de Precios 2 *"}
                </label>
                <MoneyInput
                  value={producto.lista2}
                  onChange={(v) => setProducto((prev) => ({ ...prev, lista2: formatearCLDesdeString(v) }))}
                />
              </div>
              <div>
                <label className="label">Precio Bruto 2</label>
                <input
                  readOnly
                  className="input"
                  style={{background:"var(--bg)"}}
                  value={`$${Math.round((Number(String(producto.lista2).replace(/\./g, "")) || 0) * 1.19).toLocaleString("es-CL")}`}
                />
              </div>
              {mostrarMargen && (
                <div>
                  <label className="label">{esVentasOJefe ? "Margen Venta Neto 2" : "Margen Lista 2"}</label>
                  <input readOnly className="input" style={{background:"var(--bg)"}} value={margenVentaLista2} />
                </div>
              )}

              <div>
                <label className="label">
                  {esVentasOJefe ? "Precio Venta Neto 3" : "Listado de Precios 3"}
                </label>
                <MoneyInput value={lista3Display} readOnly />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Calculado automáticamente (Lista 2 × {FACTOR_LISTA_3}). Usado en Licitación 9 a 24 meses.
                </p>
              </div>
              <div>
                <label className="label">Precio Bruto 3</label>
                <input
                  readOnly
                  className="input"
                  style={{background:"var(--bg)"}}
                  value={`$${Math.round((Number(String(lista3Display).replace(/\./g, "")) || 0) * 1.19).toLocaleString("es-CL")}`}
                />
              </div>
              {mostrarMargen && (
                <div>
                  <label className="label">{esVentasOJefe ? "Margen Venta Neto 3" : "Margen Lista 3"}</label>
                  <input readOnly className="input" style={{background:"var(--bg)"}} value={margenVentaLista3} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ACCIONES */}
      <div className="btn-row" style={{marginTop:"1.5rem"}}>
        <button type="button" onClick={guardarCambios} className="btn btn-primary">Guardar Cambios</button>
        <button type="button" onClick={generarFichaTecnica} className="btn btn-secondary" disabled={generandoFicha}>
          {generandoFicha ? "Generando…" : "Generar Ficha Técnica"}
        </button>
      </div>
    </div>
  );
}








































