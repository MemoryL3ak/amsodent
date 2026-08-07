-- Resultados de Mercado Público por cotización: qué pasó con cada proceso
-- (compra ágil o licitación) al que postulamos, consultado vía API oficial.
-- El backend sincroniza (módulo mercadopublico) y guarda aquí el resultado
-- para el panel "Análisis Mercado Público": ganador, montos, cotizaciones
-- de la competencia y comparación por producto.

create table if not exists public.mp_resultados (
  id bigserial primary key,
  licitacion_id bigint not null unique,   -- id interno de nuestra cotización
  codigo_mp text not null,                -- código externo (ej: 3803-88-COT26)
  tipo text not null,                     -- 'compra_agil' | 'licitacion'
  estado_mp text,                         -- publicada/cerrada/proveedor_seleccionado/adjudicada/desierta/cancelada/revocada...
  estado_glosa text,
  participamos boolean,                   -- nuestro RUT aparece entre los cotizantes (null = no determinable)
  ganamos boolean,                        -- null = sin resultado aún
  ganador_rut text,
  ganador_nombre text,
  ganador_es_emt boolean,
  monto_nuestro numeric,                  -- total (bruto) de nuestra cotización según la API (o interno si no aparece)
  monto_ganador numeric,
  total_ofertas integer,
  presupuesto_clp numeric,
  organismo text,
  fecha_cierre timestamptz,
  detalle jsonb,                          -- { cotizaciones:[...], comparacion_items:[...], productos_solicitados:[...] }
  consultado_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists mp_resultados_codigo_idx on public.mp_resultados (codigo_mp);
alter table public.mp_resultados enable row level security;
