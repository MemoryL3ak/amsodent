-- Dirección (reverse-geocode) de cada marcaje de asistencia. Se guarda la
-- dirección aproximada de la coordenada donde el trabajador registró su marca.
alter table if exists public.marcajes
  add column if not exists direccion text;
