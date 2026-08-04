-- Corrección de datos: documentos de pago guardados en BRUTO → NETO.
--
-- Convención definitiva: los documentos de pago (comprobante_pago, webpay,
-- efectivo) guardan su monto en NETO, igual que la factura/boleta (así los
-- pide el formulario de Detalle Licitación). Seguimiento de Pagos los
-- convierte a bruto (× 1,19) al calcular "Pagado" y "Saldo por pagar".
--
-- El problema: la versión anterior de Seguimiento de Pagos ("Registrar pago"
-- y "Subir comprobante") guardaba el monto digitado en BRUTO. Si alguno de
-- esos pagos quedó registrado, hoy quedaría inflado (bruto × 1,19).
--
-- Esta migración convierte a neto (÷ 1,19) SOLO los documentos de pago cuyo
-- monto coincide exactamente con el BRUTO de la factura/boleta asociada
-- (round(neto × 1,19)): esa es la firma de "pago completo registrado en
-- bruto". Un comprobante correcto (neto) nunca puede valer el bruto de su
-- factura, así que no hay falsos positivos. Pagos PARCIALES guardados en
-- bruto no se pueden distinguir de netos: se corrigen a mano editando el
-- documento en la ficha de la cotización.

update licitacion_documentos p
set monto = f.monto
from licitacion_documentos f
where p.tipo in ('comprobante_pago', 'webpay', 'efectivo')
  and p.deriva_de_id = f.id
  and f.tipo = 'factura_boleta'
  and f.monto is not null
  and f.monto > 0
  and p.monto = round(f.monto * 1.19);
