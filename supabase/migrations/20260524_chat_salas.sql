-- Salas (canales) del chat de equipo con miembros invitados.
-- Cada sala tiene un creador y una lista de miembros; solo ellos pueden leer
-- y escribir en la sala. Existe una sala "General" donde se incluye a todos
-- los perfiles existentes automáticamente.

create table if not exists public.chat_salas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  descripcion   text,
  creada_por    text not null,
  es_general    boolean not null default false,
  created_at    timestamptz not null default now()
);

create unique index if not exists chat_salas_general_unica
  on public.chat_salas (es_general) where es_general;

create table if not exists public.chat_sala_miembros (
  sala_id       uuid not null references public.chat_salas(id) on delete cascade,
  email         text not null,
  added_at      timestamptz not null default now(),
  primary key (sala_id, email)
);

create index if not exists chat_sala_miembros_email_idx
  on public.chat_sala_miembros(email);

-- Sala General por defecto y poblar con todos los perfiles existentes.
insert into public.chat_salas (nombre, descripcion, creada_por, es_general)
select 'General', 'Sala principal del equipo', 'system', true
where not exists (select 1 from public.chat_salas where es_general);

insert into public.chat_sala_miembros (sala_id, email)
select s.id, lower(p.email)
from public.chat_salas s
cross join public.profiles p
where s.es_general and p.email is not null
on conflict do nothing;

-- Columnas nuevas en chat_mensajes: sala_id (canal) y campos de respuesta.
-- Guardamos los campos de la respuesta de forma denormalizada para no tener
-- que hacer JOIN al renderizar la cita.
alter table public.chat_mensajes
  add column if not exists sala_id uuid references public.chat_salas(id) on delete cascade,
  add column if not exists responde_a_id uuid references public.chat_mensajes(id) on delete set null,
  add column if not exists responde_a_autor text,
  add column if not exists responde_a_texto text,
  add column if not exists responde_a_tipo text;

-- Backfill: mensajes existentes van a la sala General.
update public.chat_mensajes
set sala_id = (select id from public.chat_salas where es_general limit 1)
where sala_id is null;

create index if not exists chat_mensajes_sala_idx
  on public.chat_mensajes(sala_id, created_at);

-- RLS de salas y miembros.
alter table public.chat_salas enable row level security;
alter table public.chat_sala_miembros enable row level security;

drop policy if exists "chat_salas_lectura" on public.chat_salas;
create policy "chat_salas_lectura" on public.chat_salas
  for select to authenticated using (
    -- El creador siempre puede leer su propia sala (necesario porque tras el
    -- INSERT, supabase-js devuelve la fila vía SELECT antes de que el creador
    -- se inserte como miembro). Además, cualquier miembro puede leerla.
    lower(creada_por) = lower((auth.jwt() ->> 'email'))
    or exists (
      select 1 from public.chat_sala_miembros m
      where m.sala_id = chat_salas.id
        and lower(m.email) = lower((auth.jwt() ->> 'email'))
    )
  );

drop policy if exists "chat_salas_insert" on public.chat_salas;
create policy "chat_salas_insert" on public.chat_salas
  for insert to authenticated with check (true);

drop policy if exists "chat_sala_miembros_lectura" on public.chat_sala_miembros;
create policy "chat_sala_miembros_lectura" on public.chat_sala_miembros
  for select to authenticated using (true);

drop policy if exists "chat_sala_miembros_insert" on public.chat_sala_miembros;
create policy "chat_sala_miembros_insert" on public.chat_sala_miembros
  for insert to authenticated with check (true);

drop policy if exists "chat_sala_miembros_delete" on public.chat_sala_miembros;
create policy "chat_sala_miembros_delete" on public.chat_sala_miembros
  for delete to authenticated using (
    -- El creador de la sala puede gestionar miembros
    exists (
      select 1 from public.chat_salas s
      where s.id = chat_sala_miembros.sala_id
        and lower(s.creada_por) = lower((auth.jwt() ->> 'email'))
    )
  );

-- Actualizar política de lectura de mensajes para que solo se vean los de
-- salas en las que el usuario es miembro.
drop policy if exists "chat_mensajes_lectura" on public.chat_mensajes;
create policy "chat_mensajes_lectura" on public.chat_mensajes
  for select to authenticated using (
    sala_id is null or exists (
      select 1 from public.chat_sala_miembros m
      where m.sala_id = chat_mensajes.sala_id
        and lower(m.email) = lower((auth.jwt() ->> 'email'))
    )
  );

-- Realtime para salas y miembros (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_salas'
  ) then
    alter publication supabase_realtime add table public.chat_salas;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'chat_sala_miembros'
  ) then
    alter publication supabase_realtime add table public.chat_sala_miembros;
  end if;
end $$;
