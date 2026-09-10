-- (Punto 6 — 2026-09-10) Banco receptor del pago de una factura (Itaú o
-- Santander), registrado en Seguimiento de Pagos junto a la forma de pago.
-- Aplica a todas las formas de pago salvo efectivo. El backend tolera que la
-- columna no exista aún (la quita del payload y reintenta), así el deploy no
-- depende de esta migración.
alter table public.licitacion_documentos add column if not exists banco_pago text;
