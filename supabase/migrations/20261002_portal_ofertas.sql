-- (2026-10-02) Ofertas especiales del portal del cliente.
--
-- Una oferta es una regla: a estos productos / estas categorías / estas marcas,
-- un X % de descuento sobre el precio del cliente (lista 2), entre dos fechas.
-- El precio de oferta NO se guarda: se calcula al mostrar la vitrina y al
-- recibir el pedido, desde el precio vigente del producto.
--
-- El código tolera que esta migración no esté aplicada: sin la tabla no hay
-- ofertas vigentes y el portal muestra la pestaña vacía.

create table if not exists public.portal_ofertas (
  id            bigserial primary key,
  nombre        text not null,
  -- Texto que ve el cliente bajo el nombre de la oferta.
  descripcion   text,
  -- A qué se aplica: una lista de SKUs, de categorías o de marcas.
  alcance       text not null check (alcance in ('producto', 'categoria', 'marca')),
  valores       jsonb not null default '[]'::jsonb,
  descuento_pct numeric not null check (descuento_pct > 0 and descuento_pct < 100),
  desde         date not null,
  hasta         date not null,
  activa        boolean not null default true,
  creado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (hasta >= desde)
);

create index if not exists portal_ofertas_vigencia_idx
  on public.portal_ofertas (desde, hasta) where activa;

-- Solo el backend (service_role) lee y escribe: con RLS activo y sin
-- políticas, la llave pública del navegador no puede tocar la tabla.
alter table public.portal_ofertas enable row level security;

-- Lo mismo para las dos tablas de la migración 20261001, que quedaron sin RLS:
-- con la llave pública se podía crear una campaña de margen o un campo del
-- formulario de actividad saltándose la plataforma. Ninguna se lee directo
-- desde el navegador, así que activar RLS no cambia nada de lo que funciona.
alter table if exists public.campanas_margen  enable row level security;
alter table if exists public.actividad_campos enable row level security;
