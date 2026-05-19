-- Persistir tipo_cliente en la cotización (además de en la ficha del cliente).
-- Esto desacopla la cotización del cliente: si alguien cambia el tipo en una
-- cotización futura no afecta a las anteriores.

alter table public.licitaciones
  add column if not exists tipo_cliente text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'licitaciones_tipo_cliente_check'
  ) then
    alter table public.licitaciones
      add constraint licitaciones_tipo_cliente_check
      check (
        tipo_cliente is null
        or tipo_cliente in ('Cliente Particular', 'Entidad Pública')
      );
  end if;
end$$;
