-- Meta mensual (customizable) de cotizaciones INGRESADAS del equipo completo.
-- Una fila por periodo (YYYY-MM). Alimenta el reporte "Cotizaciones por Vendedor".
-- Si un periodo no tiene fila, el backend arrastra la meta del último periodo con
-- datos y, en su defecto, usa 900 por defecto.
create table if not exists public.equipo_meta_cotizaciones (
  periodo    text primary key,           -- 'YYYY-MM'
  meta       integer not null default 900,
  updated_at timestamptz not null default now()
);

comment on table public.equipo_meta_cotizaciones is
  'Meta mensual de cotizaciones ingresadas del equipo (customizable). Una fila por periodo YYYY-MM.';
comment on column public.equipo_meta_cotizaciones.meta is
  'Cantidad de cotizaciones ingresadas que el equipo debe alcanzar en el periodo. Default 900.';
