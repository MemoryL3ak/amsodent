-- (2026-11-09) Lotes y fechas de vencimiento. Pedido de Ariel:
--   1. «cuando cargamos una nueva recepción, se debe ingresar el lote y fecha
--      de vencimiento por producto»
--   2. «cuando se genere una guía de despacho asociada a estos productos, se
--      debe en cada producto desplegar un listbox con sus lotes y fechas de
--      vencimiento, para permitir seleccionar una o más opciones»
--   «la fecha de vencimiento y lote van asociados»
--
-- La API de Bsale no maneja lotes en recepciones ni en guías: el lote vive acá.
-- En la guía de Bsale sale escrito en la nota de la línea de cada producto
-- (lo mismo que imprime el formato carta).
--
-- · inventario_lotes: un lote = producto + código de lote + vencimiento (el
--   mismo código con otra fecha es otro lote). Nace al registrar una recepción.
-- · recepcion_stock_lineas gana lote, vencimiento y lote_id: lo RECIBIDO de
--   cada lote es la suma de las líneas enlazadas (solo se enlazan las de
--   recepciones que Bsale aceptó).
-- · inventario_lote_salidas: lo que cada guía emitida sacó de cada lote. Al
--   anular la guía en Bsale la salida queda con anulada_at y las unidades
--   vuelven a estar disponibles.
-- Disponible = recibido − salidas vigentes (se calcula al leer; sin contadores).
-- Solo el backend (service_role) lee y escribe: RLS sin políticas.

alter table public.recepcion_stock_lineas add column if not exists lote text;
alter table public.recepcion_stock_lineas add column if not exists vencimiento date;
alter table public.recepcion_stock_lineas add column if not exists lote_id bigint;
create index if not exists recepcion_stock_lineas_lote_idx on public.recepcion_stock_lineas (lote_id) where lote_id is not null;

create table if not exists public.inventario_lotes (
  id           bigserial primary key,
  producto_id  bigint not null,
  -- SKU en mayúsculas y sin espacios (así lo buscan las guías)
  sku          text not null,
  -- código del lote en mayúsculas, sin espacios repetidos
  lote         text not null,
  vencimiento  date not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists inventario_lotes_unico on public.inventario_lotes (producto_id, lote, vencimiento);
create index if not exists inventario_lotes_sku_idx on public.inventario_lotes (sku);

create table if not exists public.inventario_lote_salidas (
  id                bigserial primary key,
  lote_id           bigint not null references public.inventario_lotes(id) on delete cascade,
  producto_id       bigint,
  sku               text,
  lote              text,
  vencimiento       date,
  cantidad          numeric(14,2) not null check (cantidad > 0),
  -- guia_oc (desde la orden de compra) | guia_libre | guia_venta_directa
  origen            text not null,
  bsale_document_id bigint,
  guia_numero       text,
  licitacion_id     bigint,
  documento_id      bigint,
  usuario_email     text,
  anulada_at        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists inventario_lote_salidas_lote_idx on public.inventario_lote_salidas (lote_id);
create index if not exists inventario_lote_salidas_doc_idx on public.inventario_lote_salidas (bsale_document_id) where bsale_document_id is not null;

alter table public.inventario_lotes enable row level security;
alter table public.inventario_lote_salidas enable row level security;
