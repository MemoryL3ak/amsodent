-- Bloqueo de clientes por mora de cobranza.
-- El bloqueo se calcula automáticamente desde la mora (días de atraso de las
-- facturas no pagadas): ≥120 días para mercado público / ≥60 días para cliente
-- particular. Esta columna permite al admin DESBLOQUEAR manualmente a un
-- cliente puntual (override), sin tocar el cálculo automático.
alter table public.clientes
  add column if not exists cobranza_desbloqueado boolean not null default false;

comment on column public.clientes.cobranza_desbloqueado is
  'Si es true, el admin desbloqueó manualmente al cliente para cotizar pese a su mora.';
