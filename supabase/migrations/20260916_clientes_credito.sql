-- (2026-09-16) Crédito para clientes particulares.
--
-- Hasta ahora el particular solo podía pagar al contado. Con esto se le puede
-- habilitar una línea de crédito y un plazo, y en el portal aparece "pagar
-- con crédito" además de Webpay. El cupo se mide contra lo que ya tiene sin
-- pagar, así que la decisión de dejarlo comprar se toma con el dato real.
alter table public.clientes
  add column if not exists credito_habilitado boolean not null default false,
  add column if not exists credito_monto numeric,
  add column if not exists credito_dias int,
  add column if not exists credito_actualizado_at timestamptz,
  add column if not exists credito_actualizado_por text;

comment on column public.clientes.credito_habilitado is
  'El cliente puede comprar a crédito en el portal (solo particulares).';
comment on column public.clientes.credito_monto is
  'Cupo total de crédito en pesos. El disponible = cupo − facturas impagas.';
comment on column public.clientes.credito_dias is
  'Plazo de pago del crédito, en días.';
