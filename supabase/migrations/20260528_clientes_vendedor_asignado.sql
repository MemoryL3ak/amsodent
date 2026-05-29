-- Vendedor asignado a un cliente. Al crear un "Cliente Particular" queda
-- anexado al vendedor que lo creó (su email). Es de solo lectura para el
-- usuario; solo el administrador puede reasignarlo.
alter table public.clientes
  add column if not exists vendedor_asignado text;
