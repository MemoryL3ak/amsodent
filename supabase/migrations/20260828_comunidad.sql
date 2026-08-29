-- Comunidad Amsodent (portal público /comunidad, al que apunta el QR).
-- Registro público con rate-limit en el backend; correo único por persona.
-- perfil: 'estudiante' (con año y universidad) o 'dentista' (con especialidad).
-- correo_enviado marca si el correo de bienvenida salió bien (el registro
-- vale aunque el correo falle; se reenvía desde el submódulo admin).

create table if not exists public.comunidad_registros (
  id bigserial primary key,
  nombre text not null,
  apellido text not null,
  telefono text not null,
  correo text not null unique,
  perfil text not null check (perfil in ('estudiante', 'dentista')),
  anio_estudio text,        -- solo estudiantes (1° año … Egresado/a)
  universidad text,         -- solo estudiantes
  especialidad text,        -- solo dentistas
  ciudad text,
  como_conociste text,
  origen text,              -- evento/campaña del QR (ej: congreso-adeo-uv-2026)
  acepta_datos boolean not null default false,  -- consentimiento Ley 19.628
  acepta_datos_at timestamptz,                  -- cuándo lo otorgó
  correo_enviado boolean not null default false,
  ip_origen text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Guardas por si la tabla ya se creó sin estas columnas.
alter table public.comunidad_registros add column if not exists origen text;
alter table public.comunidad_registros add column if not exists acepta_datos boolean not null default false;
alter table public.comunidad_registros add column if not exists acepta_datos_at timestamptz;

alter table public.comunidad_registros enable row level security;
