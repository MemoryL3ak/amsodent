/* Notas de crédito y débito que perdieron su factura.

   Una nota emitida desde la app (tiene `bsale_id`) nace colgada de una
   factura concreta: `deriva_de_id` = la factura que anula o ajusta. Si se
   elimina esa factura, la base deja el vínculo en NULL y la nota queda
   "suelta" en la cotización. Seguimiento de Pagos reparte lo suelto en cascada
   sobre las demás facturas, y así una NC que anulaba la factura vieja aparecía
   descontando la factura nueva (casos reales: #4940 factura 925 con la NC 187
   de la 898; #5125 factura 922 con las NC 185 y 186 de la 862).

   Una nota así NO debe descontar ni sumar en ninguna otra factura: en Bsale
   sigue anulando a la original. Las notas cargadas a mano sin vínculo (sin
   `bsale_id`) se siguen repartiendo como siempre. */

export const TIPOS_NOTA = ["nota_credito", "nota_debito"];

/** `tieneFactura(id)` dice si la factura con ese id está en la cotización. */
export function esNotaSinSuFactura(doc, tieneFactura) {
  if (!doc || !TIPOS_NOTA.includes(doc.tipo)) return false;
  if (doc.bsale_id == null) return false;
  return doc.deriva_de_id == null || !tieneFactura(doc.deriva_de_id);
}

/** Notas de crédito/débito colgadas de una factura, entre los documentos de su cotización. */
export function notasDeFactura(docs, factura) {
  const id = Number(factura?.id);
  if (!(id > 0) || !["factura", "factura_boleta"].includes(factura?.tipo)) return [];
  return (docs || []).filter((d) => TIPOS_NOTA.includes(d?.tipo) && Number(d.deriva_de_id) === id);
}

/** "N.C. 185, N.C. 186, N.D. 12" para avisos y toasts. */
export function textoNotas(notas) {
  return (notas || [])
    .map((n) => `${n.tipo === "nota_debito" ? "N.D." : "N.C."} ${n.numero || "s/n"}`)
    .join(", ");
}

/** Aviso para el diálogo de confirmación al eliminar una factura con notas. */
export function avisoEliminarFacturaConNotas(notas) {
  if (!notas?.length) return "";
  const cuantas = notas.length === 1 ? "su nota" : `sus ${notas.length} notas`;
  return ` También se eliminarán de esta cotización ${cuantas} (${textoNotas(notas)}); siguen emitidas en Bsale. Si la factura está anulada, conviene dejarla registrada con sus notas: queda con saldo $0 y no toca a las demás.`;
}
