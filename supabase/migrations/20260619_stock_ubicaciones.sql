-- Ubicaciones de stock por cliente: cada cliente gestiona su propia lista de
-- ubicaciones (bodega, caja, estante, etc.) y la asigna a cada producto.
create table if not exists public.stock_ubicaciones (
  id         bigint generated always as identity primary key,
  rut        text not null,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists stock_ubicaciones_rut_idx on public.stock_ubicaciones (rut);

-- Ubicación asignada a cada producto del catálogo del cliente.
alter table public.stock_productos_cliente add column if not exists ubicacion_id bigint references public.stock_ubicaciones(id) on delete set null;

-- Acceso solo vía backend (service_role). RLS habilitada sin políticas.
alter table public.stock_ubicaciones enable row level security;
