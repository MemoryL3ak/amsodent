-- (2026-10-02) Pago del cliente particular en Seguimiento de Pagos: plan de
-- cuotas con su valor y detalle de cada pago.
--   · `valor_cuota` va en la FACTURA / boleta, en bruto: cuánto paga el
--     cliente en cada cuota. Junto con `cuotas_total` (migración 20261001) y
--     `forma_pago` forma el plan de pago; si queda vacío, la pantalla usa el
--     total a cobrar dividido en las cuotas.
--   · `detalle_pago` va en el COMPROBANTE: glosa libre de cada pago o cuota
--     ingresada (la fecha y el monto ya tenían columna: `fecha_oc` y `monto`).
-- El backend tolera que las columnas no existan aún (las quita del payload y
-- reintenta): el pago se registra igual, solo que sin estos dos datos.
alter table public.licitacion_documentos
  add column if not exists valor_cuota  numeric,
  add column if not exists detalle_pago text;
