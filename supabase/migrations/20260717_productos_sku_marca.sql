-- "SKU Marca": código/SKU propio del fabricante o marca (distinto del SKU
-- interno de Amsodent). Opcional.
alter table public.productos
  add column if not exists sku_marca text;
