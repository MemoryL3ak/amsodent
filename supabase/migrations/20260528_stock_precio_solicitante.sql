-- Mejoras al portal de gestión de stock:
--   1) Precio unitario por producto (lo declara el cliente) → permite valorizar
--      el inventario: total = stock_actual × precio_unitario.
--   2) Nombre de la persona que solicita la cotización, para que el equipo
--      comercial sepa con quién coordinar.
--
-- Los umbrales "stock bajo" (amarillo) y "stock crítico" (rojo) ya existen como
-- columnas stock_alerta y stock_minimo respectivamente; solo cambia la forma en
-- que el portal los captura (ahora explícitos por producto), no el esquema.

alter table public.stock_productos_cliente
  add column if not exists precio_unitario numeric(14,2);

alter table public.stock_solicitudes_cotizacion
  add column if not exists contacto_nombre text;
