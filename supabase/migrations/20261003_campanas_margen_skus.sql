-- Campañas de margen por SKU (2026-10-02).
-- Además de marcas y categorías, una campaña puede apuntar a productos
-- concretos por su SKU. Vacío = sin filtro por SKU. Si hay SKUs y también
-- marcas o categorías, el producto debe cumplir todo.
alter table if exists public.campanas_margen
  add column if not exists skus jsonb not null default '[]'::jsonb;
