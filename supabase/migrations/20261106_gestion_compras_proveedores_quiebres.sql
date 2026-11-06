-- (2026-11-06) Gestión de compras: proveedores por producto y quiebres de stock.
-- Pedidos de Ariel:
--   · "En gestión de compras, añadimos el listado de proveedores y se puede ir
--     seleccionando por producto más de un proveedor. Luego esta selección la
--     llevamos a una nueva pestaña en este mismo módulo llamada «Consolidado
--     Compras»."
--   · "Agregar un botón para declaración de quiebre de stock: se debe
--     seleccionar el producto y adjuntar el documento de respaldo (opcional).
--     Una vez se declare, se debe notificar al vendedor mediante alerta y
--     popup. Adicionalmente esto se debe ir a una pestaña con los productos con
--     quiebre de stock y, cuando se despache, se elimine de ese repositorio."
--
-- Solo el backend (service_role) lee y escribe: RLS sin políticas.

-- 1. A qué proveedores se le va a comprar cada producto de «Por comprar».
--    `clave` es la misma con que Gestión de compras agrupa el producto: el SKU
--    en mayúsculas; «#id:N» para un producto del catálogo sin SKU (N = su id);
--    «#nombre» (en minúsculas) para lo que no está en el catálogo. Una fila
--    por (producto, proveedor): un producto puede tener varios proveedores.
create table if not exists public.gestion_compras_proveedores (
  id            bigserial primary key,
  clave         text not null,
  sku           text,
  producto      text,
  producto_id   bigint,
  proveedor_id  bigint not null,
  usuario_email text,
  created_at    timestamptz not null default now()
);
create unique index if not exists gestion_compras_proveedores_unico_idx
  on public.gestion_compras_proveedores (clave, proveedor_id);
create index if not exists gestion_compras_proveedores_proveedor_idx
  on public.gestion_compras_proveedores (proveedor_id);
alter table public.gestion_compras_proveedores enable row level security;

-- 2. Quiebres de stock declarados. `cotizaciones` guarda las cotizaciones
--    afectadas al declarar ([{id, codigo, cliente, vendedor, vendedor_correo,
--    pendiente}]): el quiebre se resuelve solo cuando todas quedan despachadas
--    (o cerradas) para ese producto, y también se puede quitar a mano.
create table if not exists public.quiebres_stock (
  id             bigserial primary key,
  clave          text not null,
  sku            text,
  producto       text not null,
  producto_id    bigint,
  motivo         text,
  -- cuándo se espera reponer (opcional)
  fecha_estimada date,
  cotizaciones   jsonb not null default '[]'::jsonb,
  -- documento de respaldo (opcional), en el bucket privado `quiebres-stock`
  bucket         text,
  storage_path   text,
  file_name      text,
  mime_type      text,
  size_bytes     bigint,
  estado         text not null default 'activo' check (estado in ('activo', 'resuelto')),
  declarado_por  text,
  created_at     timestamptz not null default now(),
  resuelto_at    timestamptz,
  resuelto_por   text,
  -- despachado (automático) | manual
  resolucion     text
);
create index if not exists quiebres_stock_activos_idx on public.quiebres_stock (clave) where estado = 'activo';
create index if not exists quiebres_stock_fecha_idx on public.quiebres_stock (created_at desc);
alter table public.quiebres_stock enable row level security;

-- Bucket PRIVADO para los respaldos: se entregan con URL firmada desde el backend.
insert into storage.buckets (id, name, public)
values ('quiebres-stock', 'quiebres-stock', false)
on conflict (id) do nothing;
