-- Campañas de productos: lista de precios asociada (pedido 2026-09-04).
-- 1 = Lista 1 (default histórico), 2 = Lista 2, 3 = Lista 3 (licitación 9-24 meses).
-- El precio_unitario de referencia de los ítems se toma de esta lista.
alter table if exists public.product_campaigns
  add column if not exists lista_precios smallint not null default 1
  check (lista_precios between 1 and 3);
