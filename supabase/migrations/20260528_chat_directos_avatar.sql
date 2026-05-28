-- Mensajes directos 1-a-1 + imagen/logo por sala.
--
-- 1) es_directo: marca una sala como conversación privada entre 2 personas.
--    Se reutiliza toda la infraestructura de salas (miembros, mensajes, RLS).
-- 2) avatar_url: imagen/logo de la sala (se sube al bucket chat-adjuntos).

alter table public.chat_salas
  add column if not exists es_directo boolean not null default false,
  add column if not exists avatar_url text;

-- Índice para encontrar rápido los directos de un usuario.
create index if not exists chat_salas_directo_idx
  on public.chat_salas (es_directo) where es_directo;

-- El creador de la sala (o un admin) puede actualizarla (nombre, descripción,
-- avatar_url). Hasta ahora chat_salas no tenía política de UPDATE, así que
-- cualquier intento de guardar el avatar era denegado silenciosamente por RLS.
-- Se incluye al admin para poder ponerle logo a la sala General, que no tiene
-- dueño (creada_por = 'system').
drop policy if exists "chat_salas_update" on public.chat_salas;
create policy "chat_salas_update" on public.chat_salas
  for update to authenticated
  using (
    lower(creada_por) = lower((auth.jwt() ->> 'email'))
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.rol, '')) in ('admin', 'administrador')
    )
  )
  with check (
    lower(creada_por) = lower((auth.jwt() ->> 'email'))
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.rol, '')) in ('admin', 'administrador')
    )
  );
