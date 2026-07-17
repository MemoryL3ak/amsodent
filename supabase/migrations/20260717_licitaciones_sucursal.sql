-- Sucursal del cliente asociada a la cotización. Se elige en el formulario de
-- creación/edición y sirve para poblar la dirección de despacho. Se muestra en
-- el PDF de la cotización. Texto libre (nombre de la sucursal).
alter table public.licitaciones
  add column if not exists sucursal text;
