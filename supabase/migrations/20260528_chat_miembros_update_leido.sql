-- Fix: el badge de "mensajes sin leer" no se limpiaba al refrescar la página.
--
-- chat_sala_miembros tiene RLS activado con políticas de SELECT/INSERT/DELETE,
-- pero NO tenía política de UPDATE. El cliente, al abrir una sala, hace:
--   update chat_sala_miembros set leido_hasta = now() where sala_id=.. and email=..
-- Sin política de UPDATE, Postgres denegaba la operación por defecto (0 filas
-- afectadas) de forma silenciosa, así que leido_hasta nunca se persistía y al
-- refrescar el conteo de no leídos se recalculaba contra el valor viejo.
--
-- Esta política permite que cada usuario actualice ÚNICAMENTE su propia fila de
-- membresía (su leido_hasta), identificándose por su email del JWT.

drop policy if exists "chat_sala_miembros_update" on public.chat_sala_miembros;
create policy "chat_sala_miembros_update" on public.chat_sala_miembros
  for update to authenticated
  using (lower(email) = lower((auth.jwt() ->> 'email')))
  with check (lower(email) = lower((auth.jwt() ->> 'email')));
