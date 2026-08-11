-- Fecha de adjudicación del proceso en Mercado Público.
--
-- Es lo que interesa mirar en el panel de análisis: el cierre marca cuándo se
-- dejó de recibir ofertas, pero la adjudicación es cuándo se resolvió quién
-- ganó, que es el hito con el que se evalúa el resultado.
--
-- Origen del dato por tipo de proceso:
--   · Licitaciones (API v1) → Fechas.FechaAdjudicacion (dato oficial).
--   · Compra Ágil (API v2)  → NO existe un campo de adjudicación. Se usa
--     fechas.fecha_ultimo_cambio y SOLO cuando el proceso ya está resuelto
--     (proveedor seleccionado / OC emitida / adjudicada): en ese caso el
--     último cambio de estado ES la selección. Es una aproximación, no un
--     dato oficial; en procesos aún abiertos queda null.

alter table public.mp_resultados
  add column if not exists fecha_adjudicacion timestamptz;
