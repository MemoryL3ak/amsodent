-- ============================================================================
-- Análisis de productos en SQL + caché de fichas de Mercado Público (2026-10-21)
-- ----------------------------------------------------------------------------
-- 1) mp_productos_resumen(desde, hasta): la agregación por producto del panel
--    de Análisis (en cuántos procesos aparece cada producto, ganados/perdidos,
--    precios promedio nuestro y ganador, brecha y monto adjudicado). Antes el
--    backend bajaba el `detalle` de las ~3.000 fichas a memoria en cada carga
--    del panel; ahora lo resuelve PostgreSQL en milisegundos.
-- 2) mp_fichas_cache: copia de la ficha normalizada de cada proceso. La
--    pantalla la muestra al tiro y consulta la API (12-29 s, 504 frecuentes)
--    solo si no hay copia, si es vieja o si el usuario pide «Actualizar».
--
-- Re-ejecutable (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

create table if not exists public.mp_fichas_cache (
  codigo        text primary key,          -- código del proceso, en mayúsculas
  ficha         jsonb not null,            -- lo mismo que devuelve GET /licitaciones/mercado-publico/:codigo
  consultado_at timestamptz not null default now()
);
alter table public.mp_fichas_cache enable row level security;
-- Sin políticas: solo el backend (service_role) lee y escribe.

create or replace function public.mp_productos_resumen(p_desde date default null, p_hasta date default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with ultimas as (
  -- La ficha más reciente de cada código de Mercado Público (una cotización
  -- re-cotizada guarda dos fichas del mismo proceso).
  select distinct on (coalesce(codigo_mp, 'sin-codigo:' || licitacion_id::text))
    licitacion_id, codigo_mp, consultado_at, fecha_adjudicacion, ganamos, participamos, estado_mp,
    detalle->'comparacion_items' as items
  from public.mp_resultados
  order by coalesce(codigo_mp, 'sin-codigo:' || licitacion_id::text), consultado_at desc nulls last
),
fichas as (
  select u.*,
    case
      when u.ganamos is true then 'ganada'
      when u.ganamos is false and u.participamos is false then 'sin_participar'
      when u.ganamos is false then 'perdida'
      when u.estado_mp in ('desierta', 'cancelada', 'revocada', 'suspendida') then 'sin_efecto'
      when u.estado_mp = 'no_encontrada' then 'no_encontrada'
      else 'en_curso'
    end as clase,
    case when u.fecha_adjudicacion::text ~ '^\d{4}-\d{2}-\d{2}' then left(u.fecha_adjudicacion::text, 10)::date end as dia
  from ultimas u
),
en_rango as (
  -- Con rango, las fichas sin fecha de adjudicación quedan fuera (igual que el panel).
  select * from fichas f
  where (p_desde is null and p_hasta is null)
     or (f.dia is not null
         and (p_desde is null or f.dia >= p_desde)
         and (p_hasta is null or f.dia <= p_hasta))
),
items as (
  select
    coalesce(f.codigo_mp, f.licitacion_id::text) as proceso,
    f.clase,
    nullif(trim(it->>'nombre'), '') as nombre,
    nullif(trim(it->>'codigo_producto'), '') as codigo,
    lower(coalesce(nullif(trim(it->>'codigo_producto'), ''), nullif(trim(it->>'nombre'), ''))) as clave,
    case when it->>'ganado_por_nosotros' in ('true', 'false') then (it->>'ganado_por_nosotros')::boolean end as gpn,
    case when jsonb_typeof(it->'nuestro_precio') = 'number' then (it->>'nuestro_precio')::numeric end as pn,
    case when jsonb_typeof(it->'precio_ganador') = 'number' then (it->>'precio_ganador')::numeric end as pg,
    coalesce(
      case when jsonb_typeof(it->'cantidad_ganador') = 'number' then nullif((it->>'cantidad_ganador')::numeric, 0) end,
      case when jsonb_typeof(it->'nuestra_cantidad') = 'number' then nullif((it->>'nuestra_cantidad')::numeric, 0) end,
      1
    ) as cant
  from en_rango f
  cross join lateral jsonb_array_elements(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end) as it
),
clasificados as (
  select *,
    case
      when gpn is not null then (case when gpn then 'ganado' else 'perdido' end)
      when clase = 'ganada' then 'ganado'
      when clase = 'perdida' then 'perdido'
    end as resultado
  from items
  where clave is not null
),
agg as (
  select
    clave,
    (array_agg(nombre order by length(nombre) desc nulls last))[1] as nombre,
    (array_agg(codigo order by codigo nulls last))[1] as codigo,
    count(distinct proceso) as procesos,
    count(*) filter (where resultado = 'ganado') as ganados,
    count(*) filter (where resultado = 'perdido') as perdidos,
    avg(pn) filter (where pn > 0) as precio_nuestro,
    avg(pg) filter (where pg > 0) as precio_ganador,
    sum(pg * cant) filter (where pg > 0) as monto_adjudicado
  from clasificados
  group by clave
)
select jsonb_build_object(
  'fichas', (select count(*) from en_rango),
  'productos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nombre', coalesce(a.nombre, a.codigo),
      'codigo', coalesce(a.codigo, ''),
      'procesos', a.procesos,
      'ganados', a.ganados,
      'perdidos', a.perdidos,
      'precioNuestro', a.precio_nuestro,
      'precioGanador', a.precio_ganador,
      'brecha', case when a.precio_nuestro is not null and a.precio_ganador > 0
                     then (a.precio_nuestro - a.precio_ganador) / a.precio_ganador * 100 end,
      'montoAdjudicado', round(coalesce(a.monto_adjudicado, 0))
    ) order by a.procesos desc, a.monto_adjudicado desc nulls last)
    from agg a
  ), '[]'::jsonb)
);
$$;

revoke all on function public.mp_productos_resumen(date, date) from public, anon, authenticated;
