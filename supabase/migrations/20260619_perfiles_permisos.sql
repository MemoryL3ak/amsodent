-- Perfiles de permisos (RBAC configurable). Un perfil define a qué módulos
-- tiene acceso; se asigna a un usuario. Si un usuario no tiene perfil asignado,
-- su acceso se deriva del rol (comportamiento previo, retrocompatible).
create table if not exists public.permission_profiles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  permisos    jsonb not null default '[]'::jsonb, -- ["cotizaciones","clientes",...]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists permission_profile_id uuid references public.permission_profiles(id) on delete set null;

-- Acceso solo vía backend (service_role). RLS habilitada sin políticas.
alter table public.permission_profiles enable row level security;
