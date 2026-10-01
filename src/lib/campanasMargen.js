/* ── Campañas de margen por marca y categoría (2026-10-01) ─────────────────
   Una campaña de margen no guarda precios: guarda la regla ("estas marcas y/o
   categorías, en esta lista, con este margen, entre estas fechas"). El precio
   se calcula acá, desde el costo vigente del producto, cada vez que se
   necesita. Esta es la ÚNICA implementación del cálculo: la usan el simulador
   de la pantalla de campañas, Crear y Detalle de cotización y la grilla de
   Productos, para que todos muestren exactamente el mismo número.

   Margen sobre el precio de venta — el mismo que mide la cotización:
       margen = (precio − costo) / precio      ⇒      precio = costo / (1 − margen)
*/

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Precio neto que deja `margenPct` de margen sobre la venta. 0 si no se puede. */
export function precioDesdeMargen(costo, margenPct) {
  const c = Number(costo || 0);
  const m = Number(margenPct);
  if (!(c > 0) || !Number.isFinite(m) || m < 0 || m >= 95) return 0;
  return Math.round(c / (1 - m / 100));
}

/** Margen sobre la venta, en %, de un precio dado. null si no hay precio. */
export function margenDePrecio(costo, precio) {
  const p = Number(precio || 0);
  if (!(p > 0)) return null;
  return ((p - Number(costo || 0)) / p) * 100;
}

/* ¿La campaña alcanza a este producto? Marcas y categorías vacías significan
   "todas". Se compara sin tildes ni mayúsculas: el catálogo tiene la misma
   marca escrita de varias formas. Un producto sin costo queda fuera — sin
   costo no hay cómo calcular un precio por margen. */
export function campanaAlcanza(prod, campana) {
  if (!prod || !campana) return false;
  if (!(Number(prod.costo) > 0)) return false;
  const marcas = Array.isArray(campana.marcas) ? campana.marcas : [];
  const categorias = Array.isArray(campana.categorias) ? campana.categorias : [];
  if (marcas.length && !marcas.some((m) => norm(m) === norm(prod.marca))) return false;
  if (categorias.length && !categorias.some((c) => norm(c) === norm(prod.categoria))) return false;
  return true;
}

/* Precio de campaña de margen para un producto en una lista ("1" | "2" | "3").
   `campanas` son las VIGENTES, de la más nueva a la más antigua: si dos
   alcanzan al mismo producto en la misma lista, manda la más nueva.
   Devuelve { precio, campana } o null si ninguna aplica. */
export function precioCampanaMargen(prod, listado, campanas) {
  if (!prod || !Array.isArray(campanas) || campanas.length === 0) return null;
  const lista = String(listado ?? "").replace(/\D/g, "");
  for (const c of campanas) {
    if (String(c.lista_precios) !== lista) continue;
    if (!campanaAlcanza(prod, c)) continue;
    const precio = precioDesdeMargen(prod.costo, c.margen_pct);
    if (precio > 0) return { precio, campana: c };
  }
  return null;
}

/** vigente | programada | terminada | pausada, según la fecha de hoy (YYYY-MM-DD). */
export function estadoCampanaMargen(campana, hoy) {
  if (campana?.activa === false) return "pausada";
  const desde = String(campana?.desde || "").slice(0, 10);
  const hasta = String(campana?.hasta || "").slice(0, 10);
  if (hoy < desde) return "programada";
  if (hoy > hasta) return "terminada";
  return "vigente";
}

/** Fecha de hoy en Chile, YYYY-MM-DD (misma regla que el backend). */
export function hoyEnChile(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}
