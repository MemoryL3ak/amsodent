-- Productos sincronizados con Bsale (2026-10-03).
-- Cuando se crea un producto con SKU o se le asigna un SKU a uno que no tenía,
-- el sistema lo crea en Bsale (producto + variante con ese SKU + precios en las
-- listas WEB-PARTICULAR y PRECIO MP). Acá queda la huella de esa sincronización:
-- qué variante le corresponde en Bsale y, si falló, por qué.
-- El código tolera que estas columnas no existan todavía.
alter table if exists public.productos
  add column if not exists bsale_variant_id bigint,
  add column if not exists bsale_product_id bigint,
  add column if not exists bsale_sync_at    timestamptz,
  add column if not exists bsale_sync_error text;

create index if not exists productos_bsale_variant_idx on public.productos (bsale_variant_id);
