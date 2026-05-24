-- Chat grupal del equipo (dentro de la Bitácora).
-- Mensajes en tiempo real: texto, imágenes, PDF, notas de voz y tarjetas
-- de "licitación tomada". Los adjuntos se guardan en el bucket de Storage
-- 'chat-adjuntos'.

create table if not exists public.chat_mensajes (
  id               uuid primary key default gen_random_uuid(),
  autor_email      text not null,
  autor_nombre     text,
  tipo             text not null default 'texto'
    check (tipo in ('texto', 'imagen', 'pdf', 'audio', 'licitacion', 'sistema')),
  texto            text,
  adjunto_url      text,
  adjunto_nombre   text,
  adjunto_mime     text,
  adjunto_tamano   bigint,
  audio_duracion   integer,
  licitacion_id    text,
  licitacion_estado text,
  bitacora_id      uuid,
  created_at       timestamptz not null default now()
);

create index if not exists chat_mensajes_created_idx
  on public.chat_mensajes (created_at);

alter table public.chat_mensajes enable row level security;

-- Todos los usuarios autenticados pueden leer el chat y publicar mensajes.
drop policy if exists "chat_mensajes_lectura" on public.chat_mensajes;
create policy "chat_mensajes_lectura" on public.chat_mensajes
  for select to authenticated using (true);

drop policy if exists "chat_mensajes_insercion" on public.chat_mensajes;
create policy "chat_mensajes_insercion" on public.chat_mensajes
  for insert to authenticated with check (true);

-- Habilitar Realtime en la tabla (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_mensajes'
  ) then
    alter publication supabase_realtime add table public.chat_mensajes;
  end if;
end $$;

-- Bucket de adjuntos del chat (imágenes, PDF, audios). Público para que las
-- URLs se puedan mostrar directo; las rutas usan UUID, no son adivinables.
insert into storage.buckets (id, name, public)
values ('chat-adjuntos', 'chat-adjuntos', true)
on conflict (id) do nothing;

drop policy if exists "chat_adjuntos_lectura" on storage.objects;
create policy "chat_adjuntos_lectura" on storage.objects
  for select using (bucket_id = 'chat-adjuntos');

drop policy if exists "chat_adjuntos_subida" on storage.objects;
create policy "chat_adjuntos_subida" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-adjuntos');
