-- Tabla de participantes del sorteo público AMSODENT
-- Se alimenta vía POST /api/sorteo/registrar (endpoint público, sin auth).
-- Solo el backend (service-role) escribe/lee. El frontend público NUNCA la consulta.

create table if not exists public.sorteo_participantes (
  id                      bigserial primary key,
  nombre                  text        not null,
  email                   text        not null,
  tipo_perfil             text        not null check (tipo_perfil in ('estudiante','egresado')),
  universidad_clinica     text,
  conocia_amsodent        boolean     not null default false,
  acepta_uso_datos        boolean     not null default false,
  acepta_comunicaciones   boolean     not null default false,
  ip_origen               text,
  user_agent              text,
  ganador                 boolean     not null default false,
  fecha_ganador           timestamptz,
  created_at              timestamptz not null default now()
);

-- Un email = un cupón de sorteo
create unique index if not exists sorteo_participantes_email_unique
  on public.sorteo_participantes (lower(email));

create index if not exists sorteo_participantes_created_at_idx
  on public.sorteo_participantes (created_at desc);

-- RLS: todo bloqueado. Solo el backend con service-role puede leer/escribir.
alter table public.sorteo_participantes enable row level security;
