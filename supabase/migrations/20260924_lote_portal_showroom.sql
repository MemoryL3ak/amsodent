-- (2026-09-24) Lote de mejoras: portal cliente (Showroom, modificación de
-- cotizaciones, historial de actividades, aviso de despacho) y generales
-- (histórico de observaciones de OC, proveedores con varias condiciones de
-- compra, fecha y hora manual de la cotización).
--
-- Todo es aditivo: el código tolera que la migración no esté aplicada todavía.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Historial de actividades del portal del cliente
--    Se ve desde los dos lados: el cliente en su portal y Amsodent en el
--    portal de pedidos. Por eso guarda quién hizo qué y desde dónde, y no
--    solo el cambio de estado, que ya vive en la propia solicitud.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.portal_actividades (
  id            bigserial primary key,
  -- A quién pertenece la actividad. El RUT es el ancla: el portal autentica
  -- por RUT de cliente y un cliente puede tener varios usuarios.
  cliente_rut   text not null,
  -- Objeto al que se refiere, cuando aplica.
  solicitud_id  bigint,
  licitacion_id bigint,
  -- Quién la hizo: correo del usuario del portal, o 'amsodent' / 'sistema'.
  actor_email   text,
  actor_nombre  text,
  -- De qué lado nació: 'portal' (el cliente) o 'amsodent' (nosotros).
  origen        text not null default 'portal',
  -- pedido_enviado · pedido_aprobado · cotizacion_validada · cotizacion_modificada
  -- · despacho_en_curso · documento_subido · sesion_iniciada · …
  tipo          text not null,
  descripcion   text not null,
  metadata      jsonb,
  -- Para el aviso dentro del portal: null = el cliente todavía no lo vio.
  leido_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists portal_actividades_rut_idx
  on public.portal_actividades (cliente_rut, created_at desc);
create index if not exists portal_actividades_solicitud_idx
  on public.portal_actividades (solicitud_id);
create index if not exists portal_actividades_no_leidas_idx
  on public.portal_actividades (cliente_rut) where leido_at is null;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Observaciones de las órdenes de compra: cuándo y quién
--    La observación del módulo Saldo OC se pisaba sin dejar rastro: no se
--    sabía de cuándo era ni quién la había escrito.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.licitacion_documentos
  add column if not exists observacion_actualizada_at  timestamptz,
  add column if not exists observacion_actualizada_por text;

create table if not exists public.documento_observaciones (
  id            bigserial primary key,
  documento_id  bigint not null,
  observacion   text,
  usuario_email text,
  created_at    timestamptz not null default now()
);

create index if not exists documento_observaciones_doc_idx
  on public.documento_observaciones (documento_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Proveedores con más de una opción de compra
--    `condicion_compra` / `credito_dias` siguen existiendo y guardan la opción
--    preferida, para no romper lo que ya las lee. `condiciones_compra` es la
--    lista completa: [{ condicion, credito_dias, nota, preferida }]
-- ───────────────────────────────────────────────────────────────────────────
alter table public.proveedores
  add column if not exists condiciones_compra jsonb;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Showroom
--    Los productos ya tienen imagen_url, costo y listas de precio. Falta el
--    precio sugerido de venta al público, que es lo que el cliente le cobra a
--    su paciente, y la marca de qué entra al Showroom.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.productos
  add column if not exists precio_sugerido numeric,
  -- null = decide la categoría (Prevención e Higiene); true/false fuerza.
  add column if not exists showroom boolean;

-- De qué sección del portal nació el pedido: 'stock' | 'explorador' |
-- 'showroom'. El portal de pedidos de Amsodent los separa por acá y el KPI de
-- Showroom se calcula sobre esto.
alter table public.stock_solicitudes_cotizacion
  add column if not exists origen_seccion text;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Fecha y hora de la cotización, fijada a mano
--    `licitaciones.fecha` es un date y no guarda hora. Cuando esta columna
--    tiene valor, manda sobre fecha/created_at para mostrar y ordenar.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.licitaciones
  add column if not exists fecha_hora timestamptz;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Modificación de la cotización desde el portal
--    Cuando el cliente pide cambios, queda registrado qué pidió y sobre qué
--    cotización, sin tocar todavía los productos: eso lo aplica Amsodent.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.stock_solicitudes_cotizacion
  add column if not exists validado_cliente_at   timestamptz,
  add column if not exists validado_cliente_por  text,
  add column if not exists modificacion_pedida_at  timestamptz,
  add column if not exists modificacion_pedida_por text,
  -- [{ sku, nombre, cantidad, precio, accion: 'mantiene'|'agrega'|'quita' }]
  add column if not exists modificacion_detalle jsonb;
