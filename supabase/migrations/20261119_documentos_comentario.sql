-- (2026-11-19) Comentario interno de un documento emitido (guía, factura, boleta).
--
-- Pedido de Ariel: "después de emitir cada documento (factura o guía), se pueda
-- agregar un comentario general (este comentario solo vive en la plataforma,
-- no se envía a Bsale)".
--
-- Va en el propio documento, con quién lo escribió y cuándo. No es la
-- «Observación» de la guía (esa sí viaja a Bsale como atributo del documento)
-- ni `observacion_despacho` (la nota de Saldo OC sobre la orden de compra):
-- este texto no sale de la plataforma, ni al PDF ni al correo del cliente.
--
-- Aditiva: el servidor avisa con un mensaje claro si todavía no está aplicada.
alter table public.licitacion_documentos
  add column if not exists comentario     text,
  add column if not exists comentario_at  timestamptz,
  add column if not exists comentario_por text;

comment on column public.licitacion_documentos.comentario is
  'Comentario interno del documento (solo plataforma: no se envía a Bsale ni al cliente).';
