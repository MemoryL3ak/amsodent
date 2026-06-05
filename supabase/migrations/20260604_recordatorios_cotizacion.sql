-- Recordatorios por tiempo de cotizaciones:
--  - cierre próximo (3 h y 1 h antes de fecha_hora_cierre)
--  - resultados publicados (1 día después de fecha_publicacion_resultados)
-- 'postulada' permite que el vendedor marque "Sí, ya postulé" y dejar de
-- recibir el recordatorio de cierre.
alter table public.licitaciones
  add column if not exists postulada boolean not null default false,
  add column if not exists recordatorio_cierre_3h_at  timestamptz,
  add column if not exists recordatorio_cierre_1h_at  timestamptz,
  add column if not exists recordatorio_resultados_at timestamptz;

comment on column public.licitaciones.postulada is
  'El vendedor confirmó que ya realizó la postulación (corta el recordatorio de cierre).';
