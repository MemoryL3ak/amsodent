-- Estado de entrega de la cotización, visible y editable desde Trazabilidad.
-- Valores: 'Preparación' (en preparación) | 'Entregado'.
alter table public.licitaciones
  add column if not exists estado_entrega text not null default 'Preparación';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'licitaciones_estado_entrega_check'
  ) then
    alter table public.licitaciones
      add constraint licitaciones_estado_entrega_check
      check (estado_entrega in ('Preparación', 'Entregado'));
  end if;
end $$;
