-- Habilita realtime sobre bitacora_cotizaciones para que la sección "Registro"
-- del Chat Grupal se actualice al instante cuando se crea/edita/elimina un
-- registro (sin tener que refrescar la página).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'bitacora_cotizaciones'
  ) then
    alter publication supabase_realtime add table public.bitacora_cotizaciones;
  end if;
end $$;

-- La bitácora es de equipo: cualquier usuario autenticado puede ver los
-- registros vía realtime. El backend escribe con service_role (bypasea RLS),
-- así que esta política solo afecta a los subscribers del cliente.
alter table public.bitacora_cotizaciones enable row level security;

drop policy if exists "bitacora select equipo" on public.bitacora_cotizaciones;
create policy "bitacora select equipo"
  on public.bitacora_cotizaciones
  for select
  to authenticated
  using (true);
