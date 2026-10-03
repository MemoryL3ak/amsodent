/* ── Qué decirle al usuario tras enviar un producto a Bsale (2026-10-03) ─────
   El backend devuelve `bsale` al crear o editar un producto con SKU:
   { estado: creado | ya_existia | sin_sku | apagada | error, ... }. */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

export function mensajeBsale(b) {
  if (!b || typeof b !== "object") return "";
  switch (b.estado) {
    case "creado": {
      const precios = (b.precios || []).map((p) => `${p.nombre} ${clp(p.neto)}`).join(", ");
      const avisos = (b.avisos || []).length ? ` Ojo: ${b.avisos.join(" ")}` : "";
      return `Creado en Bsale (variante ${b.variante_id}${b.tipo_producto ? `, tipo ${b.tipo_producto}` : ""}${precios ? `; precios: ${precios}` : "; sin precios: ponlos en Bsale"}).${avisos}`;
    }
    case "ya_existia":
      return `El SKU ya estaba en Bsale (variante ${b.variante_id}${b.nombre_bsale ? `: ${b.nombre_bsale}` : ""}).`;
    case "error":
      return `No se pudo enviar a Bsale: ${b.mensaje || "error desconocido"}. Puedes reintentar desde la ficha del producto.`;
    case "apagada":
      return "El envío a Bsale está apagado en el servidor.";
    default:
      return "";
  }
}

/* Tipo de aviso para el toast: el producto ya se guardó, así que un error de
   Bsale es una advertencia, no un fallo. */
export function tipoAvisoBsale(b) {
  if (!b) return "success";
  return b.estado === "error" || b.estado === "apagada" || (b.avisos || []).length ? "warning" : "success";
}
