-- Habilita la publicación realtime sobre la tabla notificaciones para que
-- la campana del frontend se actualice al instante (sin esperar al polling).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

-- RLS: cada usuario solo puede ver sus propias notificaciones por realtime.
-- (El backend escribe con service_role y bypasea RLS — esto solo afecta a
-- los subscribers del cliente.)
alter table public.notificaciones enable row level security;

drop policy if exists "notificaciones select propias" on public.notificaciones;
create policy "notificaciones select propias"
  on public.notificaciones
  for select
  to authenticated
  using (lower(user_email) = lower((auth.jwt() ->> 'email')));
