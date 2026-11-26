/* ── Postventa: lo común a la plataforma y al portal (2026-11-26) ────────────
   Nombres, colores y formatos de las solicitudes de postventa. Las claves
   (categorías, estados, acciones) son las del servidor:
   backend/src/postventa/postventa.reglas.ts. */

export const CATEGORIAS_POSTVENTA = [
  { clave: "producto_mal_estado", nombre: "Productos en mal estado" },
  { clave: "fecha_vencimiento", nombre: "Fecha de vencimiento" },
  { clave: "producto_no_corresponde", nombre: "Producto no corresponde" },
  { clave: "faltan_cantidades", nombre: "Faltan cantidades" },
  { clave: "sobran_cantidades", nombre: "Sobran cantidades" },
  { clave: "cambio_peticion_cliente", nombre: "Cambio a petición del cliente" },
  { clave: "apelacion_multa", nombre: "Gestión de apelación de multa" },
  { clave: "otros", nombre: "Otros" },
];

export const ESTADOS_POSTVENTA = [
  { clave: "ingresada", nombre: "Ingresada", color: "#1d4ed8", bg: "#dbeafe" },
  { clave: "en_gestion", nombre: "En gestión", color: "#b45309", bg: "#fef3c7" },
  { clave: "resuelta", nombre: "Resuelta", color: "#15803d", bg: "#dcfce7" },
  { clave: "rechazada", nombre: "Rechazada", color: "#b91c1c", bg: "#fee2e2" },
];

/* Las tres acciones: qué documento resulta de cada una (tipos de licitacion_documentos). */
export const ACCIONES_POSTVENTA = [
  { clave: "nota_credito", nombre: "Emisión de nota de crédito", corto: "Nota de crédito", sigla: "NC", documentos: ["nota_credito"] },
  { clave: "factura", nombre: "Emisión de otra factura", corto: "Factura", sigla: "Factura", documentos: ["factura", "factura_boleta"] },
  { clave: "guia_despacho", nombre: "Emisión de guía de despacho", corto: "Guía de despacho", sigla: "Guía", documentos: ["guia_despacho"] },
];

export const estadoPostventa = (clave) => ESTADOS_POSTVENTA.find((e) => e.clave === clave) || { clave, nombre: clave || "—", color: "#475569", bg: "#f1f5f9" };
export const accionPostventa = (clave) => ACCIONES_POSTVENTA.find((a) => a.clave === clave) || null;
export const esAbierta = (estado) => estado === "ingresada" || estado === "en_gestion";

export const NOMBRE_DOCUMENTO = {
  factura: "Factura",
  factura_boleta: "Factura o boleta",
  guia_despacho: "Guía de despacho",
  nota_credito: "Nota de crédito",
};

/* «Factura N° 123» / «Guía de despacho N° 45» para el documento afectado de una solicitud. */
export function textoDocumentoAfectado(s) {
  if (!s?.documento_tipo && !s?.documento_numero) return "";
  const nombre = s.documento_tipo === "guia_despacho" ? "Guía de despacho" : "Factura";
  return `${nombre}${s.documento_numero ? ` N° ${s.documento_numero}` : ""}`;
}

export const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const fechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const fechaCorta = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

export const quien = (email) => String(email || "").split("@")[0] || "—";

export const numero = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("es-CL", { maximumFractionDigits: 2 }));

/* Solo dígitos, punto y coma, para los campos de cantidad. */
export const soloNumero = (v) => String(v ?? "").replace(/[^\d.,]/g, "");

let ultimoUid = 0;
export const nuevoUid = () => `p${Date.now().toString(36)}${(ultimoUid += 1)}`;
