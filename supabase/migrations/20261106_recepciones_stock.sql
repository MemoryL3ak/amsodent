-- (2026-11-06) Recepción de stock (la de Bsale). Pedido de Ariel: "módulo
-- recepción de Bsale" — «sirve para cargar stock; el stock se carga según
-- Guía, Factura, Despacho interno o sin documentos asociados».
--
-- Una recepción es la cabecera (sucursal, con qué documento llegó, quién la
-- registró) y sus líneas (producto, cantidad y costo neto unitario). Al
-- registrarla el sistema crea la recepción de stock en Bsale
-- (POST /v1/stocks/receptions.json; `bsale_reception_id` guarda su id) y suma
-- las unidades al inventario de la sucursal (movimiento «entrada» del libro).
-- Solo el backend (service_role) lee y escribe: RLS sin políticas.
create table if not exists public.recepciones_stock (
  id                 bigserial primary key,
  -- inventario_sucursales.id y la sucursal de Bsale a la que entró el stock
  sucursal_id        bigint,
  sucursal_nombre    text,
  bsale_office_id    bigint,
  -- guia | factura | despacho_interno | sin_documento
  tipo_documento     text not null check (tipo_documento in ('guia', 'factura', 'despacho_interno', 'sin_documento')),
  documento_numero   text,
  documento_fecha    date,
  proveedor_id       bigint,
  proveedor_nombre   text,
  nota               text,
  total_lineas       integer not null default 0,
  total_unidades     numeric(14,2) not null default 0,
  total_costo        numeric(16,2) not null default 0,
  -- en_proceso (se está enviando a Bsale) | registrada | fallida (Bsale la rechazó)
  estado             text not null default 'en_proceso' check (estado in ('en_proceso', 'registrada', 'fallida')),
  bsale_reception_id bigint,
  error              text,
  usuario_email      text,
  created_at         timestamptz not null default now()
);
create index if not exists recepciones_stock_fecha_idx on public.recepciones_stock (created_at desc);
create index if not exists recepciones_stock_documento_idx on public.recepciones_stock (tipo_documento, documento_numero) where documento_numero is not null;

create table if not exists public.recepcion_stock_lineas (
  id               bigserial primary key,
  recepcion_id     bigint not null references public.recepciones_stock(id) on delete cascade,
  producto_id      bigint not null,
  sku              text,
  nombre           text,
  cantidad         numeric(14,2) not null check (cantidad > 0),
  costo_unitario   numeric(14,2) not null default 0,
  bsale_variant_id bigint,
  created_at       timestamptz not null default now()
);
create index if not exists recepcion_stock_lineas_recepcion_idx on public.recepcion_stock_lineas (recepcion_id);
create index if not exists recepcion_stock_lineas_producto_idx on public.recepcion_stock_lineas (producto_id);

alter table public.recepciones_stock enable row level security;
alter table public.recepcion_stock_lineas enable row level security;
