-- (2026-09-16) Condición de compra acordada con cada proveedor.
--
-- Tres opciones, según lo pedido: crédito (con plazo en días), pago al
-- contado y pago con tarjeta de crédito. Se guarda como texto libre acotado
-- por un check, para poder sumar una condición nueva sin migrar de nuevo.
alter table public.proveedores
  add column if not exists condicion_compra text,
  add column if not exists credito_dias int;

comment on column public.proveedores.condicion_compra is
  'Condición de compra acordada: credito | contado | tarjeta_credito.';
comment on column public.proveedores.credito_dias is
  'Plazo del crédito en días (solo cuando condicion_compra = credito).';
