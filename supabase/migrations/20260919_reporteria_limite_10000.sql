-- Reportería: sube el tope del motor de consultas de 5.000 a 10.000 filas
-- (2026-09-19). El reporte de cotizaciones × ítems de 2 meses ronda las
-- 9.600 filas y el tope anterior lo cortaba en silencio. Misma función de
-- la migración 20260917, solo cambia el LIMIT interno (10.001: la fila
-- extra es la señal de truncamiento para el backend).
create or replace function reporteria_sql(consulta text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if consulta is null or btrim(consulta) = '' then
    raise exception 'La consulta está vacía.';
  end if;
  if consulta !~* '^\s*(select|with)\M' then
    raise exception 'Solo se permiten consultas SELECT (o WITH ... SELECT).';
  end if;
  if position(';' in consulta) > 0 then
    raise exception 'Una sola consulta, sin punto y coma.';
  end if;
  if consulta ~* '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|vacuum|reindex|comment|lock|listen|notify|prepare|deallocate|import|merge)\M' then
    raise exception 'La consulta contiene palabras reservadas de escritura; este motor es de solo lectura.';
  end if;
  if consulta ~* '\m(set_config|pg_terminate_backend|pg_cancel_backend|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink)\M' then
    raise exception 'La consulta usa funciones no permitidas en el motor de reportes.';
  end if;

  perform set_config('statement_timeout', '15000', true);

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(fila)), ''[]''::jsonb)
       from (select * from (%s) consulta_usuario limit 10001) fila',
    consulta
  ) into resultado;

  return resultado;
end;
$$;

revoke all on function reporteria_sql(text) from public;
revoke all on function reporteria_sql(text) from anon;
revoke all on function reporteria_sql(text) from authenticated;
grant execute on function reporteria_sql(text) to service_role;
