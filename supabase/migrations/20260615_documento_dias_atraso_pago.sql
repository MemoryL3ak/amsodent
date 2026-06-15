-- Días de atraso de pago de la factura, calculados al marcarla pagada:
--   dias_atraso_pago = fecha_pago - fecha_vencimiento (fecha_factura + plazo condición de venta)
-- Positivo = pagó con atraso; 0 = al día; negativo = pagó antes del vencimiento.
-- Se guarda para analizar después cuántos días se demora cada cliente en pagar.
alter table if exists public.licitacion_documentos
  add column if not exists dias_atraso_pago integer;
