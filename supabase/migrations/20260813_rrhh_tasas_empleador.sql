-- ============================================================================
-- RR.HH. — tasas de aportes del empleador según definición de la empresa
-- ----------------------------------------------------------------------------
--   · Nueva columna `tasa_seguro_social`: aporte del empleador de la reforma
--     previsional (ley 21.735), capitalización individual + seguro social de
--     expectativa de vida. 1% del imponible, cargo 100% del empleador.
--   · SIS pasa de 1,53% a 2% y la mutual de 0,95% a 0,93% (tasa vigente de la
--     empresa). Solo se corrigen las filas que aún tenían el valor por defecto
--     anterior: un valor distinto es un ajuste manual y se respeta.
-- ============================================================================

alter table public.rrhh_parametros
  add column if not exists tasa_seguro_social numeric not null default 1;

alter table public.rrhh_parametros alter column tasa_sis set default 2;
alter table public.rrhh_parametros alter column tasa_mutual set default 0.93;

update public.rrhh_parametros set tasa_sis = 2 where tasa_sis = 1.53;
update public.rrhh_parametros set tasa_mutual = 0.93 where tasa_mutual = 0.95;

comment on column public.rrhh_parametros.tasa_seguro_social is
  'Aporte del empleador de la reforma previsional (ley 21.735): % del imponible topado. No se descuenta al trabajador; suma al costo empresa.';
