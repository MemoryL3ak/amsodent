-- Contacto por sucursal. La "Casa Matriz" por defecto se crea con la dirección
-- y el contacto generales del cliente; cada sucursal adicional puede tener su
-- propio contacto. Columnas opcionales (se llenan al crear/editar la sucursal).
alter table public.stock_sucursales
  add column if not exists contacto text,
  add column if not exists telefono text,
  add column if not exists email    text;
