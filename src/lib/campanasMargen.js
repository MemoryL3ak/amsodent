/* ── Campañas de margen por marca y categoría (2026-10-01) ─────────────────
   Una campaña de margen no guarda precios: guarda la regla ("estas marcas y/o
   categorías, en esta lista, con este margen, entre estas fechas"). El precio
   se calcula acá, desde el costo vigente del producto, cada vez que se
   necesita. Esta es la ÚNICA implementación del cálculo: la usan el simulador
   de la pantalla de campañas, Crear y Detalle de cotización y la grilla de
   Productos, para que todos muestren exactamente el mismo número.

   (2026-10-07) El % de la campaña es un DESCUENTO sobre el precio de lista,
   no un margen fijo. Pedido de Ariel: "el % de margen corresponde al
   descuento, no al que se seteará fijo". Así:
       precio de campaña = precio de lista × (1 − descuento)
   (la columna sigue llamándose margen_pct en la base). El margen que queda se
   sigue midiendo sobre la venta, igual que en la cotización:
       margen = (precio − costo) / precio
*/
import { calcularLista3 } from "./listas";

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Precio de lista del producto en la lista "1" | "2" | "3" (la 3 se calcula de la 2 si no viene). */
export function precioListaDe(prod, lista) {
  if (String(lista) === "3") {
    const explicito = Number(prod?.lista3 ?? 0);
    return explicito > 0 ? explicito : calcularLista3(prod?.lista2);
  }
  return Number(prod?.[`lista${String(lista).replace(/\D/g, "")}`] ?? 0);
}

/** Precio con el descuento de la campaña (en %). 0 si no hay precio o el descuento no es válido. */
export function precioConDescuento(precioLista, descuentoPct) {
  const p = Number(precioLista || 0);
  const d = Number(descuentoPct);
  if (!(p > 0) || !Number.isFinite(d) || d < 0 || d >= 95) return 0;
  return Math.round(p * (1 - d / 100));
}

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

// SKU tal como se compara: sin espacios, en mayúsculas.
export const normSku = (v) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

/* ¿La campaña alcanza a este producto? Marcas, categorías y SKUs vacíos
   significan "todos"; con más de un filtro, el producto debe cumplirlos
   todos (con SKUs y nada más, la campaña es solo para esos productos). Se
   compara sin tildes ni mayúsculas: el catálogo tiene la misma marca escrita
   de varias formas. (Desde 2026-10-07 el descuento sale del precio de lista:
   ya no hace falta que el producto tenga costo; sin precio de lista no aplica.) */
export function campanaAlcanza(prod, campana) {
  if (!prod || !campana) return false;
  const marcas = Array.isArray(campana.marcas) ? campana.marcas : [];
  const categorias = Array.isArray(campana.categorias) ? campana.categorias : [];
  const skus = Array.isArray(campana.skus) ? campana.skus : [];
  if (skus.length && !skus.some((s) => normSku(s) === normSku(prod.sku))) return false;
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
    const precio = precioConDescuento(precioListaDe(prod, lista), c.margen_pct);
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
