-- Explorador de productos (2026-10-09): región de cada tienda.
-- Pedido de Ariel: "agregar filtro región cliente en tiendas del explorador".
-- NULL = la tienda vende a todo Chile (se muestra siempre). Con región, solo
-- se consulta para clientes de esa región (portal) o cuando en la plataforma
-- se elige esa región. Los nombres son los de clientes.region
-- ("Metropolitana de Santiago", "Valparaíso", …); se comparan sin tildes ni
-- mayúsculas. El código tolera que la columna no exista.
alter table public.explorador_tiendas
  add column if not exists region text;
comment on column public.explorador_tiendas.region is
  'Región de Chile a la que vende la tienda; NULL = todas';
