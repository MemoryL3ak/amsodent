/* ── Qué decirle al usuario tras enviar un producto a Bsale (2026-10-03) ─────
   El backend devuelve `bsale` al crear o editar un producto:
   { estado: creado | ya_existia | enlazado | sku_asignado | sin_sku | apagada | error, ... }.
   (2026-10-07) Los transitorios sin SKU también van a Bsale (variante sin código). */

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

export function mensajeBsale(b) {
  if (!b || typeof b !== "object") return "";
  switch (b.estado) {
    case "creado": {
      const precios = (b.precios || []).map((p) => `${p.nombre} ${clp(p.neto)}`).join(", ");
      const avisos = (b.avisos || []).length ? ` Ojo: ${b.avisos.join(" ")}` : "";
      return `Creado en Bsale (variante ${b.variante_id}${b.tipo_producto ? `, tipo ${b.tipo_producto}` : ""}${precios ? `; precios: ${precios}` : "; sin precios: ponlos en Bsale"}).${avisos}`;
    }
    case "ya_existia": {
      const avisos = (b.avisos || []).length ? ` Ojo: ${b.avisos.join(" ")}` : "";
      return b.mensaje && !b.nombre_bsale
        ? `${b.mensaje} (variante ${b.variante_id}).`
        : `El SKU ya estaba en Bsale (variante ${b.variante_id}${b.nombre_bsale ? `: ${b.nombre_bsale}` : ""}).${avisos}`;
    }
    case "enlazado":
      return `Ya había en Bsale un producto con el mismo nombre${b.nombre_bsale ? ` («${b.nombre_bsale}»)` : ""}: quedó enlazado a él (variante ${b.variante_id}), sin duplicarlo.`;
    case "sku_asignado":
      return b.mensaje || `Se le puso el SKU a la variante ${b.variante_id} que ya estaba en Bsale.`;
    case "actualizado": {
      const precios = (b.precios || []).map((p) => `${p.nombre} ${clp(p.neto)}`).join(", ");
      const avisos = (b.avisos || []).length ? ` Ojo: ${b.avisos.join(" ")}` : "";
      return `Actualizado en Bsale (variante ${b.variante_id}${precios ? `; precios: ${precios}` : ""}).${avisos}`;
    }
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
