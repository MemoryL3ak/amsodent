-- (2026-09-16) Flujo de aprobación y pago de los pedidos del portal.
--
-- El pedido deja de ser "se envía y alguien lo verá": pasa por etapas con
-- responsable y hora, que es lo que permite medir tiempos de respuesta y
-- volver atrás cuando algo cambia.
--
--   pendiente_aprobacion  el asistente armó el pedido; espera al administrador
--                         de la cuenta del cliente
--   aprobado_cliente      lo aprobó el administrador del portal  → avisa a la
--                         plataforma y al cliente le decimos 24-48 hrs
--   validado_plataforma   Amsodent confirmó existencias y envió el link de pago
--   pagado                Webpay confirmó el pago → 48-72 hrs para despachar
--   rechazado / cancelado salidas
--
-- La reversa (cambiar productos, volver a aprobar, revalidar) es válida en
-- CUALQUIER etapa mientras no esté pagado. Una vez pagado el pedido se cierra:
-- si el cliente quiere más productos, se arma un pedido nuevo.

alter table public.stock_solicitudes_cotizacion
  -- Etapa del flujo (distinta de `estado`, que sigue describiendo la gestión
  -- comercial: pendiente / respondida / cancelada).
  add column if not exists flujo_estado text not null default 'pendiente_aprobacion',

  -- Quién armó el pedido (usuario del portal, puede ser el asistente).
  add column if not exists creado_por_usuario_id bigint,
  add column if not exists creado_por_email text,

  -- Paso 1: aprobación del administrador de la cuenta del cliente.
  add column if not exists aprobado_cliente_at timestamptz,
  add column if not exists aprobado_cliente_por text,

  -- Paso 2: validación de Amsodent (existencias) + link de pago.
  add column if not exists validado_at timestamptz,
  add column if not exists validado_por text,
  -- [{ nombre, cantidad_solicitada, cantidad_disponible, precio_unitario, nota }]
  add column if not exists disponibilidad jsonb,
  add column if not exists monto_total numeric,
  add column if not exists pago_link text,

  -- Paso 3: pago.
  add column if not exists pago_estado text,        -- pendiente | pagado | rechazado | anulado
  add column if not exists pago_medio text,         -- webpay | credito | transferencia
  add column if not exists pago_token text,
  add column if not exists pago_orden text,         -- buy order enviada a Transbank
  add column if not exists pago_monto numeric,
  add column if not exists pago_at timestamptz,
  add column if not exists pago_detalle jsonb,      -- respuesta cruda del commit

  -- SOS: despacho comprometido en 24 hrs (punto 17).
  add column if not exists sos boolean not null default false,
  add column if not exists sos_motivo text,
  add column if not exists sos_solicitado_at timestamptz,

  add column if not exists updated_at timestamptz;

alter table public.stock_solicitudes_cotizacion
  drop constraint if exists stock_solicitudes_flujo_chk;
alter table public.stock_solicitudes_cotizacion
  add constraint stock_solicitudes_flujo_chk check (flujo_estado in (
    'pendiente_aprobacion', 'aprobado_cliente', 'validado_plataforma',
    'pagado', 'rechazado', 'cancelado'
  ));

create index if not exists stock_solicitudes_flujo_idx
  on public.stock_solicitudes_cotizacion (flujo_estado);
create index if not exists stock_solicitudes_sos_idx
  on public.stock_solicitudes_cotizacion (sos) where sos;

comment on column public.stock_solicitudes_cotizacion.flujo_estado is
  'Etapa del pedido: pendiente_aprobacion → aprobado_cliente → validado_plataforma → pagado.';
comment on column public.stock_solicitudes_cotizacion.disponibilidad is
  'Existencias confirmadas por Amsodent al validar, por producto.';

-- Bitácora del pedido: cada cambio de etapa, cada reversa y cada edición.
-- Es la fuente de los KPI de tiempo de respuesta y el respaldo de quién hizo
-- qué (punto 18).
create table if not exists public.stock_solicitud_eventos (
  id           bigserial primary key,
  solicitud_id bigint not null references public.stock_solicitudes_cotizacion(id) on delete cascade,
  tipo         text not null,     -- creado | aprobado_cliente | validado | pago_iniciado | pagado | reversa | sos | rechazado | editado
  estado_desde text,
  estado_hasta text,
  actor_tipo   text,              -- cliente | plataforma | sistema
  actor_email  text,
  detalle      text,
  datos        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists stock_solicitud_eventos_idx
  on public.stock_solicitud_eventos (solicitud_id, created_at);

alter table public.stock_solicitud_eventos enable row level security;

-- Los pedidos que ya existen se dan por aprobados por el cliente: se enviaron
-- cuando no había paso de aprobación, así que no deben quedar esperando a
-- nadie.
update public.stock_solicitudes_cotizacion
   set flujo_estado = case
         when estado = 'cancelada' then 'cancelado'
         else 'aprobado_cliente'
       end,
       aprobado_cliente_at = coalesce(aprobado_cliente_at, created_at)
 where flujo_estado = 'pendiente_aprobacion'
   and created_at < now();
