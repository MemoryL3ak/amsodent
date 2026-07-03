-- Órdenes de compra a proveedores. Se crean desde un submódulo (admin y
-- jefe_ventas), con número correlativo, datos del proveedor/vendedor, detalle
-- de productos (jsonb) y totales. Se exportan a PDF con el formato de la marca.
create table if not exists public.ordenes_compra (
  id                     bigserial primary key,
  numero                 int not null,
  fecha_emision          date,
  proveedor_razon_social text default '',
  proveedor_rut          text default '',
  proveedor_correo       text default '',
  vendedor_nombre        text default '',
  vendedor_correo        text default '',
  items                  jsonb not null default '[]'::jsonb,
  subtotal_neto          numeric default 0,
  iva                    numeric default 0,
  total                  numeric default 0,
  observaciones          text default '',
  creado_por             text,
  created_at             timestamptz not null default now()
);

create unique index if not exists ordenes_compra_numero_key
  on public.ordenes_compra (numero);
