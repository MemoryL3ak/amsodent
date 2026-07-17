-- Sucursales del portal de stock: separación entre "registrada" y "habilitada
-- para el portal". Ahora las sucursales se registran en la vista 360 del cliente
-- (quedan deshabilitadas) y el admin las habilita en "Acceso al Portal del
-- Cliente" para que aparezcan en el portal.
alter table public.stock_sucursales
  add column if not exists habilitada_portal boolean not null default false;

-- Las sucursales ya existentes estaban en uso en el portal → se dejan habilitadas
-- para no romper el comportamiento actual.
update public.stock_sucursales set habilitada_portal = true where activo = true;
