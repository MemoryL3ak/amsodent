-- Permite que el cliente registre la marca del producto en su declaración.
-- Útil para que el equipo Amsodent identifique exactamente qué se necesita.
alter table public.stock_productos_cliente
  add column if not exists marca text;
