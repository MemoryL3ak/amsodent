-- Reuniones de la bitácora con Google Meet: al crear una reunión se puede
-- generar un evento en el Google Calendar de la cuenta conectada (módulo
-- "Mi Correo") con enlace de Meet. Guardamos el enlace y el id del evento.
alter table public.actividades_cliente add column if not exists meet_url         text;
alter table public.actividades_cliente add column if not exists evento_google_id text;
