-- Costeo de Fletes (Logística).
-- Cobros reales de las empresas de despacho (Starken / Blue), cargados desde
-- sus archivos de detalle de cobro (xlsx/csv). Se cruzan con las guías de
-- despacho de las cotizaciones adjudicadas por N° de seguimiento (columna OS
-- en Starken) para comparar el flete estimado vs. el cobro real.
--
-- Upsert por (empresa, n_seguimiento): recargar un archivo actualiza los
-- montos sin duplicar filas.

create table if not exists public.fletes_cobros (
  id             bigint generated always as identity primary key,
  empresa        text not null check (empresa in ('Starken', 'Blue')),
  n_seguimiento  text not null,
  monto          numeric not null default 0,   -- cobro real (neto) del envío
  detalle        jsonb,                        -- fila original del archivo (referencia, destino, fechas…)
  archivo        text,                         -- nombre del archivo de origen
  cargado_por    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (empresa, n_seguimiento)
);

create index if not exists fletes_cobros_seguimiento_idx on public.fletes_cobros (n_seguimiento);

-- RLS habilitado sin políticas: el acceso es exclusivamente desde el backend
-- (service_role), igual que despachos.
alter table public.fletes_cobros enable row level security;
