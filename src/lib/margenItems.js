/* ── Margen de los ítems de cotizaciones (paneles), 2026-10-03 ───────────────
   Pedido de Ariel: "revisar el % de margen porque no tiene sentido". Con datos
   reales, el margen del panel salía inflado (agosto, Entidad Pública: 57%
   cuando lo medible era 35%) porque:
     1. El costo de respaldo solo se buscaba por SKU. 61 de 75 líneas sin costo
        no tenían SKU, y la cotización sí las costea por nombre del producto.
     2. Una línea sin costo sumaba su venta con costo 0, o sea 100% de margen.
   Ahora el costo sale igual que en la cotización (guardado en el ítem →
   catálogo por SKU → catálogo por nombre) y las líneas que siguen sin costo
   quedan FUERA del margen, informadas aparte (ventaSinCosto).
   Margen = (venta − costo) / venta, sobre el precio de venta (igual que en la
   cotización y en las campañas de margen). */

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Índice de costos del catálogo: por SKU y por nombre (solo costos > 0). */
export function indiceCostos(productos) {
  const porSku = {};
  const porNombre = {};
  for (const p of productos || []) {
    const c = Number(p?.costo || 0);
    if (!(c > 0)) continue;
    const sku = String(p?.sku || "").trim().toUpperCase();
    if (sku) porSku[sku] = c;
    const n = norm(p?.nombre);
    if (n && !(n in porNombre)) porNombre[n] = c;
  }
  return { porSku, porNombre };
}

/** Costo unitario de un ítem: el guardado con la cotización; si no, el del catálogo por SKU y luego por nombre. 0 = sin costo. */
export function costoUnitarioItem(it, indice) {
  if (Number(it?.costo) > 0) return Number(it.costo);
  const sku = String(it?.sku || "").trim().toUpperCase();
  if (sku && indice?.porSku?.[sku] > 0) return indice.porSku[sku];
  const n = norm(it?.producto);
  return (n && indice?.porNombre?.[n]) || 0;
}

/** Margen de un conjunto de ítems (`licitacion_id, producto, sku, cantidad, total, costo`). */
export function margenDeItems(items, indice) {
  let venta = 0;
  let costo = 0;
  let ventaSinCosto = 0;
  let lineasSinCosto = 0;
  let ventaTotal = 0;
  const porLic = {};
  for (const it of items || []) {
    const v = Number(it?.total || 0);
    ventaTotal += v;
    const lid = Number(it?.licitacion_id);
    const e = lid ? (porLic[lid] = porLic[lid] || { venta: 0, costo: 0, ventaSinCosto: 0 }) : null;
    const cu = costoUnitarioItem(it, indice);
    if (!(cu > 0)) {
      ventaSinCosto += v;
      lineasSinCosto += 1;
      if (e) e.ventaSinCosto += v;
      continue;
    }
    const c = cu * (Number(it?.cantidad) || 0);
    venta += v;
    costo += c;
    if (e) {
      e.venta += v;
      e.costo += c;
    }
  }
  const monto = Math.round(venta - costo);
  return {
    monto,
    pct: venta > 0 ? (monto / venta) * 100 : 0,
    venta: Math.round(venta),
    costo: Math.round(costo),
    ventaSinCosto: Math.round(ventaSinCosto),
    lineasSinCosto,
    ventaTotal: Math.round(ventaTotal),
    porLic,
  };
}

/** Fila del desglose por cotización a partir de `porLic`. */
export function filaMargenLic(r) {
  const sinCosto = !(r.venta > 0) && r.ventaSinCosto > 0;
  const venta = sinCosto ? r.ventaSinCosto : r.venta;
  const monto = sinCosto ? 0 : r.venta - r.costo;
  return { venta, costo: r.costo, monto, pct: !sinCosto && r.venta > 0 ? (monto / r.venta) * 100 : 0, sinCosto, ventaSinCosto: r.ventaSinCosto || 0 };
}

/** Texto corto para el KPI: cuánto de la venta quedó fuera por no tener costo. */
export function notaSinCosto(m) {
  if (!m?.ventaSinCosto || !(m.ventaTotal > 0)) return "";
  const pct = (m.ventaSinCosto / m.ventaTotal) * 100;
  return ` · ${pct < 1 ? "<1" : Math.round(pct)}% de la venta sin costo (no cuenta)`;
}
