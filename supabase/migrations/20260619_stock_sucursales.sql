-- Catálogos de stock por SUCURSAL: un mismo cliente (RUT) puede tener varias
-- sucursales (cada una con su dirección) y un catálogo/declaraciones por
-- sucursal. Las solicitudes de cotización también quedan asociadas a la sucursal.

-- 1) Sucursales del cliente.
create table if not exists public.stock_sucursales (
  id         bigint generated always as identity primary key,
  rut        text not null,
  nombre     text not null,
  direccion  text,
  comuna     text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists stock_sucursales_rut_idx on public.stock_sucursales (rut);
alter table public.stock_sucursales enable row level security;

-- 2) Asociación por sucursal en catálogo, declaraciones y solicitudes.
alter table if exists public.stock_productos_cliente
  add column if not exists sucursal_id bigint references public.stock_sucursales(id) on delete set null;
alter table if exists public.stock_declaraciones
  add column if not exists sucursal_id bigint references public.stock_sucursales(id) on delete set null;
alter table if exists public.stock_solicitudes_cotizacion
  add column if not exists sucursal_id bigint references public.stock_sucursales(id) on delete set null;

create index if not exists stock_productos_cliente_sucursal_idx on public.stock_productos_cliente (sucursal_id);
create index if not exists stock_declaraciones_sucursal_idx on public.stock_declaraciones (sucursal_id);
create index if not exists stock_solicitudes_sucursal_idx on public.stock_solicitudes_cotizacion (sucursal_id);

-- 3) Migración de datos existentes: una sucursal "Casa Matriz" por cada cliente
--    que ya tenga productos / declaraciones / solicitudes, y se le asignan.
insert into public.stock_sucursales (rut, nombre)
select t.rut, 'Casa Matriz'
from (
  select distinct rut from public.stock_productos_cliente where rut is not null
  union
  select distinct rut from public.stock_declaraciones where rut is not null
  union
  select distinct rut from public.stock_solicitudes_cotizacion where rut is not null
) t
where not exists (select 1 from public.stock_sucursales s where s.rut = t.rut);

update public.stock_productos_cliente p
  set sucursal_id = s.id
  from public.stock_sucursales s
  where s.rut = p.rut and s.nombre = 'Casa Matriz' and p.sucursal_id is null;

update public.stock_declaraciones d
  set sucursal_id = s.id
  from public.stock_sucursales s
  where s.rut = d.rut and s.nombre = 'Casa Matriz' and d.sucursal_id is null;

update public.stock_solicitudes_cotizacion q
  set sucursal_id = s.id
  from public.stock_sucursales s
  where s.rut = q.rut and s.nombre = 'Casa Matriz' and q.sucursal_id is null;
