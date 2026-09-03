-- Integración Bsale — etapa 1: catálogo y stock (pedido 2026-09-04).
--
-- Guarda el resultado de la última sincronización de stock contra la API de
-- Bsale (fila única, patrón mp_exploracion): resumen con contadores y detalle
-- con las diferencias de catálogo (SKUs de Bsale sin producto interno y
-- productos internos sin SKU en Bsale), para mostrarlas en el módulo
-- Inventario sin re-consultar la API.
--
-- El stock en sí NO vive aquí: la sincronización actualiza productos.stock y
-- deja cada cambio como 'ajuste' en inventario_movimientos (libro auditable),
-- igual que un conteo físico.

create table if not exists bsale_estado (
  id smallint primary key default 1 check (id = 1),
  actualizado_at timestamptz not null default now(),
  -- Contadores de la última corrida: variantes, matcheados, actualizados, etc.
  resumen jsonb,
  -- Listas de diferencias de catálogo (acotadas a 500 por lado).
  detalle jsonb
);

alter table bsale_estado enable row level security;

comment on table bsale_estado is
  'Última sincronización de stock con Bsale (fila única). El stock vive en productos.stock; cada cambio queda en inventario_movimientos.';
