-- (2026-09-16) Tiendas nuevas del Explorador + nota del mantenedor.
--
-- Pedido: sumar Dentallaval.cl, Clandent, Dentica.cl, Mayordent y Biotech.cl.
-- Al probar una por una contra su API pública (2026-09-16) el resultado fue:
--   · Clandent      → ya estaba configurada (WooCommerce).
--   · Dentica.cl    → WooCommerce, responde bien  ⇒ se agrega ACTIVA.
--   · Mayordent.cl  → existe, pero está detrás del desafío de Cloudflare
--                     ("Just a moment…"): devuelve 403 a cualquier consulta
--                     automática ⇒ se deja registrada pero INACTIVA.
--   · Dentallaval.cl y Biotech.cl → los dominios no existen (NXDOMAIN); el
--                     parecido dentalaval.cl responde 403 sin API y
--                     biotechdental.cl es un WordPress de demostración
--                     ⇒ no se siembran. Si aparecen, se agregan desde el
--                     mantenedor con el botón «Probar conexión».
--
-- La columna `nota` existe justo para eso: dejar escrito por qué una tienda
-- está inactiva, para que no se vuelva a intentar a ciegas.
alter table public.explorador_tiendas
  add column if not exists nota text;

comment on column public.explorador_tiendas.nota is
  'Nota del mantenedor: por qué la tienda está inactiva o qué ojo hay que tener con ella.';

insert into public.explorador_tiendas (id, nombre, tipo, base_url, activa, orden, nota) values
  ('dentica', 'Dentica', 'woo', 'https://dentica.cl', true, 8, null),
  ('mayordent', 'Mayordent', 'woo', 'https://www.mayordent.cl', false, 9,
   'Protegida por Cloudflare: responde 403 («Just a moment…») a las consultas del explorador. No se puede consultar automáticamente.')
on conflict (id) do nothing;
