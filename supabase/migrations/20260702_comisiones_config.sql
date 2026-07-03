-- Configuración del módulo de comisiones. Por ahora un único esquema
-- ("Ejecutivo Licitación Pública y privado"): guarda las 4 tablas (venta,
-- margen, productividad, conversión) como jsonb, editables desde la app.
-- El cálculo de comisión (fórmula: (venta+productividad) × margen × conversión)
-- y la derivación de métricas se implementan en una etapa posterior.
create table if not exists public.comisiones_config (
  id         int primary key default 1,
  nombre     text default 'Ejecutivo Licitación Pública y privado',
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  updated_by text,
  constraint comisiones_config_singleton check (id = 1)
);
