-- (2026-09-10) Mantenedor de tiendas del Explorador de Precios del portal.
-- Las tiendas consultadas dejan de estar fijas en el código: el admin las
-- administra desde la plataforma (Acceso Portal Clientes → Tiendas del
-- Explorador). Solo se soportan tiendas con API pública de búsqueda:
--   · shopify → /search/suggest.json
--   · woo     → /wp-json/wc/store/v1/products
-- El botón "Probar" del mantenedor permite verificar si una página responde
-- antes de activarla. RLS sin políticas: solo el backend (service_role).
create table if not exists public.explorador_tiendas (
  id text primary key,
  nombre text not null,
  tipo text not null check (tipo in ('shopify', 'woo')),
  base_url text not null,
  activa boolean not null default true,
  orden int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.explorador_tiendas enable row level security;

-- Seed con las tiendas vigentes (amsodent SIEMPRE primera y protegida:
-- el mantenedor no permite eliminarla ni desactivarla).
insert into public.explorador_tiendas (id, nombre, tipo, base_url, orden) values
  ('amsodent',    'Amsodent',     'woo',     'https://amsodentmedical.cl',  0),
  ('orbisdental', 'Orbis Dental', 'shopify', 'https://www.orbisdental.cl',  1),
  ('gexachile',   'Gexa Chile',   'shopify', 'https://gexachile.cl',        2),
  ('spdental',    'SP Dental',    'shopify', 'https://spdental.shop',       3),
  ('clandent',    'Clandent',     'woo',     'https://clandent.cl',         4),
  ('jdent',       'J-Dent',       'woo',     'https://www.j-dent.cl',       5),
  ('techdent',    'Techdent',     'woo',     'https://techdent.cl',         6),
  ('denteeth',    'Denteeth',     'woo',     'https://denteeth.cl',         7)
on conflict (id) do nothing;
