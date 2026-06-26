-- Cliente "transitorio": se crea desde la bitácora de actividades con datos
-- mínimos (solo el nombre). Al completar su información (RUT y contacto) deja
-- de ser transitorio y pasa a ser un cliente normal.
alter table public.clientes
  add column if not exists transitorio boolean not null default false;
