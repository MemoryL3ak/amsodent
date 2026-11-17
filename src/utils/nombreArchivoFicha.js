/* ── Nombre del archivo de la ficha técnica (2026-11-17) ─────────────────────
   Pedido de Ariel: «al descargar la ficha técnica de un producto, que el
   nombre del archivo sea "Nombre Producto - SKU"». Antes la ficha suelta se
   llamaba solo con el SKU y, dentro del ZIP, «SKU - Nombre».

   Un solo lugar para el nombre: lo usan la descarga suelta (Productos, Crear y
   Editar producto), el ZIP de fichas y el título del PDF (lo que muestra la
   pestaña cuando la ficha se abre desde la cotización). Sin extensión. */

const NOMBRE_MAX = 110; // el nombre se recorta; el SKU va siempre completo

const limpiar = (v) =>
  String(v ?? "")
    .split("").filter((ch) => ch.charCodeAt(0) >= 32).join("") // sin caracteres de control
    .replace(/[\\/:*?"<>|]+/g, "-") // lo que Windows no acepta en un nombre de archivo
    .replace(/\s+/g, " ")
    .trim();

/**
 * «Nombre del producto - SKU». Sin SKU queda solo el nombre; sin nombre, solo
 * el SKU; sin ninguno, `respaldo`.
 */
export function nombreArchivoFicha(producto, respaldo = "Ficha técnica") {
  const nombre = limpiar(producto?.nombre).slice(0, NOMBRE_MAX).trim();
  const sku = limpiar(producto?.sku);
  const base = nombre && sku ? `${nombre} - ${sku}` : nombre || sku || limpiar(respaldo) || "Ficha técnica";
  // Windows tampoco acepta nombres que terminan en punto o espacio.
  return base.replace(/[. ]+$/g, "") || "Ficha técnica";
}
