-- "Tomar" postulación: reserva temporal asociada a un usuario. Cada usuario
-- puede tener como máximo 3 postulaciones tomadas que sigan pendientes (no
-- cargadas). Al crear la cotización la postulación pasa a cargada y deja de
-- ocupar cupo.
alter table public.licitaciones_disponibles
  add column if not exists tomada_por text,
  add column if not exists tomada_at  timestamptz;

create index if not exists idx_disponibles_tomada_por
  on public.licitaciones_disponibles (lower(tomada_por));
