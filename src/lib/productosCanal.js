/* Aviso entre pestañas cuando se guarda un producto (2026-10-16).
   Pedido de Ariel: si mientras se crea o edita una cotización se actualiza un
   producto transitorio desde el aviso de validación (que abre Productos →
   Editar en otra pestaña), la información nueva debe llegar sola a la
   cotización. Editar Producto avisa el id por un BroadcastChannel; la
   cotización relee el producto desde el catálogo y actualiza el aviso y sus
   ítems. Sin BroadcastChannel no pasa nada (queda el refresco al volver a la
   pestaña que ya tenía la cotización). */

const CANAL = "amsodent-productos";

export function avisarProductoActualizado(id) {
  if (!(Number(id) > 0)) return;
  try {
    const c = new BroadcastChannel(CANAL);
    c.postMessage({ tipo: "producto-actualizado", id: Number(id), ts: Date.now() });
    c.close();
  } catch {
    /* navegador sin BroadcastChannel */
  }
}

// Llama a `fn(id)` cada vez que otra pestaña guarda un producto. Devuelve la función para dejar de escuchar.
export function escucharProductosActualizados(fn) {
  let c = null;
  try {
    c = new BroadcastChannel(CANAL);
    c.onmessage = (e) => {
      if (e?.data?.tipo === "producto-actualizado" && Number(e.data.id) > 0) fn(Number(e.data.id));
    };
  } catch {
    return () => {};
  }
  return () => {
    try { c.close(); } catch { /* ya cerrado */ }
  };
}

/* ¿Este ítem de la cotización viene de este producto? Por el id que guarda el
   ítem al elegirlo; si no lo tiene (ítems cargados de una cotización
   guardada), por el SKU o, en los transitorios sin SKU, por el nombre que
   tenía el producto antes del cambio. */
export function itemEsDelProducto(item, fresco, anterior) {
  if (item?.producto_id != null) return Number(item.producto_id) === Number(fresco.id);
  const skuAnt = String(anterior?.sku || "").trim();
  if (skuAnt) return String(item?.sku || "").trim() === skuAnt;
  const nombreAnt = String(anterior?.nombre || "").trim();
  return !!nombreAnt && !String(item?.sku || "").trim() && String(item?.producto || "").trim() === nombreAnt;
}
