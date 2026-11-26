-- Pedidos de la tienda web amsodentmedical.cl (2026-11-26).
--
-- La tienda manda cada pedido PAGADO (Webpay aprobado o transferencia marcada
-- como recibida) a POST /api/tienda-web/pedidos y el sistema emite su boleta o
-- factura en Bsale como una venta directa. Una fila por pedido: `pedido` es
-- único, así un reenvío (reintento de la tienda, doble clic) nunca produce un
-- segundo documento: si ya está emitida se devuelve la misma.
--
-- estado: recibido | emitiendo | emitida | simulada | error | incierta
--   simulada  = BSALE_EMISION=off: se armó y validó pero no se envió a Bsale.
--   error     = Bsale o la validación lo rechazó; la tienda puede reintentar
--               después de corregir (p. ej. un SKU que no estaba en Bsale).
--   incierta  = Bsale no respondió: NO se reintenta solo; alguien revisa en
--               Bsale si el documento salió (mismo criterio que bsale_emisiones).

create table if not exists public.pedidos_tienda_web (
  id              bigserial primary key,
  pedido          text        not null unique,   -- N° de la tienda, p. ej. AMS-2026-0031
  estado          text        not null default 'recibido',
  tipo            text,                          -- boleta | factura
  intentos        integer     not null default 0,
  entrada         jsonb,                         -- lo que mandó la tienda (último intento)
  solicitud       jsonb,                         -- lo que se le mandó (o mandaría) a Bsale
  problemas       jsonb,
  avisos          jsonb,
  error           text,
  sales_id        text,                          -- bsale_emisiones.sales_id
  bsale_id        bigint,
  numero          text,                          -- folio del documento
  url_pdf         text,
  total_tienda    integer,                       -- total con IVA que cobró la tienda
  total_documento numeric,                       -- total del documento según Bsale
  cotizacion_id   bigint,                        -- licitaciones.id creada por la venta directa
  documento_id    bigint,                        -- licitacion_documentos.id
  guia_numero     text,
  emitido_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pedidos_tienda_web_estado_idx on public.pedidos_tienda_web (estado);

-- Solo el backend (service role) la lee y escribe.
alter table public.pedidos_tienda_web enable row level security;
