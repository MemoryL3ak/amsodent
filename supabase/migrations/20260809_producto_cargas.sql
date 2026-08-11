-- ============================================================================
-- Historial de cargas masivas de productos, con capacidad de rollback
-- ----------------------------------------------------------------------------
-- Cada importación de catálogo (POST /productos/bulk-upsert) queda registrada
-- como una "carga", y por cada producto tocado se guarda una foto del ANTES y
-- del DESPUÉS. Eso permite deshacer una importación equivocada y devolver el
-- catálogo al estado en que estaba.
--
-- Solo se guardan los CAMPOS QUE LA CARGA ESCRIBIÓ, no la fila completa: la
-- importación nunca pisa campos ausentes del archivo, así que restaurar el
-- resto sería incorrecto además de pesado.
--
-- Convención de acceso: RLS habilitado y SIN policies — todo pasa por el
-- backend con service_role, que exige rol admin para importar y revertir.
-- ============================================================================

-- ── Cabecera: una fila por importación ──────────────────────────────────────
create table if not exists public.producto_cargas (
  id bigserial primary key,
  archivo text,                            -- nombre del .xlsx/.csv importado
  realizada_por text,                      -- email de quien importó
  total_filas integer not null default 0,  -- filas del archivo
  creados integer not null default 0,
  actualizados integer not null default 0,
  ignorados integer not null default 0,    -- filas sin SKU válido
  errores jsonb not null default '[]'::jsonb,
  estado text not null default 'aplicada'  -- aplicada | revertida
    check (estado in ('aplicada', 'revertida')),
  revertida_por text,
  revertida_at timestamptz,
  -- Si esta carga se revirtió como parte de volver a un punto anterior, deja
  -- constancia de cuál fue la carga elegida como punto de retorno.
  revertida_junto_a bigint,
  created_at timestamptz not null default now()
);

create index if not exists producto_cargas_created_idx on public.producto_cargas (created_at desc);
create index if not exists producto_cargas_estado_idx on public.producto_cargas (estado);
alter table public.producto_cargas enable row level security;

-- ── Detalle: un registro por producto tocado ────────────────────────────────
-- `antes` es null cuando el producto fue creado por esta carga (deshacerlo
-- significa borrarlo). En un update, `antes` trae solo las claves que la carga
-- modificó, con el valor que tenían previamente.
create table if not exists public.producto_carga_items (
  id bigserial primary key,
  carga_id bigint not null references public.producto_cargas (id) on delete cascade,
  producto_id bigint,                      -- puede quedar huérfano si se borra el producto
  sku text,
  accion text not null                     -- creado | actualizado
    check (accion in ('creado', 'actualizado')),
  antes jsonb,
  despues jsonb
);

create index if not exists producto_carga_items_carga_idx on public.producto_carga_items (carga_id);
create index if not exists producto_carga_items_producto_idx on public.producto_carga_items (producto_id);
alter table public.producto_carga_items enable row level security;
