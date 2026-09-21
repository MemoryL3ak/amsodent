-- (2026-09-21) Tercer tipo de tienda en el Explorador: Odoo eCommerce.
--
-- Al intentar sumar dos tiendas desde el mantenedor aparecieron dos problemas
-- distintos, que se veían igual (un error rojo en «Probar conexión»):
--
--   · Nexo Dental (nexodental.cl) → devolvía 403 a TODO, incluso a la home.
--     No era la tienda: el firewall de su hosting rechaza los User-Agent con
--     forma "Mozilla/5.0 (compatible; …)" que no estén en su lista blanca, y
--     el del explorador era justo así. Con el UA corregido responde bien.
--     Su /wc/store/v1/products además contesta 200 con cuerpo vacío por un
--     conflicto de plugins, así que entra por el respaldo wp/v2/product.
--
--   · Biotech Chile (biotechchile.cl) → no es Shopify ni WooCommerce: corre
--     sobre Odoo eCommerce, por eso daba 404 con ambos tipos. Odoo no publica
--     una API de búsqueda abierta, pero su vitrina /shop marca cada producto
--     con microdatos schema.org (itemprop price / priceCurrency), que es un
--     contrato estandarizado y estable. De ahí el tipo nuevo.
--
-- Nota histórica: la migración 20260916 dio por inexistente «Biotech.cl». El
-- dominio correcto es biotechchile.cl — el sitio sí existe.
alter table public.explorador_tiendas
  drop constraint if exists explorador_tiendas_tipo_check;

alter table public.explorador_tiendas
  add constraint explorador_tiendas_tipo_check
  check (tipo in ('shopify', 'woo', 'odoo'));

comment on column public.explorador_tiendas.tipo is
  'Vitrina pública desde la que se consulta: shopify (/search/suggest.json), '
  'woo (/wp-json/wc/store/v1/products, con respaldo wp/v2/product) u '
  'odoo (microdatos schema.org de /shop).';

-- Ambas verificadas en vivo el 2026-09-21 con la búsqueda «resina»:
-- 8 resultados con precio correcto cada una.
insert into public.explorador_tiendas (id, nombre, tipo, base_url, activa, orden, nota) values
  ('nexodental', 'Nexo Dental',   'woo',  'https://nexodental.cl',         true, 10,
   'Su Store API responde vacía (conflicto de plugins): entra por el respaldo wp/v2/product.'),
  ('biotech',    'Biotech Chile', 'odoo', 'https://www.biotechchile.cl',   true, 11,
   'Odoo eCommerce: se lee la vitrina /shop por microdatos schema.org. La grilla no informa stock ni precio anterior.')
on conflict (id) do nothing;
