/* Condiciones de venta del cliente (2026-10-16). Pedido de Ariel: en el
   perfil del cliente la condición de venta es de selección múltiple. Se guarda
   en el mismo texto `clientes.condiciones_venta`, separadas por coma y en el
   orden de OPCIONES ("30 días, Contado"): lo que ya la muestra sigue igual.
   La cotización conserva UNA condición (condicion_venta). El backend tiene la
   misma lectura en bsale-libre.service.ts (crédito en venta directa). */

export const OPCIONES_CONDICION_VENTA = ["30 días", "Contado"];

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Texto guardado → lista de opciones conocidas (tolera "30 dias", mayúsculas y separadores ; /).
export function leerCondiciones(texto) {
  const partes = String(texto || "").split(/[,;/]/).map(norm).filter(Boolean);
  return OPCIONES_CONDICION_VENTA.filter((o) => partes.includes(norm(o)));
}

export function unirCondiciones(lista) {
  const elegidas = new Set((lista || []).map(norm));
  return OPCIONES_CONDICION_VENTA.filter((o) => elegidas.has(norm(o))).join(", ");
}

export const tieneCredito30 = (texto) => leerCondiciones(texto).includes("30 días");

// Condición de la cotización a partir de la del cliente: "30 días" si la tiene, si no "Contado".
export function condicionParaCotizacion(texto) {
  const l = leerCondiciones(texto);
  return l.includes("30 días") ? "30 días" : l.includes("Contado") ? "Contado" : "";
}
