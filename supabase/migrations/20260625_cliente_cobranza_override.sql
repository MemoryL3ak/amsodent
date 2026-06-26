-- Override manual del estado de cobranza (gestionado por admin):
--   'bloqueado' | 'desbloqueado' | null (automático según días de atraso).
-- Por defecto NULL: el estado se determina por el atraso vs. el umbral
-- (60 días particular / 120 días entidad pública).
alter table public.clientes
  add column if not exists cobranza_override text;
