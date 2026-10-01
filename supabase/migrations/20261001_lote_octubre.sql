-- (2026-10-01) Lote de mejoras de octubre. Todo aditivo: el código tolera que
-- la migración no esté aplicada todavía.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Ámbito de las tiendas del explorador
--    El explorador existe en dos lugares con públicos distintos: el del
--    cliente (en su portal) y el interno de la plataforma. No siempre
--    conviene mostrarle al cliente las mismas tiendas que miramos nosotros.
--    'ambos' conserva el comportamiento actual, que es lo que tienen hoy.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.explorador_tiendas
  add column if not exists ambito text not null default 'ambos'
  check (ambito in ('ambos', 'cliente', 'plataforma'));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Campos propios en las actividades de la bitácora
--    La ficha de actividad tenía los campos fijos del código. Acá se definen
--    campos extra (texto, número, fecha, lista de opciones, sí/no) que
--    aparecen en el formulario y en el detalle; el valor de cada actividad
--    vive en `campos_extra`, para no agregar una columna por cada campo.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.actividad_campos (
  id          bigserial primary key,
  -- Identificador estable del campo dentro de `campos_extra`.
  clave       text not null unique,
  etiqueta    text not null,
  -- texto | texto_largo | numero | fecha | opciones | si_no
  tipo        text not null default 'texto',
  -- Para tipo 'opciones': ["Ganada","Perdida",…]
  opciones    jsonb,
  obligatorio boolean not null default false,
  activo      boolean not null default true,
  orden       integer not null default 0,
  ayuda       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.actividades_cliente
  add column if not exists campos_extra jsonb;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Campañas de margen por marca y categoría
--    Una campaña define un margen objetivo para los productos de ciertas
--    marcas y/o categorías, sobre una lista de precios, con vigencia. El
--    precio de campaña manda mientras está vigente y al terminar vuelve solo
--    el precio normal: no se reescribe el catálogo.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.campanas_margen (
  id             bigserial primary key,
  nombre         text not null,
  descripcion    text,
  -- 1 | 2 | 3: sobre qué lista se aplica.
  lista_precios  smallint not null default 1 check (lista_precios between 1 and 3),
  -- Alcance. Vacío = todas.
  marcas         jsonb not null default '[]'::jsonb,
  categorias     jsonb not null default '[]'::jsonb,
  -- Margen objetivo en porcentaje sobre el precio de venta (0-95).
  margen_pct     numeric not null check (margen_pct >= 0 and margen_pct < 95),
  desde          date not null,
  hasta          date not null,
  activa         boolean not null default true,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (hasta >= desde)
);

create index if not exists campanas_margen_vigencia_idx
  on public.campanas_margen (desde, hasta) where activa;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Pagos con tarjeta: comisión del medio y cuotas
--    · `comision_pago` va en el COMPROBANTE, en bruto: lo que Transbank/Getnet
--      descuenta antes de depositar. No se recibió, pero tampoco es deuda del
--      cliente, así que salda la factura igual (factura 772: $12.079, se
--      recibieron $11.975, comisión $104).
--    · `cuotas_total` va en la FACTURA: en cuántas cuotas se pagó. Cada abono
--      que deposita el medio de pago es un comprobante; "3 de 6" sale de
--      contar los abonos contra este número.
--    El medio (transbank / getnet) se guarda en `forma_pago`, que ya existe.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.licitacion_documentos
  add column if not exists comision_pago numeric,
  add column if not exists cuotas_total  smallint;
