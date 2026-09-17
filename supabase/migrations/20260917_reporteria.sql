-- Reportería (2026-09-17): reportes guardados + motor de consultas de solo
-- lectura para el constructor visual y el editor SQL del módulo /reporteria.

-- ── Reportes guardados ───────────────────────────────────────────────────
create table if not exists reportes_guardados (
  id            bigint generated always as identity primary key,
  nombre        text not null,
  descripcion   text,
  -- 'constructor' (config visual) | 'sql' (consulta libre)
  tipo          text not null default 'constructor',
  -- Config del constructor: fuente, columnas, filtros, agrupación,
  -- agregaciones, orden, límite y la config del gráfico.
  config        jsonb,
  -- Consulta SQL guardada (tipo 'sql').
  sql           text,
  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table reportes_guardados enable row level security;
-- Sin políticas: solo el service role del backend (AdminGuard) las toca.

-- ── Motor de consultas de SOLO LECTURA ───────────────────────────────────
-- Ejecuta un SELECT arbitrario con tres candados: debe empezar con
-- SELECT/WITH, una sola sentencia (sin ';'), y sin palabras de escritura.
-- Además: timeout de 15 s y tope de 5.001 filas (el backend usa la fila
-- 5.001 solo para avisar que el resultado viene truncado).
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
       from (select * from (%s) consulta_usuario limit 5001) fila',
    consulta
  ) into resultado;

  return resultado;
end;
$$;

-- Solo el backend (service role) puede llamarla; nunca el navegador.
revoke all on function reporteria_sql(text) from public;
revoke all on function reporteria_sql(text) from anon;
revoke all on function reporteria_sql(text) from authenticated;
grant execute on function reporteria_sql(text) to service_role;
