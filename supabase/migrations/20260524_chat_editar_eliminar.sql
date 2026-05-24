-- Editar y eliminar mensajes propios + eliminar salas creadas por uno mismo.

-- Columna para marcar si un mensaje fue editado.
alter table public.chat_mensajes
  add column if not exists editado_at timestamptz;

-- El autor puede actualizar sus propios mensajes (solo edición de texto).
drop policy if exists "chat_mensajes_update" on public.chat_mensajes;
create policy "chat_mensajes_update" on public.chat_mensajes
  for update to authenticated using (
    lower(autor_email) = lower((auth.jwt() ->> 'email'))
  ) with check (
    lower(autor_email) = lower((auth.jwt() ->> 'email'))
  );

-- El autor puede eliminar sus propios mensajes.
drop policy if exists "chat_mensajes_delete" on public.chat_mensajes;
create policy "chat_mensajes_delete" on public.chat_mensajes
  for delete to authenticated using (
    lower(autor_email) = lower((auth.jwt() ->> 'email'))
  );

-- El creador de una sala puede eliminarla, salvo la sala General.
-- El cascade en chat_sala_miembros y la FK on delete cascade que vamos a
-- agregar en chat_mensajes se encargan de limpiar todo lo asociado.
drop policy if exists "chat_salas_delete" on public.chat_salas;
create policy "chat_salas_delete" on public.chat_salas
  for delete to authenticated using (
    lower(creada_por) = lower((auth.jwt() ->> 'email'))
    and not es_general
  );

-- Asegurar que los mensajes se borren en cascada cuando se elimina la sala.
-- (La migración original ya lo definía así, pero esto es defensivo por si
-- una instalación previa quedó con FK sin cascade.)
do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.referential_constraints rc
    on tc.constraint_name = rc.constraint_name
  where tc.table_schema = 'public'
    and tc.table_name = 'chat_mensajes'
    and tc.constraint_type = 'FOREIGN KEY'
    and rc.delete_rule <> 'CASCADE'
    and exists (
      select 1 from information_schema.key_column_usage k
      where k.constraint_name = tc.constraint_name
        and k.column_name = 'sala_id'
    );
  if fk_name is not null then
    execute format('alter table public.chat_mensajes drop constraint %I', fk_name);
    alter table public.chat_mensajes
      add constraint chat_mensajes_sala_id_fkey
      foreign key (sala_id) references public.chat_salas(id) on delete cascade;
  end if;
end $$;
