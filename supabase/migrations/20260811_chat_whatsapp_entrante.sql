-- ============================================================================
-- Puente WhatsApp → Chat Grupal (sentido entrante)
-- ----------------------------------------------------------------------------
-- Hasta ahora el puente era de una sola vía: lo escrito en la sala General se
-- reenviaba al grupo de WhatsApp, pero lo que se escribía en WhatsApp no
-- llegaba a la plataforma. Quien trabajaba desde el chat se perdía la mitad de
-- la conversación.
--
-- Esta migración solo agrega lo necesario para que el sentido entrante sea
-- SEGURO DE REPETIR: Green API reintenta un webhook si no recibe 200 a tiempo,
-- y sin una marca de identidad el mismo mensaje entraría dos o tres veces al
-- chat. Guardando el id del mensaje de WhatsApp con un índice único, el
-- reintento choca contra el índice y no duplica.
-- ============================================================================

alter table public.chat_mensajes
  add column if not exists wa_message_id text;

-- Único solo entre los que vienen de WhatsApp: los mensajes nacidos en la
-- plataforma dejan la columna en null y no compiten por el índice.
create unique index if not exists chat_mensajes_wa_message_id_idx
  on public.chat_mensajes (wa_message_id)
  where wa_message_id is not null;

comment on column public.chat_mensajes.wa_message_id is
  'idMessage de Green API cuando el mensaje entró desde el grupo de WhatsApp. Null si se escribió en la plataforma.';
