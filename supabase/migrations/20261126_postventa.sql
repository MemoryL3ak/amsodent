-- (2026-11-26) Módulo de Postventa. Pedido de Ariel: «Generar módulo de
-- postventa. En este módulo se deben registrar los reclamos generados de los
-- clientes a los vendedores según la categoría correspondiente: 1. Productos
-- en mal estado; 2. Fecha de vencimiento; 3. Producto no corresponde;
-- 4. Faltan cantidades; 5. Sobran cantidades; 6. Cambio a petición del
-- cliente; 7. Gestión de Apelación de Multa; 8. Otros. Gestionar la solicitud
-- de postventa. Las acciones posibles son: Emisión de NC, Emisión de otra
-- factura, emisión de guía de despacho. Agregar módulo de solicitud de
-- postventa en portal de cliente.»
--
-- Dos tablas:
--   · postventa_solicitudes: el reclamo (de la plataforma o del portal del
--     cliente), con su categoría, el cliente, la cotización y el documento
--     afectado si se conocen, los productos, el vendedor responsable y el
--     estado (ingresada → en_gestion → resuelta | rechazada).
--   · postventa_gestiones: la bitácora de la solicitud (comentarios, cambios
--     de estado y las tres acciones: nota de crédito, factura, guía). El
--     documento emitido se asocia eligiéndolo de licitacion_documentos o
--     escribiendo su número. `visible_cliente` decide qué ve el cliente en su
--     portal: los comentarios son internos salvo que se marquen.
--
-- Aditiva e idempotente. Solo el backend (service_role) lee y escribe: RLS
-- habilitado y sin políticas. El servidor avisa con un mensaje claro si
-- todavía no está aplicada.
create table if not exists public.postventa_solicitudes (
  id                bigserial primary key,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- plataforma (la registra el equipo) | portal (la envía el cliente)
  origen            text not null default 'plataforma' check (origen in ('plataforma', 'portal')),
  categoria         text not null check (categoria in (
                      'producto_mal_estado', 'fecha_vencimiento', 'producto_no_corresponde', 'faltan_cantidades',
                      'sobran_cantidades', 'cambio_peticion_cliente', 'apelacion_multa', 'otros')),
  descripcion       text not null,
  -- RUT normalizado: solo dígitos y «k», en minúsculas (como en el portal)
  cliente_rut       text not null,
  cliente_nombre    text,
  -- La cotización o venta afectada, si se conoce
  licitacion_id     bigint references public.licitaciones(id) on delete set null,
  -- Documento afectado: factura (o boleta) o guía de despacho
  documento_tipo    text check (documento_tipo is null or documento_tipo in ('factura', 'guia_despacho')),
  documento_numero  text,
  documento_id      bigint references public.licitacion_documentos(id) on delete set null,
  -- Pedido del portal afectado (stock_solicitudes_cotizacion.id), si el cliente lo eligió
  pedido_id         bigint,
  -- [{ "sku": "...", "nombre": "...", "cantidad": 2 }]
  productos         jsonb not null default '[]'::jsonb,
  -- Vendedor responsable (correo interno); null = sin asignar
  vendedor_email    text,
  -- Quién la registró: correo interno o del usuario del portal
  creada_por        text,
  creada_por_nombre text,
  portal_usuario_id bigint,
  estado            text not null default 'ingresada' check (estado in ('ingresada', 'en_gestion', 'resuelta', 'rechazada')),
  tomada_at         timestamptz,
  tomada_por        text,
  -- Resolución o motivo del cierre (el cliente la ve si la solicitud vino del portal)
  resolucion        text,
  cerrada_at        timestamptz,
  cerrada_por       text
);
create index if not exists postventa_solicitudes_fecha_idx on public.postventa_solicitudes (id desc);
create index if not exists postventa_solicitudes_rut_idx on public.postventa_solicitudes (cliente_rut, id desc);
create index if not exists postventa_solicitudes_vendedor_idx on public.postventa_solicitudes (vendedor_email, id desc);
create index if not exists postventa_solicitudes_estado_idx on public.postventa_solicitudes (estado);
create index if not exists postventa_solicitudes_licitacion_idx on public.postventa_solicitudes (licitacion_id) where licitacion_id is not null;

create table if not exists public.postventa_gestiones (
  id               bigserial primary key,
  solicitud_id     bigint not null references public.postventa_solicitudes(id) on delete cascade,
  -- comentario | cambio_estado | nota_credito | factura | guia_despacho
  tipo             text not null check (tipo in ('comentario', 'cambio_estado', 'nota_credito', 'factura', 'guia_despacho')),
  detalle          text,
  -- Solo en cambio_estado: a qué estado pasó
  estado_nuevo     text,
  -- Documento emitido por la acción: elegido de la cotización o escrito a mano
  documento_numero text,
  documento_id     bigint references public.licitacion_documentos(id) on delete set null,
  -- ¿Lo ve el cliente en su portal? Los comentarios, solo si se marcan
  visible_cliente  boolean not null default false,
  usuario_email    text,
  usuario_nombre   text,
  created_at       timestamptz not null default now()
);
create index if not exists postventa_gestiones_solicitud_idx on public.postventa_gestiones (solicitud_id, id);

alter table public.postventa_solicitudes enable row level security;
alter table public.postventa_gestiones enable row level security;

comment on table public.postventa_solicitudes is
  'Solicitudes de postventa (reclamos de clientes): desde la plataforma o desde el portal del cliente.';
comment on table public.postventa_gestiones is
  'Bitácora de cada solicitud de postventa: comentarios, cambios de estado y documentos emitidos (NC, factura, guía).';
