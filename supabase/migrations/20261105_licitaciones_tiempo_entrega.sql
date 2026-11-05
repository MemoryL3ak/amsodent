-- (2026-11-05) Tiempo de entrega de la cotización. Pedido de Ariel: en las
-- cotizaciones de Mercado Público el campo «Tiempo de Entrega» es obligatorio
-- (igual que las observaciones) y sale en el PDF debajo de «Datos para
-- transferencia bancaria». Texto libre (ej. «5 días hábiles desde la orden de
-- compra»). Nueva Cotización solo envía la columna cuando trae dato y el
-- backend la quita y reintenta si falta, así el sistema opera aunque la
-- migración esté pendiente (pero el dato no se guarda hasta aplicarla).
alter table public.licitaciones add column if not exists tiempo_entrega text;
