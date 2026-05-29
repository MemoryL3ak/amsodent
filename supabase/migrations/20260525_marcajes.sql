-- Módulo de marcaje de entrada/salida de trabajadores con geolocalización.
-- Crea dos tablas:
--   - marcaje_oficinas: oficinas autorizadas con su radio de tolerancia
--   - marcajes: cada evento de entrada/salida con coords del trabajador

-- ============================================================
-- Tabla: marcaje_oficinas
-- ============================================================
create table if not exists public.marcaje_oficinas (
  id              bigserial primary key,
  nombre          text not null,
  latitud         double precision not null,
  longitud        double precision not null,
  radio_metros    integer not null default 200,
  activa          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Placeholder inicial (centro de Santiago) — el admin lo edita desde la UI.
insert into public.marcaje_oficinas (nombre, latitud, longitud, radio_metros, activa)
select 'Oficina principal', -33.4489, -70.6693, 200, true
where not exists (select 1 from public.marcaje_oficinas);

-- ============================================================
-- Tabla: marcajes
-- ============================================================
create table if not exists public.marcajes (
  id              bigserial primary key,
  user_email      text not null,
  user_nombre     text,
  tipo            text not null check (tipo in ('entrada', 'salida')),
  marcado_at      timestamptz not null default now(),

  -- Geolocalización tomada del navegador del trabajador
  latitud         double precision,
  longitud        double precision,
  accuracy_m      double precision,

  -- Distancia a la oficina más cercana (en metros) y flag de fuera de radio
  oficina_id      bigint references public.marcaje_oficinas(id) on delete set null,
  distancia_m     double precision,
  fuera_de_radio  boolean not null default false,

  -- Dirección resuelta via reverse geocoding (Nominatim) al momento del marcaje.
  -- Se guarda denormalizada para no depender de servicios externos al consultar.
  direccion       text,

  -- Info auxiliar
  user_agent      text,
  ip_address      text,

  created_at      timestamptz not null default now()
);

create index if not exists marcajes_user_email_idx on public.marcajes (user_email);
create index if not exists marcajes_marcado_at_idx on public.marcajes (marcado_at desc);
create index if not exists marcajes_tipo_idx       on public.marcajes (tipo);

-- ============================================================
-- RLS
-- ============================================================
alter table public.marcaje_oficinas enable row level security;
alter table public.marcajes         enable row level security;

-- Oficinas: lectura para autenticados, escritura solo backend (service role).
drop policy if exists "marcaje_oficinas select autenticados" on public.marcaje_oficinas;
create policy "marcaje_oficinas select autenticados"
  on public.marcaje_oficinas
  for select
  to authenticated
  using (true);

-- Marcajes: cada usuario lee los suyos; el backend con service_role escribe e
-- inserta para todos. Los admins leen todo vía el backend (service_role bypass).
drop policy if exists "marcajes select propios" on public.marcajes;
create policy "marcajes select propios"
  on public.marcajes
  for select
  to authenticated
  using (lower(user_email) = lower((auth.jwt() ->> 'email')));

-- ============================================================
-- Realtime — opcional, útil si el monitoreo quiere actualizar live
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'marcajes'
  ) then
    alter publication supabase_realtime add table public.marcajes;
  end if;
end $$;
