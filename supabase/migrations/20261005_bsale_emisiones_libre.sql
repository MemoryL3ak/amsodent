-- Guías y facturas libres en Bsale (2026-10-03): un documento armado a mano
-- puede no colgar de ninguna cotización, así que la emisión se registra sin
-- licitacion_id.
alter table if exists public.bsale_emisiones
  alter column licitacion_id drop not null;
