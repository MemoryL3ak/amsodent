-- Módulo de Despachos Internos con Choferes + Tracking en tiempo real.
--
-- Coexiste con el módulo `despachos` actual (que rastrea guías internas). Aquí
-- modelamos CHOFERES (con credenciales propias del portal, espejo del portal de
-- stock), VIAJES asignados (que vinculan opcionalmente una guía interna por su
-- N° correlativo AMSO, o son viajes libres), la bitácora de estado, el histórico
-- de posiciones GPS y la presencia + última posición materializada para el mapa.
--
-- Todas las tablas con RLS habilitada SIN políticas: el acceso es exclusivamente
-- desde el backend con la service_role key (igual que despachos/stock).

-- 1) Choferes (maestro + credenciales del portal)
create table if not exists public.choferes (
  id                       uuid primary key default gen_random_uuid(),
  rut                      text not null unique,        -- normalizado: dígitos + 'k'
  nombre                   text not null,
  telefono                 text,
  email                    text,
  patente                  text,
  activo                   boolean not null default true,
  -- Credenciales del portal (espejo de stock_clientes_portal)
  acceso_habilitado        boolean not null default false,
  password_hash            text,                        -- scrypt$<salt>$<hash>
  password_temporal        boolean not null default true,
  password_actualizada_en  timestamptz,
  acceso_vigencia          text check (acceso_vigencia is null or acceso_vigencia in ('1m','3m','indefinido')),
  acceso_expira            timestamptz,                 -- null = indefinido
  acceso_habilitado_en     timestamptz,
  acceso_habilitado_por    text,
  ultimo_acceso            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists choferes_activo_idx on public.choferes (activo);

comment on table public.choferes is
  'Choferes/despachadores con acceso propio al portal de despachos internos.';

-- 2) Viajes asignados a un chofer (vinculan una guía interna o son libres)
create table if not exists public.viajes (
  id                       uuid primary key default gen_random_uuid(),
  chofer_id                uuid not null references public.choferes(id) on delete cascade,
  licitacion_documento_id  bigint,                      -- null = viaje libre (sin despacho)
  numero_amso              text,                        -- snapshot de licitacion_documentos.n_seguimiento
  titulo                   text,
  destino_direccion        text,
  destino_comuna           text,
  destino_lat              double precision,
  destino_lng              double precision,
  receptor_nombre          text,
  notas                    text,
  estado                   text not null default 'Asignado'
                             check (estado in ('Asignado','En ruta','Entregado','No entregado','Cancelado')),
  programado_para          timestamptz,
  iniciado_at              timestamptz,
  entregado_at             timestamptz,
  creado_por               text,
  created_at               timestamptz not null default now(),
  actualizado_at           timestamptz not null default now()
);
create index if not exists viajes_chofer_idx on public.viajes (chofer_id);
create index if not exists viajes_estado_idx on public.viajes (estado);
create index if not exists viajes_doc_idx    on public.viajes (licitacion_documento_id);
-- Una guía interna no puede estar en dos viajes activos a la vez.
create unique index if not exists viajes_doc_activo_uniq
  on public.viajes (licitacion_documento_id)
  where licitacion_documento_id is not null and estado in ('Asignado','En ruta');

comment on column public.viajes.numero_amso is
  'N° de despacho (correlativo AMSO) tomado de licitacion_documentos.n_seguimiento al asignar.';

-- 3) Bitácora de estado del viaje
create table if not exists public.viaje_eventos (
  id          uuid primary key default gen_random_uuid(),
  viaje_id    uuid not null references public.viajes(id) on delete cascade,
  estado      text,
  nota        text,
  autor       text,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);
create index if not exists viaje_eventos_idx on public.viaje_eventos (viaje_id, created_at);

-- 4) Histórico GPS (una fila por captura; alimenta el recorrido/polyline)
create table if not exists public.chofer_posiciones (
  id           bigserial primary key,
  chofer_id    uuid not null references public.choferes(id) on delete cascade,
  viaje_id     uuid references public.viajes(id) on delete set null,
  lat          double precision not null,
  lng          double precision not null,
  precision_m  double precision,
  velocidad    double precision,
  rumbo        double precision,
  capturado_at timestamptz not null default now()
);
create index if not exists chofer_posiciones_idx on public.chofer_posiciones (chofer_id, capturado_at desc);

-- 5) Presencia + última posición materializada (snapshot barato para el mapa)
create table if not exists public.chofer_sesiones (
  chofer_id        uuid primary key references public.choferes(id) on delete cascade,
  last_seen_at     timestamptz,
  ultima_lat       double precision,
  ultima_lng       double precision,
  ultima_velocidad double precision,
  ultimo_rumbo     double precision,
  updated_at       timestamptz not null default now()
);

-- 6) Bandeja de solicitudes de recuperación de clave (espejo de stock)
create table if not exists public.chofer_recuperacion_solicitudes (
  id                bigserial primary key,
  rut               text not null,
  nombre            text,
  contacto_email    text,
  contacto_telefono text,
  mensaje           text,
  estado            text not null default 'pendiente' check (estado in ('pendiente','resuelta')),
  resuelta_at       timestamptz,
  resuelta_por      text,
  ip_address        text,
  user_agent        text,
  created_at        timestamptz not null default now()
);
create index if not exists chofer_recuperacion_estado_idx on public.chofer_recuperacion_solicitudes (estado);
create index if not exists chofer_recuperacion_creado_idx on public.chofer_recuperacion_solicitudes (created_at desc);

-- RLS habilitada sin políticas: acceso solo desde el backend (service_role).
alter table public.choferes                        enable row level security;
alter table public.viajes                          enable row level security;
alter table public.viaje_eventos                   enable row level security;
alter table public.chofer_posiciones               enable row level security;
alter table public.chofer_sesiones                 enable row level security;
alter table public.chofer_recuperacion_solicitudes enable row level security;

-- Realtime para el mapa admin y la bandeja de recuperación.
do $$
begin
  begin alter publication supabase_realtime add table public.chofer_sesiones; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.viajes; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.chofer_recuperacion_solicitudes; exception when duplicate_object then null; when undefined_object then null; end;
end $$;
