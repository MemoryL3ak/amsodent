-- Meta de CANTIDAD (ventas adjudicadas) por vendedor y canal_base.
--
-- Sigue el mismo desglose por canal que la meta en monto
-- (vendedor_metas_canal_partes_mensuales):
--   canal único  -> 1 fila  (1 meta de cantidad)
--   canal mixto  -> 2 filas (público + particular)
--
-- El avance se mide contando las cotizaciones adjudicadas del periodo
-- (1ª OC / factura-boleta / efectivo), separadas en Particular vs Mercado.
alter table if exists public.vendedor_metas_canal_partes_mensuales
  add column if not exists meta_cantidad integer not null default 0;
