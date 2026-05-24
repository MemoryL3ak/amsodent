-- Fix RLS: permitir que el creador siempre lea su propia sala.
-- Sin esta condición, el INSERT en chat_salas falla con
-- "new row violates row-level security policy" porque supabase-js hace
-- .select() después del insert para devolver la fila, y la política de
-- lectura original requería ser miembro — pero el creador todavía no se
-- ha insertado como miembro en ese momento.

drop policy if exists "chat_salas_lectura" on public.chat_salas;
create policy "chat_salas_lectura" on public.chat_salas
  for select to authenticated using (
    lower(creada_por) = lower((auth.jwt() ->> 'email'))
    or exists (
      select 1 from public.chat_sala_miembros m
      where m.sala_id = chat_salas.id
        and lower(m.email) = lower((auth.jwt() ->> 'email'))
    )
  );
