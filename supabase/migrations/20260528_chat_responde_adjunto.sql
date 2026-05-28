-- Miniatura de la imagen citada al responder un mensaje (estilo WhatsApp).
-- Se denormaliza igual que responde_a_texto / responde_a_tipo para que el
-- quote muestre la miniatura aunque el mensaje original ya no esté cargado.

alter table public.chat_mensajes
  add column if not exists responde_a_adjunto_url text;
