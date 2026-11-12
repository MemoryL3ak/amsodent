/* ── Precios adjudicados en Mercado Público: las cuentas del resumen ─────────
   (2026-11-12) Lo que muestra la ventana «Precios adjudicados» de cada línea
   de la cotización. Las filas vienen de GET /licitaciones/productos/
   precios-adjudicados (una por proceso con desenlace); aquí se filtran por
   período y se resumen. Sin React, para poder probarlo solo.

   Qué entra en las cifras:
     · solo filas con precio adjudicado y que no sean atípicas (un precio de
       otro orden que el nuestro: otra unidad o un dato mal ingresado);
     · los precios «estimados» (procesos cotizados por el total) solo se usan
       si no hay ninguno firme, y entonces se dice.
   El precio «típico» es la MEDIANA: un ganador que ofertó a la mitad no la
   mueve como movería a un promedio. */

export const PERIODOS_ADJ = [
  { value: "12", label: "Últimos 12 meses" },
  { value: "24", label: "Últimos 24 meses" },
  { value: "todo", label: "Todo el historial" },
];

const isoHoy = (hoy) => {
  const d = hoy instanceof Date ? hoy : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Filas cuya fecha cae en los últimos `meses` ("12", "24" o "todo"). */
export function filtrarPeriodo(filas, meses, hoy = new Date()) {
  const lista = Array.isArray(filas) ? filas : [];
  const n = Number(meses);
  if (!Number.isFinite(n) || n <= 0) return lista;
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - n, hoy.getDate());
  const desde = isoHoy(d);
  return lista.filter((f) => String(f.fecha || "") >= desde);
}

export function mediana(xs) {
  const v = (xs || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const conPrecio = (f) => f.precio_adjudicado != null && Number(f.precio_adjudicado) > 0;
const firme = (f) => conPrecio(f) && !f.atipico && f.calce !== "estimado";
const estimada = (f) => conPrecio(f) && !f.atipico && f.calce === "estimado";

/** Las filas que alimentan las cifras y el gráfico (firmes; o estimadas si no hay firmes). */
export function filasDeReferencia(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  const firmes = lista.filter(firme);
  if (firmes.length) return { base: "firme", filas: firmes };
  const estimadas = lista.filter(estimada);
  return { base: estimadas.length ? "estimado" : "ninguna", filas: estimadas };
}

export function resumenAdjudicaciones(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  const { base, filas: ref } = filasDeReferencia(lista);
  const precios = ref.map((f) => Number(f.precio_adjudicado));
  const reciente = [...ref].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
  const ganadas = lista.filter((f) => f.resultado === "ganada");
  const perdidas = lista.filter((f) => f.resultado === "perdida");
  // Cuánto más abajo (o arriba) que nosotros quedó el que ganó, en los procesos perdidos.
  const brechas = ref
    .filter((f) => f.resultado === "perdida" && Number(f.nuestro_precio) > 0)
    .map((f) => ((Number(f.precio_adjudicado) - Number(f.nuestro_precio)) / Number(f.nuestro_precio)) * 100);
  const preciosGanados = ganadas.filter(conPrecio).map((f) => Number(f.precio_adjudicado));
  return {
    base,
    procesos: lista.length,
    conPrecio: ref.length,
    tipico: precios.length ? Math.round(mediana(precios)) : null,
    minimo: precios.length ? Math.min(...precios) : null,
    maximo: precios.length ? Math.max(...precios) : null,
    ultima: reciente,
    ganadas: ganadas.length,
    perdidas: perdidas.length,
    tasa: lista.length ? (ganadas.length / lista.length) * 100 : null,
    tipicoGanado: preciosGanados.length ? Math.round(mediana(preciosGanados)) : null,
    brechaPerdidas: brechas.length ? mediana(brechas) : null,
    perdidasComparadas: brechas.length,
    atipicas: lista.filter((f) => f.atipico).length,
    estimadas: lista.filter(estimada).length,
    sinPrecio: lista.filter((f) => !conPrecio(f)).length,
  };
}

/** Diferencia porcentual de un precio contra el de referencia (+ = más caro). */
export function diferenciaPct(precio, referencia) {
  const p = Number(precio);
  const r = Number(referencia);
  if (!(p > 0) || !(r > 0)) return null;
  return ((p - r) / r) * 100;
}

/** "+12 %", "−8 %", "igual". Con menos de 10 % deja un decimal. */
export function textoPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const abs = Math.abs(pct);
  if (abs < 0.05) return "igual";
  const cifra = abs < 10 ? abs.toLocaleString("es-CL", { maximumFractionDigits: 1 }) : Math.round(abs).toLocaleString("es-CL");
  return `${pct > 0 ? "+" : "−"}${cifra} %`;
}

/* Marcas «limpias» para el eje de precios: 3 a 5 líneas en pasos de 1, 2 o 5. */
export function marcasEje(min, max, objetivo = 4) {
  if (!(max > min)) {
    const v = Math.max(0, Number(min) || 0);
    return [v];
  }
  const bruto = (max - min) / objetivo;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 5, 10].map((k) => k * mag).find((p) => p >= bruto) || 10 * mag;
  const marcas = [];
  for (let v = Math.floor(min / paso) * paso; v <= max + paso * 0.999; v += paso) marcas.push(Math.round(v));
  return marcas;
}
