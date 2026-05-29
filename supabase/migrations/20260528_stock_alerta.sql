-- Cliente ahora declara dos umbrales por producto:
--   stock_minimo  → si actual ≤ este valor, semáforo = rojo (crítico)
--   stock_alerta  → si actual ≤ este valor y > stock_minimo, semáforo = amarillo
-- Si stock_alerta no se declara, el backend cae al fallback 1.5×minimo
-- (comportamiento anterior, para no romper datos viejos).
alter table public.stock_productos_cliente
  add column if not exists stock_alerta numeric(14,2);
