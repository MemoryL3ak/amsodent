-- (2026-11-05) Recepción de mercadería en el portal del cliente. Pedido de
-- Ariel: "Crear módulo «Recepción», el cual sirve para cargar stock. El stock
-- se carga según Guía, Factura o Despacho Interno o sin documentos asociados".
--
-- Una recepción es la cabecera (con qué documento llegó, cuándo, quién la
-- registró) y sus líneas. Cada línea entra al Inventario del cliente como un
-- LOTE con su costo (stock_lotes_cliente, migración 20261019), así que esta
-- migración REQUIERE la del Inventario por lotes. Las guías, facturas y
-- despachos internos son los que Amsodent le emitió al cliente
-- (licitacion_documentos): `documento_id` permite marcar los ya recibidos.
-- Solo el backend (service_role) lee y escribe: RLS sin políticas.
create table if not exists public.stock_recepciones_cliente (
  id               bigserial primary key,
  rut              text not null,
  sucursal_id      bigint,
  -- guia | factura | despacho_interno | sin_documento
  tipo_documento   text not null check (tipo_documento in ('guia', 'factura', 'despacho_interno', 'sin_documento')),
  -- licitacion_documentos.id cuando el documento es de Amsodent (null si se escribió el número a mano)
  documento_id     bigint,
  documento_numero text,
  documento_fecha  date,
  licitacion_id    bigint,
  fecha            date not null default current_date,
  nota             text,
  usuario_email    text,
  usuario_nombre   text,
  total_lineas     integer not null default 0,
  total_unidades   numeric(14,2) not null default 0,
  total_valor      numeric(16,2) not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists stock_recepciones_cliente_rut_idx on public.stock_recepciones_cliente (rut, id desc);
create index if not exists stock_recepciones_cliente_doc_idx on public.stock_recepciones_cliente (documento_id) where documento_id is not null;

create table if not exists public.stock_recepcion_lineas_cliente (
  id              bigserial primary key,
  recepcion_id    bigint not null references public.stock_recepciones_cliente(id) on delete cascade,
  -- stock_productos_cliente.id (sin FK: el detalle se conserva aunque el producto se quite)
  producto_id     bigint,
  nombre          text not null,
  sku             text,
  cantidad        numeric(14,2) not null check (cantidad > 0),
  costo_unitario  numeric(14,2) not null default 0,
  -- true si el producto se creó en el inventario con esta recepción
  producto_creado boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists stock_recepcion_lineas_cliente_rec_idx on public.stock_recepcion_lineas_cliente (recepcion_id);

alter table public.stock_recepciones_cliente enable row level security;
alter table public.stock_recepcion_lineas_cliente enable row level security;
