-- Oficinas de marcaje asignadas por trabajador. El marcaje de un trabajador solo
-- se considera "dentro de radio" si ocurre en alguna de SUS oficinas asignadas.
-- (Modo estricto: trabajador sin oficinas asignadas => su marca queda fuera de radio.)
create table if not exists public.marcaje_oficina_trabajadores (
  id               bigint generated always as identity primary key,
  oficina_id       bigint not null references public.marcaje_oficinas(id) on delete cascade,
  trabajador_email text   not null,
  created_at       timestamptz not null default now(),
  unique (oficina_id, trabajador_email)
);

create index if not exists marcaje_ofic_trab_email_idx
  on public.marcaje_oficina_trabajadores (trabajador_email);
create index if not exists marcaje_ofic_trab_ofic_idx
  on public.marcaje_oficina_trabajadores (oficina_id);

-- Acceso solo vía backend (service_role). RLS habilitada sin políticas.
alter table public.marcaje_oficina_trabajadores enable row level security;
