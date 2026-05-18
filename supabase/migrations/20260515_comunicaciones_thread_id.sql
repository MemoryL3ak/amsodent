-- Soporte de respuestas: guardamos el thread_id de Gmail para poder consultar
-- después el hilo completo y mostrar las respuestas del cliente.
alter table public.comunicaciones_cotizacion
  add column if not exists gmail_thread_id text;

create index if not exists comunicaciones_cotizacion_thread_idx
  on public.comunicaciones_cotizacion (gmail_thread_id)
  where gmail_thread_id is not null;
