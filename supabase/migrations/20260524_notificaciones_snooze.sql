-- Snooze de notificaciones: permite posponer una notificación por X horas.
-- Lo usa el recordatorio de correos pendientes para volver a avisar al
-- vendedor cada 2 horas hasta que envíe el correo (oc_agradecimiento /
-- guia_despacho_enviar). Mientras snooze_hasta esté en el futuro, la
-- notificación se considera "oculta" y no se devuelve en /notificaciones.

alter table public.notificaciones
  add column if not exists snooze_hasta timestamptz;

-- Índice parcial: facilita filtrar las notificaciones visibles ahora mismo.
create index if not exists notificaciones_snooze_idx
  on public.notificaciones (user_email, snooze_hasta)
  where leida_at is null;
