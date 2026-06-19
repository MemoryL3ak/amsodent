-- Enlace solicitud (portal cliente) ↔ cotización (licitación) + hilo de mensajes.
-- Cuando se crea una cotización a partir de una solicitud del cliente, quedan
-- conectadas: el cliente ve en su portal la cotización generada, su estado, el
-- PDF, y puede conversar con el equipo (mensajes bidireccionales).

alter table if exists public.licitaciones
  add column if not exists solicitud_stock_id bigint;

alter table if exists public.stock_solicitudes_cotizacion
  add column if not exists licitacion_id bigint;

create index if not exists licitaciones_solicitud_stock_idx
  on public.licitaciones (solicitud_stock_id);
create index if not exists stock_solicitudes_licitacion_idx
  on public.stock_solicitudes_cotizacion (licitacion_id);

-- Hilo de mensajes por solicitud (cliente ↔ equipo).
create table if not exists public.stock_cotizacion_mensajes (
  id            bigint generated always as identity primary key,
  solicitud_id  bigint not null references public.stock_solicitudes_cotizacion(id) on delete cascade,
  autor_tipo    text not null,            -- 'cliente' | 'equipo'
  autor_email   text,
  autor_nombre  text,
  mensaje       text not null,
  leido_cliente boolean not null default false,
  leido_equipo  boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists stock_cot_mensajes_solicitud_idx
  on public.stock_cotizacion_mensajes (solicitud_id, created_at);

-- Acceso solo vía backend (service_role). RLS habilitada sin políticas.
alter table public.stock_cotizacion_mensajes enable row level security;
