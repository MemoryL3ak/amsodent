-- Monto (neto) "por consumir" capturado en el instante en que se fuerza el
-- cierre de ciclo (botón "Cerrar ciclo" en Trazabilidad). Es la diferencia
-- OC − guías de despacho al momento del cierre. NULL si el ciclo está abierto.
-- Alimenta la tarjeta "Monto total forzado a cierre" del Resumen Comercial.
alter table public.licitaciones
  add column if not exists monto_forzado numeric;

comment on column public.licitaciones.monto_forzado is
  'Monto neto por consumir (OC - guías) capturado al forzar el cierre de ciclo. NULL si el ciclo está abierto.';
