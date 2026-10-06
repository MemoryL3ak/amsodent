-- (2026-10-06) La web de Amsodent dejó de ser WooCommerce.
-- amsodentmedical.cl se rehízo como tienda propia (Next.js): su /wp-json ya no
-- existe y la tienda Amsodent quedó fuera del Explorador de precios (portal y
-- plataforma). El explorador ahora la lee con un tipo propio, "amsodent":
-- la grilla de /catalogo?q=… y la ficha /producto/<slug> de cada resultado
-- (SKU real y variantes). El código ya reconoce la tienda por su id, así que
-- esta migración solo deja la fila y la restricción al día.
alter table public.explorador_tiendas
  drop constraint if exists explorador_tiendas_tipo_check;

alter table public.explorador_tiendas
  add constraint explorador_tiendas_tipo_check
  check (tipo in ('shopify', 'woo', 'odoo', 'amsodent'));

comment on column public.explorador_tiendas.tipo is
  'Vitrina pública desde la que se consulta: shopify (/search/suggest.json), '
  'woo (/wp-json/wc/store/v1/products, con respaldo wp/v2/product), '
  'odoo (microdatos schema.org de /shop) o amsodent (web propia: /catalogo y fichas).';

update public.explorador_tiendas
   set tipo = 'amsodent',
       updated_at = now()
 where id = 'amsodent';
