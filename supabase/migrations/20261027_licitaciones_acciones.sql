-- Migración 2026-10-27: historial de acciones de cada cotización (pedido de Ariel).
-- Quién hizo qué y cuándo: guardados que cambian datos (con el antes y el
-- después), aprobaciones, cambios de estado y documentos cargados, editados o
-- eliminados. Lo ven los administradores en Historial → Acciones.
-- Origen: la 608-6552-COT26 se aprobó y un guardado con el estado viejo la
-- devolvió a «Pendiente Aprobación Peso» 51 s después; solo se supo leyendo el
-- registro HTTP del monitor, que guarda 30 días y no dice qué cambió.
-- Sin esta tabla el backend no registra nada y el historial se arma con ese
-- registro HTTP. Re-ejecutable.

create table if not exists public.licitaciones_acciones (
  id             bigserial primary key,
  licitacion_id  bigint not null references public.licitaciones(id) on delete cascade,
  accion         text not null,                 -- aprobacion | estado | edicion | documento
  detalle        text not null,                 -- en palabras, tal como se muestra
  cambios        jsonb,                         -- { campo: [antes, después] }
  usuario_email  text,                          -- null = proceso automático
  created_at     timestamptz not null default now()
);

create index if not exists licitaciones_acciones_lic_idx
  on public.licitaciones_acciones (licitacion_id, created_at);

comment on table public.licitaciones_acciones is
  'Historial de acciones por cotización (licitaciones.service.ts → registrarAccion). Lo leen los admin en Historial → Acciones.';

-- Solo el backend (llave de servicio) lee y escribe.
alter table public.licitaciones_acciones enable row level security;
