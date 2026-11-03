/* ── ¿La ficha técnica del producto está completa? (2026-11-03) ──────────────
   Pedido de Ariel: el PDF de la cotización no se emite hasta que TODOS sus
   productos del catálogo tengan la ficha técnica completa, y el botón «Ficha»
   de cada línea se pinta distinto según esté completa (verde) o no (rojo).

   Un producto puede llegar de tres formas:
   · con los textos de la ficha (GET /productos, GET /productos/:id, Supabase
     con esas columnas): se revisan los 8 campos — es el dato más fresco;
   · solo con el booleano `ficha_completa` del listado liviano
     (GET /productos/list), calculado en el servidor con el mismo criterio
     (backend/src/productos/productos.service.ts → CAMPOS_FICHA);
   · sin ninguna de las dos cosas: no se sabe (null) y no se bloquea nada. */

export const CAMPOS_FICHA_TECNICA = [
  "presentacion",
  "descripcion",
  "composicion",
  "uso_indicaciones",
  "beneficios",
  "modo_uso",
  "almacenamiento",
  "datos_clave",
];

const lleno = (p, k) => String(p?.[k] ?? "").trim().length > 0;

/** true / false, o null si el objeto no trae ni los textos ni el booleano. */
export function fichaTecnicaCompleta(p) {
  if (!p || typeof p !== "object") return null;
  const conTexto = CAMPOS_FICHA_TECNICA.filter((k) => Object.prototype.hasOwnProperty.call(p, k));
  if (conTexto.length === CAMPOS_FICHA_TECNICA.length) return CAMPOS_FICHA_TECNICA.every((k) => lleno(p, k));
  if (typeof p.ficha_completa === "boolean") return p.ficha_completa;
  if (conTexto.length) return CAMPOS_FICHA_TECNICA.every((k) => lleno(p, k));
  return null;
}

/** Producto del catálogo detrás de un ítem de la cotización (por SKU; si no, por nombre). */
export function productoDeItem(item, productos) {
  const sku = String(item?.sku || "").trim();
  const nombre = String(item?.producto || "").trim();
  const lista = productos || [];
  return (
    (sku && lista.find((p) => String(p?.sku || "").trim() === sku)) ||
    (nombre && lista.find((p) => String(p?.nombre || "").trim() === nombre)) ||
    null
  );
}

/** Productos del catálogo usados por los ítems cuya ficha técnica NO está completa (sin repetir). */
export function productosSinFichaDeItems(items, productos) {
  const vistos = new Set();
  const lista = [];
  for (const it of items || []) {
    const p = productoDeItem(it, productos);
    if (!p?.id || vistos.has(p.id)) continue;
    if (fichaTecnicaCompleta(p) === false) {
      vistos.add(p.id);
      lista.push(p);
    }
  }
  return lista;
}

/** «SKU — nombre» (o solo uno de los dos) para listar productos en un aviso. */
export function etiquetaProducto(p) {
  const sku = String(p?.sku || "").trim();
  const nombre = String(p?.nombre || "").trim();
  return sku && nombre ? `${sku} — ${nombre}` : sku || nombre || `#${p?.id ?? "?"}`;
}

/** Texto para el aviso de bloqueo del PDF: hasta `max` productos y «…» si hay más. */
export function resumenSinFicha(lista, max = 4) {
  const n = (lista || []).length;
  if (!n) return "";
  const detalle = lista.slice(0, max).map(etiquetaProducto).join(" · ");
  return `${n} producto${n === 1 ? "" : "s"} sin ficha técnica completa: ${detalle}${n > max ? "…" : ""}`;
}
