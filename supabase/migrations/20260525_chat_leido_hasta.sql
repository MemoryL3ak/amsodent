-- Marca por usuario hasta qué momento ya leyó cada sala. Sirve para mostrar
-- contadores de mensajes no leídos estilo WhatsApp. Default = now() para que
-- los miembros existentes no vean toda la historia como "no leída" al inicio.

alter table public.chat_sala_miembros
  add column if not exists leido_hasta timestamptz not null default now();

-- Asegurar que la tabla esté replicada para que el cliente vea sus propios
-- UPDATEs en tiempo real (ya estaba para INSERT/DELETE, pero ratificamos).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_sala_miembros'
  ) then
    alter publication supabase_realtime add table public.chat_sala_miembros;
  end if;
end $$;
