-- (2026-11-09) Estados intermedios de la validación de los pedidos del portal.
--
-- Entre «el cliente aprobó» y «validado y por pagar» pasaban varias cosas que
-- la etapa no mostraba: alguien de Amsodent tomaba el pedido, se le enviaba
-- una cotización al cliente, a veces había que preguntarle algo (un producto
-- sin stock, un reemplazo). El cliente veía «En revisión de Amsodent» durante
-- días sin saber si alguien lo estaba mirando, y la bandeja no sabía quién lo
-- tenía. Además el flujo no tenía cómo rechazar o cancelar un pedido: los
-- estados `rechazado` y `cancelado` existían en la restricción pero nada los
-- escribía.
--
-- Camino feliz:
--   pendiente_aprobacion → aprobado_cliente → en_revision → cotizacion_enviada
--                        → validado_plataforma → pagado
--
--   en_revision          alguien de Amsodent tomó el pedido (quién y cuándo).
--   cotizacion_enviada   se vinculó una cotización: el cliente la revisa y la
--                        da por buena o pide cambios.
--   observado            (parada lateral) Amsodent necesita una respuesta del
--                        cliente antes de seguir. El cliente acepta y vuelve a
--                        en_revision, o modifica el pedido (→ aprobado_cliente).
--   rechazado            Amsodent lo rechazó con motivo; el estado comercial
--                        queda «cancelada».
--
-- Todo es aditivo: el código tolera que la migración no esté aplicada, salvo
-- para mover un pedido a un estado nuevo (la restricción lo impide y el
-- servidor lo dice con este nombre de archivo).

alter table public.stock_solicitudes_cotizacion
  -- Alguien de Amsodent tomó el pedido.
  add column if not exists revision_iniciada_at timestamptz,
  add column if not exists revision_por text,

  -- Se vinculó la cotización y se le avisó al cliente.
  add column if not exists cotizacion_enviada_at timestamptz,
  add column if not exists cotizacion_enviada_por text,

  -- Observación abierta por Amsodent y la respuesta del cliente.
  add column if not exists observacion_at timestamptz,
  add column if not exists observacion_por text,
  add column if not exists observacion_texto text,
  add column if not exists observacion_respondida_at timestamptz,
  add column if not exists observacion_respondida_por text,
  add column if not exists observacion_respuesta text,

  -- Rechazo desde la plataforma.
  add column if not exists rechazado_at timestamptz,
  add column if not exists rechazado_por text,
  add column if not exists rechazo_motivo text;

alter table public.stock_solicitudes_cotizacion
  drop constraint if exists stock_solicitudes_flujo_chk;
alter table public.stock_solicitudes_cotizacion
  add constraint stock_solicitudes_flujo_chk check (flujo_estado in (
    'pendiente_aprobacion', 'aprobado_cliente', 'en_revision', 'cotizacion_enviada',
    'observado', 'validado_plataforma', 'pagado', 'rechazado', 'cancelado'
  ));

comment on column public.stock_solicitudes_cotizacion.flujo_estado is
  'Etapa del pedido: pendiente_aprobacion → aprobado_cliente → en_revision → cotizacion_enviada → validado_plataforma → pagado. observado es una parada lateral; rechazado y cancelado cierran.';
comment on column public.stock_solicitudes_cotizacion.observacion_texto is
  'Lo que Amsodent necesita que el cliente responda antes de seguir con el pedido.';

-- Los pedidos que ya tienen una cotización vinculada y siguen en
-- «aprobado_cliente» están, de hecho, con la cotización enviada: se les pone
-- la etapa que corresponde, fechada con la respuesta.
update public.stock_solicitudes_cotizacion
   set flujo_estado = 'cotizacion_enviada',
       cotizacion_enviada_at = coalesce(cotizacion_enviada_at, respondida_at, created_at)
 where flujo_estado = 'aprobado_cliente'
   and licitacion_id is not null;

-- Los pedidos con estado comercial «cancelada» que seguían con una etapa
-- abierta pasan a «cancelado» en el flujo (nunca se sincronizaron).
update public.stock_solicitudes_cotizacion
   set flujo_estado = 'cancelado'
 where estado = 'cancelada'
   and flujo_estado not in ('pagado', 'rechazado', 'cancelado');
