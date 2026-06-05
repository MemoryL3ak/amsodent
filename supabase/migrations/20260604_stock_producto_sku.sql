-- SKU/código opcional para los productos que el cliente declara en su catálogo
-- de stock del portal. Permite identificar el producto con un código propio.
alter table public.stock_productos_cliente
  add column if not exists sku text;

comment on column public.stock_productos_cliente.sku is 'Código/SKU opcional del producto declarado por el cliente en el portal de stock.';
