-- Emisión de facturas en Bsale desde el sistema (2026-10-02).
--
-- Registro de cada intento de emisión: quién, cuándo, qué se le envió a Bsale
-- y qué respondió. `sales_id` es el identificador que Bsale usa para no
-- duplicar una factura si el envío se reintenta; por eso es único. Sin esta
-- tabla el sistema NO emite (solo simula).
--
-- estado: enviando | emitida | error | incierta
--   incierta = Bsale no respondió; no se sabe si alcanzó a emitir. El
--   reintento usa el mismo sales_id, así que no duplica.

create table if not exists public.bsale_emisiones (
  id            bigserial primary key,
  sales_id      text        not null unique,
  clave         text        not null,          -- cotización + guías (sin el contador)
  licitacion_id bigint      not null,
  guias_doc_ids bigint[]    not null default '{}',
  estado        text        not null default 'enviando',
  solicitud     jsonb,
  respuesta     jsonb,
  error         text,
  bsale_id      bigint,
  numero        text,
  neto          numeric,
  total         numeric,
  url_pdf       text,
  fecha_emision date,
  documento_id  bigint,                         -- licitacion_documentos.id de la factura
  usuario       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bsale_emisiones_clave_idx on public.bsale_emisiones (clave);
create index if not exists bsale_emisiones_licitacion_idx on public.bsale_emisiones (licitacion_id);

-- Solo el backend (service role) la lee y escribe.
alter table public.bsale_emisiones enable row level security;

-- La factura emitida queda como documento de la cotización, con su vínculo a Bsale.
alter table if exists public.licitacion_documentos
  add column if not exists bsale_id  bigint,
  add column if not exists bsale_url text;
