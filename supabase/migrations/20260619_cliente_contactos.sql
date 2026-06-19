-- Contactos clave de un cliente (perfil 360°). Un cliente puede tener varios
-- contactos (director, jefe de compras, etc.) con su cargo, datos y nivel de
-- influencia. Se administran desde el perfil del cliente.
create table if not exists public.cliente_contactos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  nombre      text not null,
  cargo       text,
  email       text,
  telefono    text,
  influencia  text check (influencia in ('Alta', 'Media', 'Baja')),
  cumpleanos  text,                                  -- texto libre (ej. "12 Marzo")
  orden       int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cliente_contactos_cliente_idx
  on public.cliente_contactos (cliente_id);

-- Acceso solo vía backend (service_role). RLS habilitada sin políticas.
alter table public.cliente_contactos enable row level security;
