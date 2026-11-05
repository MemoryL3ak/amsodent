-- (2026-11-05) Apertura y cierre de caja. Pedido de Ariel: "Módulo apertura y
-- cierre de caja (asociar solamente lo que corresponde al usuario
-- ventas@amsodentmedical.cl)".
--
-- Un turno de caja (caja_sesiones) se abre con el fondo en efectivo y se
-- cierra con el arqueo (efectivo contado vs. esperado). Las ventas del turno
-- NO se copian aquí: se leen de bsale_emisiones (las ventas directas que
-- emitió el usuario de la tienda entre la apertura y el cierre). Lo que sí se
-- guarda son los movimientos de efectivo hechos a mano (caja_movimientos:
-- retiros, gastos menores, devoluciones en efectivo, sencillo) y, al cerrar,
-- la foto del turno (`resumen`), para que el historial no cambie si después
-- se anula una venta. Solo el backend (service_role) lee y escribe.
create table if not exists public.caja_sesiones (
  id                   bigserial primary key,
  estado               text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  -- usuario cuyas ventas se asocian al turno (CAJA_USUARIO al abrir)
  usuario_caja         text,
  abierta_at           timestamptz not null default now(),
  abierta_por          text,
  monto_inicial        numeric(14,2) not null default 0 check (monto_inicial >= 0),
  observacion_apertura text,
  cerrada_at           timestamptz,
  cerrada_por          text,
  efectivo_esperado    numeric(14,2),
  efectivo_contado     numeric(14,2),
  diferencia           numeric(14,2),
  observacion_cierre   text,
  resumen              jsonb,
  created_at           timestamptz not null default now()
);
-- Una sola caja abierta a la vez.
create unique index if not exists caja_sesiones_una_abierta_idx on public.caja_sesiones (estado) where estado = 'abierta';
create index if not exists caja_sesiones_cierre_idx on public.caja_sesiones (cerrada_at desc);

create table if not exists public.caja_movimientos (
  id            bigserial primary key,
  sesion_id     bigint not null references public.caja_sesiones(id) on delete cascade,
  tipo          text not null check (tipo in ('ingreso', 'egreso')),
  monto         numeric(14,2) not null check (monto > 0),
  motivo        text not null,
  usuario_email text,
  created_at    timestamptz not null default now()
);
create index if not exists caja_movimientos_sesion_idx on public.caja_movimientos (sesion_id, id);

alter table public.caja_sesiones enable row level security;
alter table public.caja_movimientos enable row level security;
