/* Observación de la guía de despacho → atributo adicional «Observación» en
   Bsale (2026-10-08). Pedido de Ariel: "al crear la guía debe aparecer el
   campo para ver las observaciones y permitir agregar más información por
   producto, que se envía a los atributos adicionales". El texto se arma igual
   que en el servidor (observacionCompuesta en bsale-despachos.service.ts):
   general · SKU: texto · SKU: texto. Caben 250 caracteres. */

export const OBSERVACION_GUIA_MAX = 250;

const limpiar = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

export function observacionPorLineas(lineas) {
  const vistas = new Set();
  const partes = [];
  for (const l of lineas || []) {
    const obs = limpiar(l?.observacion);
    if (!obs) continue;
    const quien = String(l?.sku || "").trim() || String(l?.producto || "").trim().slice(0, 40);
    const parte = quien ? `${quien}: ${obs}` : obs;
    if (vistas.has(parte)) continue;
    vistas.add(parte);
    partes.push(parte);
  }
  return partes.join(" · ");
}

export function componerObservacion(general, lineas) {
  return [limpiar(general), observacionPorLineas(lineas)].filter(Boolean).join(" · ");
}
