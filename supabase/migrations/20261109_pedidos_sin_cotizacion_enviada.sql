-- (2026-11-09) Se retira la etapa «cotizacion_enviada» de los pedidos del portal.
--
-- Era redundante: el pedido ya muestra que se envió y que tiene cotización
-- vinculada, y el botón «Validar cotización» del cliente solo dejaba
-- constancia de su conformidad sin mover el pedido (el cliente creía haber
-- avanzado y el pedido seguía igual). Desde ahora, vincular la cotización
-- deja el pedido «en revisión» y la aceptación del cliente es pagar.
--
-- Camino feliz:
--   pendiente_aprobacion → aprobado_cliente → en_revision
--                        → validado_plataforma → pagado
--
-- El código ya lee «cotizacion_enviada» como «en_revision», así que el orden
-- entre desplegar y correr esto no importa. Las columnas
-- cotizacion_enviada_at / cotizacion_enviada_por quedan como registro.

-- Los pedidos que siguen en esa etapa pasan a «en revisión», fechados con el
-- envío de la cotización si nadie los había tomado.
update public.stock_solicitudes_cotizacion
   set flujo_estado = 'en_revision',
       revision_iniciada_at = coalesce(revision_iniciada_at, cotizacion_enviada_at, respondida_at, now()),
       revision_por = coalesce(revision_por, cotizacion_enviada_por)
 where flujo_estado = 'cotizacion_enviada';

alter table public.stock_solicitudes_cotizacion
  drop constraint if exists stock_solicitudes_flujo_chk;
alter table public.stock_solicitudes_cotizacion
  add constraint stock_solicitudes_flujo_chk check (flujo_estado in (
    'pendiente_aprobacion', 'aprobado_cliente', 'en_revision',
    'observado', 'validado_plataforma', 'pagado', 'rechazado', 'cancelado'
  ));

comment on column public.stock_solicitudes_cotizacion.flujo_estado is
  'Etapa del pedido: pendiente_aprobacion → aprobado_cliente → en_revision → validado_plataforma → pagado. observado es una parada lateral; rechazado y cancelado cierran.';
