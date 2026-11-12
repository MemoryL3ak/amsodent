-- (2026-11-12) Precios → Google Sheet «Lista de Precios». Pedido de Ariel
-- (punto 7 del lote del 2026-11-09): «manejar desde la plataforma la
-- actualización de precios; la actualización se envía a un Google Sheet».
--
-- El historial de cambios de precio (`productos_precio_cambios`) pasa a ser
-- también la COLA de envío al Sheet: cada cambio nace `pendiente` y el backend
-- lo marca `enviado` cuando la celda quedó escrita.
--   previo    = cambio anterior a esta migración (no se envía; para dejar el
--               Sheet al día está el botón «Nivelar» de la pantalla)
--   pendiente = por enviar            enviando = tomado por un proceso
--   enviado   = escrito en el Sheet   omitido  = no corresponde (sin SKU, etc.)
--   error     = falló; se reintenta solo hasta 8 veces
alter table public.productos_precio_cambios
  add column if not exists sheet_estado   text,
  add column if not exists sheet_at       timestamptz,
  add column if not exists sheet_error    text,
  add column if not exists sheet_intentos integer not null default 0;

-- Lo que ya existía no se envía: quedaría escrito con semanas de atraso.
update public.productos_precio_cambios
   set sheet_estado = 'previo'
 where sheet_estado is null;

alter table public.productos_precio_cambios
  alter column sheet_estado set default 'pendiente';

create index if not exists productos_precio_cambios_sheet_idx
  on public.productos_precio_cambios (id)
  where sheet_estado in ('pendiente', 'enviando', 'error');

-- Cada corrida que escribió (o intentó escribir) en el Sheet: el envío de los
-- cambios pendientes y las nivelaciones pedidas desde la pantalla.
create table if not exists public.precios_sheet_envios (
  id            bigserial primary key,
  -- cambios | nivelacion
  tipo          text not null default 'cambios',
  usuario_email text,
  productos     integer not null default 0,
  celdas        integer not null default 0,
  agregados     integer not null default 0,
  omitidos      integer not null default 0,
  -- ok | error
  estado        text not null default 'ok',
  error         text,
  detalle       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists precios_sheet_envios_fecha_idx
  on public.precios_sheet_envios (created_at desc);

-- Solo el backend (service_role) lee y escribe: sin políticas, RLS lo cierra al resto.
alter table public.precios_sheet_envios enable row level security;
