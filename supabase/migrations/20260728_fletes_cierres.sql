-- Costeo de Fletes: cierre de costeo por cotización.
-- Al presionar "Cerrar" en el costeo, la cotización pasa a la subsección de
-- Análisis con un snapshot de los valores comparados (estimado vs cobro real).
-- Reabrir elimina la fila.

create table if not exists public.fletes_cierres (
  id              bigint generated always as identity primary key,
  licitacion_id   bigint not null unique references public.licitaciones(id) on delete cascade,
  flete_estimado  numeric not null default 0,  -- snapshot al cerrar
  cobro_real      numeric not null default 0,  -- snapshot Σ cobros de las guías al cerrar
  diferencia      numeric not null default 0,  -- estimado − cobro real
  cerrado_por     text,
  created_at      timestamptz not null default now()
);

create index if not exists fletes_cierres_licitacion_idx on public.fletes_cierres (licitacion_id);

-- RLS habilitado sin políticas: acceso exclusivamente desde el backend
-- (service_role), igual que fletes_cobros.
alter table public.fletes_cierres enable row level security;

-- El cruce con guías de Blue Express se guarda con empresa 'Blue' en
-- fletes_cobros (normalizado en el frontend), el CHECK existente ya lo cubre.
