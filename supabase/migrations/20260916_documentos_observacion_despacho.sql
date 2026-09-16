-- (2026-09-16) Observación de despacho sobre la orden de compra.
--
-- En "Despachos y Choferes → Saldo OC" hace falta dejar anotado por qué una OC
-- sigue pendiente o por qué le queda saldo ("el cliente pidió postergar la
-- segunda entrega", "falta stock del ítem 3", etc.). La nota se guarda en el
-- documento de la OC, que es el que da origen a la fila, así que no hace falta
-- una tabla aparte: se ve junto al documento en cualquier pantalla.
alter table public.licitacion_documentos
  add column if not exists observacion_despacho text;

comment on column public.licitacion_documentos.observacion_despacho is
  'Nota operativa del despacho (Saldo OC): por qué la OC sigue pendiente o con saldo.';
