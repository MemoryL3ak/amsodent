-- Tipo de cliente: distingue entre 'Cliente Particular' y 'Entidad Pública'.
-- Se usa en la creación/edición de clientes y, a futuro, para reportes y filtros.

alter table public.clientes
  add column if not exists tipo_cliente text;

-- Restringimos los valores aceptados; permitimos NULL para clientes históricos
-- que aún no tienen el tipo asignado.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clientes_tipo_cliente_chk'
  ) then
    alter table public.clientes
      add constraint clientes_tipo_cliente_chk
      check (tipo_cliente is null or tipo_cliente in ('Cliente Particular', 'Entidad Pública'));
  end if;
end$$;
