-- Proveedores: marcas que distribuye + palabras clave (pedido 2026-09-04).
-- Las marcas son texto libre (mismo universo que productos.marca); las
-- palabras clave ayudan a buscar/clasificar proveedores.
alter table public.proveedores
  add column if not exists marcas text[] not null default '{}',
  add column if not exists palabras_clave text[] not null default '{}';
