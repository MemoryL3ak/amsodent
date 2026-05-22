-- DamarIA: función que ejecuta una consulta SQL de SOLO LECTURA y devuelve
-- las filas como JSON.
--
-- Seguridad:
--  * La consulta se envuelve en una subconsulta `from (<consulta>) t`, lo que
--    estructuralmente impide cualquier sentencia que no sea SELECT/WITH
--    (un INSERT/UPDATE/DELETE/DROP daría error de sintaxis).
--  * Chequeo explícito de que la consulta empieza con SELECT o WITH.
--  * statement_timeout local para cortar consultas lentas.
--  * EXECUTE revocado a public/anon/authenticated: solo el backend
--    (service_role) puede invocarla. Los permisos finos (solo admin) los
--    aplica el backend con AdminGuard.

create or replace function public.damaria_sql(consulta text)
returns json
language plpgsql
as $$
declare
  resultado json;
begin
  if consulta !~* '^\s*(select|with)\s' then
    raise exception 'DamarIA solo permite consultas de lectura (SELECT).';
  end if;

  perform set_config('statement_timeout', '10000', true);

  execute format('select coalesce(json_agg(t), ''[]''::json) from (%s) t', consulta)
    into resultado;

  return resultado;
end;
$$;

revoke all on function public.damaria_sql(text) from public;
revoke all on function public.damaria_sql(text) from anon;
revoke all on function public.damaria_sql(text) from authenticated;
grant execute on function public.damaria_sql(text) to service_role;
