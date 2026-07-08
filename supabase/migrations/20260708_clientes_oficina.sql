-- Campo "oficina" (sucursal/oficina del cliente) para poder segmentar clientes
-- por oficina, además de región / comuna / dirección (que ya existían).
-- Se usa en el alta rápida de cliente desde la bitácora. El backend tolera que
-- esta columna aún no exista, así que la app funciona antes y después de aplicar
-- esta migración.
alter table public.clientes
  add column if not exists oficina text;
