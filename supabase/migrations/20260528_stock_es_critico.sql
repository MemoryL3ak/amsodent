-- Permite que el cliente marque productos como "críticos para su operación".
-- Es independiente del semáforo de stock: identifica importancia, no nivel.
-- Cuando un producto crítico cae en alerta, el equipo lo trata con prioridad.
alter table public.stock_productos_cliente
  add column if not exists es_critico boolean not null default false;
