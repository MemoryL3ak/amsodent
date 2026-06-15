-- Datos de Factoring para las facturas pagadas por factoring.
--
-- Una factura (licitacion_documentos.tipo in 'factura','factura_boleta') con
-- forma_pago = 'factoring' llega al submódulo Factoring, donde se registran:
--   - empresa de factoring
--   - comisión en porcentaje (sobre el monto de la factura)
--   - fecha de vencimiento del plazo (alimenta la semaforización)
alter table if exists public.licitacion_documentos
  add column if not exists factoring_empresa       text,
  add column if not exists factoring_comision_pct   numeric,
  add column if not exists factoring_vencimiento     date;
