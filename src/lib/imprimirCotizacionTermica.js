/* Cotización en formato de impresora térmica (2026-10-09). Pedido de Ariel:
   "en la cotización agregar botones para ver modo impresora térmica y tamaño
   carta". El tamaño carta es el PDF de siempre (CotizacionDocument); esto arma
   la misma cotización como ticket de 80 mm en HTML y abre el diálogo de
   impresión del navegador (@page 80 mm, alto libre: el rollo corta donde
   termina). Recibe los mismos `datos` que generarPDFcotizacion. */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function htmlCotizacionTermica(d) {
  const items = Array.isArray(d.items) ? d.items : [];
  const fila = (it) => `
    <div class="it">
      <div class="it-n">${esc(it.n)}. ${esc(it.producto)}${it.sku ? ` <span class="mut">(${esc(it.sku)})</span>` : ""}${it.formato ? ` <span class="mut">· ${esc(it.formato)}</span>` : ""}</div>
      <div class="it-c"><span>${esc(it.cantidad)} × ${esc(it.precio_unitario)}</span><b>${esc(it.total)}</b></div>
      ${it.observacion ? `<div class="it-o">${esc(it.observacion)}</div>` : ""}
    </div>`;
  const linea = (k, v) => (v ? `<div class="l"><span>${esc(k)}</span><span>${esc(v)}</span></div>` : "");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cotización ${esc(d.numero_licitacion)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: 72mm; font: 11px/1.3 Arial, Helvetica, sans-serif; color: #000; margin: 0 auto; }
  h1 { font-size: 14px; margin: 0; text-align: center; letter-spacing: .5px; }
  .c { text-align: center; }
  .mut { color: #444; font-size: 10px; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  .l { display: flex; justify-content: space-between; gap: 6px; }
  .l span:first-child { color: #333; }
  .it { margin: 4px 0; }
  .it-n { font-weight: 700; }
  .it-c { display: flex; justify-content: space-between; }
  .it-o { font-size: 10px; color: #333; padding-left: 8px; }
  .tot .l { font-size: 12px; }
  .tot .l.total { font-size: 14px; font-weight: 700; }
  .pie { font-size: 10px; color: #333; margin-top: 8px; }
  @media screen { body { padding: 12px; box-shadow: 0 0 0 1px #ddd; margin: 16px auto; } }
</style></head><body>
  <h1>AMSODENT MEDICAL SPA</h1>
  <div class="c mut">R.U.T. 78.087.954-8 · 1° Mayo 45, San Bernardo<br>+56 9 4094 3030 · ventas@amsodentmedical.cl</div>
  <div class="sep"></div>
  <div class="c"><b>COTIZACIÓN N° ${esc(d.numero_licitacion)}</b></div>
  ${linea("ID licitación", d.id_licitacion)}
  ${linea("Fecha", d.fecha_creacion || d.fecha_emision)}
  ${linea("Adjudicación", d.fecha_adjudicacion)}
  <div class="sep"></div>
  <div><b>${esc(d.nombre_entidad)}</b></div>
  ${linea("RUT", d.rut_entidad)}
  ${linea("Contacto", d.contacto)}
  ${linea("Email", d.email)}
  ${linea("Teléfono", d.telefono)}
  ${d.direccion || d.comuna ? `<div class="mut">${esc([d.direccion, d.comuna].filter(Boolean).join(", "))}</div>` : ""}
  ${linea("Sucursal", d.sucursal)}
  ${linea("Condición de venta", d.condicion_venta)}
  <div class="sep"></div>
  ${items.map(fila).join("")}
  <div class="sep"></div>
  <div class="tot">
    ${linea("Neto", d.afecto)}
    ${linea("IVA 19%", d.iva)}
    <div class="l total"><span>TOTAL</span><span>${esc(d.total_con_iva)}</span></div>
  </div>
  ${d.observaciones ? `<div class="sep"></div><div class="mut"><b>Observaciones:</b> ${esc(d.observaciones)}</div>` : ""}
  <div class="sep"></div>
  <div class="pie">Vendedor: ${esc(d.vendedor_nombre || "")}${d.vendedor_celular ? ` · ${esc(d.vendedor_celular)}` : ""}${d.vendedor_correo ? `<br>${esc(d.vendedor_correo)}` : ""}</div>
  <div class="pie c">Cotización · no es un documento tributario</div>
  <script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 150); });</script>
</body></html>`;
}

export async function imprimirCotizacionTermica(datos) {
  const html = htmlCotizacionTermica(datos);
  const w = window.open("", "_blank", "width=420,height=760");
  if (!w) throw new Error("El navegador bloqueó la ventana de impresión: permite las ventanas emergentes para este sitio.");
  w.document.open();
  w.document.write(html);
  w.document.close();
}
