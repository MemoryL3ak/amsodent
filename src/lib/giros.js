/* Giros del cliente (2026-10-23). Pedido de Ariel: un cliente puede tener
   varios giros. La ficha los guarda como lista (clientes.giros; el primero es
   el principal). Bsale guarda UN solo texto de giro (`activity`), así que el
   backend se los manda unidos con « / » (backend/src/bsale/bsale-clientes.service.ts,
   misma lectura que acá). La cotización sigue con UN giro (licitaciones.giro):
   el que propone la ficha, o el que se escriba. */

export const GIRO_MAX = 80;
export const GIROS_MAX = 6;
export const SEPARADOR_GIROS = " / ";

const clave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Lista limpia: sin vacíos ni repetidos (sin distinguir mayúsculas ni tildes),
// recortados a GIRO_MAX y como mucho GIROS_MAX. Acepta arreglo o texto por líneas.
export function normalizarGiros(valor) {
  const crudos = Array.isArray(valor) ? valor : String(valor || "").split(/\r?\n/);
  const vistos = new Set();
  const out = [];
  for (const v of crudos) {
    const g = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, GIRO_MAX).trim();
    if (!g) continue;
    const k = clave(g);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(g);
    if (out.length >= GIROS_MAX) break;
  }
  return out;
}

// Giros de una ficha de cliente (tolera que la columna aún no exista).
export function leerGiros(cliente) {
  return normalizarGiros(Array.isArray(cliente?.giros) ? cliente.giros : []);
}

export const girosATexto = (giros) => normalizarGiros(giros).join(SEPARADOR_GIROS);

export function tieneGiro(giros, giro) {
  const k = clave(giro);
  return !!k && normalizarGiros(giros).some((g) => clave(g) === k);
}

// Texto para el aviso tras guardar la ficha, según lo que contestó el backend
// sobre Bsale (`bsale` en la respuesta). null si no hay nada que decir.
export function mensajeBsaleGiros(bsale) {
  if (!bsale || !bsale.estado) return null;
  if (bsale.estado === "sin_cambios" || bsale.estado === "sin_giros") return null;
  return bsale.mensaje || null;
}

export const bsaleGirosFallo = (bsale) => !!bsale && (bsale.estado === "error" || bsale.estado === "apagada");
