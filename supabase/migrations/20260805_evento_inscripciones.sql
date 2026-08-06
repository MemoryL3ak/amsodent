-- Inscripciones al evento AMSODENT (portal público /evento).
-- Registro público con rate-limit en el backend; correo único por persona.
-- correo_enviado marca si la confirmación por email salió bien (el registro
-- vale aunque el correo falle).

create table if not exists public.evento_inscripciones (
  id bigserial primary key,
  nombre text not null,
  apellido text not null,
  telefono text not null,
  correo text not null unique,
  especialidad text not null,
  es_profesor boolean not null default false,
  universidad text,
  confirma_asistencia boolean not null default false,
  correo_enviado boolean not null default false,
  ip_origen text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.evento_inscripciones enable row level security;
