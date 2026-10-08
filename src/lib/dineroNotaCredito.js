/* ── Dinero de las notas de crédito (2026-10-08) ────────────────────────────
   La misma cuenta que DevolucionesService en el servidor (si cambia una
   fórmula, cambiar las dos): lo que la NC dejó en manos del cliente = su monto,
   hasta lo pagado que no salió por otras notas; pendiente = eso − devuelto −
   aplicado. `usosPorNc` son los pagos (de cualquier cotización) con
   origen_doc_id = la NC: saldos a favor ya aplicados. */

const bruto = (neto) => Math.round((Number(neto) || 0) * 1.19);
const suma = (l) => l.reduce((a, d) => a + (Number(d?.monto) || 0), 0);

export const PAGOS = ["comprobante_pago", "webpay", "efectivo"];
export const ETIQUETA_DINERO = {
  devolver: "Devolver el dinero",
  saldo_favor: "Saldo a favor del cliente",
  rebajar_deuda: "Rebaja de deuda (no había pago)",
  sin_movimiento: "Sin movimiento de dinero",
};

export function dineroDeFactura(f, docs, usosPorNc = {}) {
  const facturas = docs.filter((d) => d.tipo === "factura" || d.tipo === "factura_boleta");
  const ids = new Set(facturas.map((x) => x.id));
  const unica = facturas.length === 1;
  const deFactura = (d) => d.deriva_de_id === f.id || (unica && (d.deriva_de_id == null || !ids.has(d.deriva_de_id)));
  const pagos = docs.filter((d) => PAGOS.includes(d.tipo) && deFactura(d));
  const devoluciones = docs.filter((d) => d.tipo === "devolucion" && deFactura(d));
  const ncs = docs.filter((d) => d.tipo === "nota_credito" && d.deriva_de_id === f.id);
  const pagadoBruto = bruto(suma(pagos));
  const usosTodos = ncs.flatMap((n) => usosPorNc[n.id] || []);
  const notas = ncs.map((nc) => {
    const propias = (l) => l.filter((d) => d.origen_doc_id === nc.id);
    const ajenas = (l) => l.filter((d) => d.origen_doc_id !== nc.id);
    const devuelto = bruto(suma(propias(devoluciones)));
    const usado = bruto(suma(usosPorNc[nc.id] || []));
    const salidasAjenas = bruto(suma(ajenas(devoluciones))) + bruto(suma(ajenas(usosTodos)));
    const base = Math.max(0, Math.min(Number(nc.monto) || 0, pagadoBruto - salidasAjenas));
    const disponible = Math.max(0, base - devuelto - usado);
    const dinero = ETIQUETA_DINERO[nc.dinero] ? nc.dinero : null;
    return { nc, dinero, base, devuelto, usado, disponible, devoluciones: propias(devoluciones), usos: usosPorNc[nc.id] || [] };
  });
  return {
    pagadoBruto,
    devueltoBruto: bruto(suma(devoluciones)),
    notas,
    pendienteDevolver: notas.filter((n) => n.dinero === "devolver").reduce((a, n) => a + n.disponible, 0),
    saldoFavor: notas.filter((n) => n.dinero === "saldo_favor").reduce((a, n) => a + n.disponible, 0),
    // NC sin decisión (hecha antes de esto, o cargada a mano) con dinero del cliente en el aire.
    sinDecision: notas.filter((n) => !n.dinero).reduce((a, n) => a + n.disponible, 0),
  };
}
