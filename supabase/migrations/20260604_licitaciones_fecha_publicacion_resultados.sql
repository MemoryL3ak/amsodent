-- Fecha de publicación de resultados (obligatoria en cotizaciones tipo
-- Licitación). Permite agendar el recordatorio "1 día después" de esa fecha.
alter table public.licitaciones
  add column if not exists fecha_publicacion_resultados date;

comment on column public.licitaciones.fecha_publicacion_resultados is
  'Fecha en que se publican los resultados de la licitación. Base del recordatorio post-resultados.';
