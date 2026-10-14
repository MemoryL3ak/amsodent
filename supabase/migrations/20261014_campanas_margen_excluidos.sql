-- Campañas de margen (2026-10-14): productos desmarcados.
-- Pedido de Ariel: "al crear campaña de margen que todos aparezcan con un check
-- pero que permita descheckearlo". La campaña sigue guardando la REGLA (marcas,
-- categorías, SKUs); los productos que se desmarcan quedan acá por SKU y no
-- reciben el descuento aunque la regla los alcance. Sin la migración, el
-- código guarda la campaña sin la lista (lo avisa) y aplica a todos.
alter table if exists public.campanas_margen
  add column if not exists skus_excluidos jsonb not null default '[]'::jsonb;
