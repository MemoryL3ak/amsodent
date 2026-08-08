-- Agregación del tráfico para el panel Monitoreo del Sistema: series por
-- intervalo (ok/avisos/errores + latencia p50/p95), top de endpoints y top de
-- usuarios. Se agrega en SQL para no traer miles de filas al backend.
-- Solo la invoca el backend (service role): se revoca de anon/authenticated.
create or replace function public.monitor_trafico(p_desde timestamptz, p_bucket_seg int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select
    nivel, tipo, metodo, ruta, duracion_ms, usuario_email,
    to_timestamp(floor(extract(epoch from created_at) / p_bucket_seg) * p_bucket_seg) as bucket
  from monitor_logs
  where created_at >= p_desde
),
http as (
  select * from base where tipo in ('http', 'excepcion')
),
buckets as (
  select
    bucket,
    count(*) filter (where nivel = 'info')  as ok,
    count(*) filter (where nivel = 'warn')  as avisos,
    count(*) filter (where nivel = 'error') as errores,
    round((percentile_cont(0.5)  within group (order by duracion_ms))::numeric) as p50,
    round((percentile_cont(0.95) within group (order by duracion_ms))::numeric) as p95
  from base
  group by bucket
),
rutas as (
  select
    coalesce(metodo, '') as metodo,
    ruta,
    count(*) as total,
    count(*) filter (where nivel <> 'info') as errores,
    round(avg(duracion_ms)) as prom_ms,
    round((percentile_cont(0.95) within group (order by duracion_ms))::numeric) as p95_ms
  from http
  where ruta is not null
  group by 1, 2
  order by total desc
  limit 12
),
usuarios as (
  select
    usuario_email,
    count(*) as total,
    count(*) filter (where nivel <> 'info') as errores
  from base
  where usuario_email is not null
  group by 1
  order by total desc
  limit 8
)
select jsonb_build_object(
  'buckets',  (select coalesce(jsonb_agg(to_jsonb(b) order by b.bucket), '[]'::jsonb) from buckets b),
  'rutas',    (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from rutas r),
  'usuarios', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from usuarios u)
);
$$;

revoke all on function public.monitor_trafico(timestamptz, int) from public, anon, authenticated;
