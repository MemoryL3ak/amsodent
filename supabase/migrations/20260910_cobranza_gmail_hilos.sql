-- (Punto 5 — 2026-09-10) Historial de cobranza estilo Gmail.
-- Al enviar un correo de cobranza, Gmail devuelve el id del mensaje y del
-- hilo (thread). Guardándolos en la gestión, el Historial de gestiones puede
-- reconstruir después la conversación completa (nuestro correo + todas las
-- respuestas del cliente) vía GET /correos/cobranza/hilo?threadId=...
alter table public.cobranza_gestiones add column if not exists gmail_message_id text;
alter table public.cobranza_gestiones add column if not exists gmail_thread_id text;
