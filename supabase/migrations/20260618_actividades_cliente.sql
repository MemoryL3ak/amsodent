-- Bitácora de gestiones y actividades de cliente (estilo calendario).
-- Cada usuario registra sus actividades del día asociadas a un cliente, con
-- tipo, horario y comentario. Visibilidad: cada quien la suya (admin ve todo).
create table if not exists public.actividades_cliente (
  id             bigint generated always as identity primary key,
  user_email     text not null,
  user_nombre    text,
  cliente_id     uuid references public.clientes(id) on delete set null,
  cliente_nombre text,
  titulo         text not null,
  tipo           text not null default 'gestion',   -- llamada|visita|reunion|correo|seguimiento|tarea|otro
  comentario     text,
  fecha          date not null,
  hora_inicio    time,
  hora_fin       time,
  todo_el_dia    boolean not null default false,
  estado         text not null default 'pendiente', -- pendiente|realizada
  adjuntos       jsonb not null default '[]'::jsonb, -- [{url,nombre,mime}]
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists actividades_cliente_user_fecha_idx
  on public.actividades_cliente (user_email, fecha);
create index if not exists actividades_cliente_cliente_idx
  on public.actividades_cliente (cliente_id);
create index if not exists actividades_cliente_fecha_idx
  on public.actividades_cliente (fecha);

-- Acceso solo vía backend (service_role). RLS habilitada sin políticas.
alter table public.actividades_cliente enable row level security;
