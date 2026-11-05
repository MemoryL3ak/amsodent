-- (2026-11-05) Alerta de actualización de precio de producto. Pedido de Ariel:
-- "agregar alerta de actualización de precio producto". Cada cambio de costo o
-- de una lista de precios (al editar el producto, en una carga masiva o al
-- deshacer una carga) deja aquí el antes y el después, quién lo hizo y cuándo.
-- Con esto Productos muestra «antes → después» en los precios recién
-- actualizados y la ficha del producto, su historial. El aviso en la campana
-- (tipo `precio_actualizado`) no depende de esta tabla: sale igual sin ella.
create table if not exists public.productos_precio_cambios (
  id            bigserial primary key,
  producto_id   bigint not null,
  sku           text,
  nombre        text,
  campo         text not null check (campo in ('costo', 'lista1', 'lista2', 'lista3')),
  anterior      numeric,
  nuevo         numeric,
  -- edicion | carga_masiva | reversion (deshacer una carga)
  origen        text not null default 'edicion',
  carga_id      bigint,
  usuario_email text,
  created_at    timestamptz not null default now()
);

create index if not exists productos_precio_cambios_producto_idx
  on public.productos_precio_cambios (producto_id, created_at desc);
create index if not exists productos_precio_cambios_fecha_idx
  on public.productos_precio_cambios (created_at desc);

-- Solo el backend (service_role) lee y escribe: sin políticas, RLS lo cierra al resto.
alter table public.productos_precio_cambios enable row level security;
