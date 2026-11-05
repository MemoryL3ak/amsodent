-- (2026-11-05) Análisis histórico de productos en cotizaciones. Pedido de
-- Ariel: "mejorar el actual análisis de Mercado Público porque no trae todos
-- los productos". El análisis de productos de MP solo cubre lo que se
-- sincronizó desde Mercado Público (y en Compra Ágil, solo lo que perdimos);
-- esta función resume TODO lo que hemos cotizado (items_licitacion), sea
-- público o particular: una fila por producto, agrupado por SKU, o por nombre
-- (sin tildes ni mayúsculas) cuando la línea no tiene SKU.
--
-- La usa GET /licitaciones/productos/cotizados (Análisis → «Productos
-- cotizados»). La agregación se hace en la base porque son decenas de miles
-- de líneas: traerlas al servidor para sumarlas sería demasiado pesado.
--
--   p_desde / p_hasta : rango sobre la fecha de adjudicación (o, si no tiene,
--                       la fecha de la cotización). null = sin límite.
--   p_tipo            : 'publica' | 'particular' | null (todas).
--   p_q               : palabras del nombre o SKU; deben estar todas, en
--                       cualquier orden, sin importar tildes ni mayúsculas.
--
-- El precio (valor_unitario) es el que se cotizó: incluye el flete prorrateado
-- cuando la cotización lo llevaba.
create or replace function public.productos_cotizados_resumen(
  p_desde date default null,
  p_hasta date default null,
  p_tipo  text default null,
  p_q     text default null
)
returns table (
  clave                      text,
  sku                        text,
  producto                   text,
  formato                    text,
  cotizaciones               bigint,
  adjudicadas                bigint,
  unidades                   numeric,
  unidades_adjudicadas       numeric,
  precio_min                 numeric,
  precio_max                 numeric,
  precio_promedio            numeric,
  precio_promedio_adjudicado numeric,
  ultimo_precio              numeric,
  ultima_fecha               text,
  monto_adjudicado           numeric,
  clientes                   bigint
)
language sql
stable
as $$
  with base as (
    select
      i.licitacion_id,
      nullif(upper(regexp_replace(coalesce(i.sku, ''), '\s+', '', 'g')), '') as sku,
      btrim(coalesce(i.producto, '')) as producto,
      regexp_replace(translate(lower(btrim(coalesce(i.producto, ''))), 'áéíóúüñ', 'aeiouun'), '\s+', ' ', 'g') as nombre_norm,
      nullif(btrim(coalesce(i.formato, '')), '') as formato,
      coalesce(i.cantidad, 0)::numeric as cantidad,
      i.valor_unitario::numeric as precio,
      left(coalesce(l.fecha_adjudicada::text, l.fecha::text, ''), 10) as fecha,
      lower(coalesce(l.estado, '')) like '%adjudicada%' as adjudicada,
      (lower(coalesce(l.tipo_cliente, '')) like '%particular%' or coalesce(l.tipo_compra, '') = 'Cliente particular') as particular,
      l.rut_entidad
    from public.items_licitacion i
    join public.licitaciones l on l.id = i.licitacion_id
    where i.valor_unitario::numeric > 0
  ),
  filtrada as (
    select b.*, coalesce('s:' || b.sku, 'n:' || b.nombre_norm) as clave_producto
    from base b
    where b.fecha <> ''
      and (p_desde is null or b.fecha >= p_desde::text)
      and (p_hasta is null or b.fecha <= p_hasta::text)
      and (coalesce(p_tipo, '') = '' or (p_tipo = 'particular') = b.particular)
      and (
        coalesce(btrim(p_q), '') = ''
        or not exists (
          select 1
          from unnest(string_to_array(translate(lower(btrim(p_q)), 'áéíóúüñ', 'aeiouun'), ' ')) as palabra
          where palabra <> ''
            and position(palabra in b.nombre_norm || ' ' || lower(coalesce(b.sku, ''))) = 0
        )
      )
  )
  select
    f.clave_producto                                                        as clave,
    max(f.sku)                                                              as sku,
    (array_agg(f.producto order by f.fecha desc))[1]                        as producto,
    (array_agg(f.formato order by f.fecha desc) filter (where f.formato is not null))[1] as formato,
    count(distinct f.licitacion_id)                                         as cotizaciones,
    count(distinct f.licitacion_id) filter (where f.adjudicada)             as adjudicadas,
    sum(f.cantidad)                                                         as unidades,
    coalesce(sum(f.cantidad) filter (where f.adjudicada), 0)                as unidades_adjudicadas,
    min(f.precio)                                                           as precio_min,
    max(f.precio)                                                           as precio_max,
    round(avg(f.precio))                                                    as precio_promedio,
    round(avg(f.precio) filter (where f.adjudicada))                        as precio_promedio_adjudicado,
    (array_agg(f.precio order by f.fecha desc))[1]                          as ultimo_precio,
    max(f.fecha)                                                            as ultima_fecha,
    coalesce(sum(f.cantidad * f.precio) filter (where f.adjudicada), 0)     as monto_adjudicado,
    count(distinct f.rut_entidad)                                           as clientes
  from filtrada f
  group by f.clave_producto
  order by count(distinct f.licitacion_id) desc, f.clave_producto
$$;

-- Solo la llama el backend (service_role).
revoke all on function public.productos_cotizados_resumen(date, date, text, text) from public;
revoke all on function public.productos_cotizados_resumen(date, date, text, text) from anon, authenticated;
grant execute on function public.productos_cotizados_resumen(date, date, text, text) to service_role;
