-- (2026-09-16) Estado del envío en cotizaciones de cliente particular.
--
-- El particular compra y espera su pedido: hace falta poder decirle en qué
-- va sin depender de que exista una guía cargada. Es un estado operativo
-- editable a mano desde el detalle de la cotización (no reemplaza el
-- tracking del courier, que vive en el documento de la guía).
alter table public.licitaciones
  add column if not exists estado_envio text,
  add column if not exists estado_envio_actualizado_at timestamptz;

comment on column public.licitaciones.estado_envio is
  'Estado del envío para cliente particular: preparando | listo | en_transito | en_reparto | entregado | retirado | devuelto.';
comment on column public.licitaciones.estado_envio_actualizado_at is
  'Cuándo se cambió por última vez el estado del envío.';
