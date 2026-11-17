-- (2026-11-17) Costo de la recepción de stock mayor que el del producto.
-- Pedido de Ariel: «si se reconoce que en recepción de stock el último costo
-- es superior, levantar alerta para confirmar si es modificación de costo
-- definitiva o momentánea».
--
-- La alerta se calcula en vivo (la última recepción registrada de cada producto
-- contra su costo actual) y se resuelve en Productos → Actualización de precios:
--   · definitiva  → el costo del producto pasa a ser el de la recepción;
--   · momentánea  → el costo del producto se mantiene.
-- Estas columnas guardan lo que se decidió (sin ellas, «momentánea» no tiene
-- dónde quedar anotada y la alerta volvería a aparecer) y el costo que tenía el
-- producto al recibir. Aditiva: se puede correr más de una vez.

alter table public.recepcion_stock_lineas add column if not exists costo_catalogo numeric(14,2);      -- costo del producto al registrar la recepción
alter table public.recepcion_stock_lineas add column if not exists costo_decision text;               -- null = sin decidir
alter table public.recepcion_stock_lineas add column if not exists costo_decision_por text;
alter table public.recepcion_stock_lineas add column if not exists costo_decision_at timestamptz;

alter table public.recepcion_stock_lineas drop constraint if exists recepcion_stock_lineas_costo_decision_check;
alter table public.recepcion_stock_lineas
  add constraint recepcion_stock_lineas_costo_decision_check
  check (costo_decision is null or costo_decision in ('definitiva', 'momentanea'));

-- La última línea recibida de cada producto.
create index if not exists recepcion_stock_lineas_producto_ultima_idx on public.recepcion_stock_lineas (producto_id, id desc);
