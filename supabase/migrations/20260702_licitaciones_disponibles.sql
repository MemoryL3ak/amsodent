-- Listado de licitaciones "disponibles" (publicadas) que los ejecutivos pueden
-- tomar/cargar como cotización. Se sube por xlsx (ID + Nombre). Cada fila queda
-- marcada cuando un usuario la carga (con quién y cuándo).
create table if not exists public.licitaciones_disponibles (
  id          bigserial primary key,
  id_licitacion text not null,
  nombre      text default '',
  cargada     boolean not null default false,
  cargada_por text,
  cargada_at  timestamptz,
  subida_por  text,
  created_at  timestamptz not null default now()
);

-- Evita duplicados por ID de licitación (case-insensitive).
create unique index if not exists licitaciones_disponibles_idlic_key
  on public.licitaciones_disponibles (lower(id_licitacion));
