-- Análisis global de productos MP: estado de la última corrida (2026-10-02).
-- Antes, si la corrida fallaba o el servidor se reiniciaba a mitad, la
-- pantalla quedaba vacía sin explicación. Ahora la fila dice en qué quedó.
--   estado: corriendo | ok | error
alter table if exists public.mp_analisis_productos
  add column if not exists estado    text,
  add column if not exists error     text,
  add column if not exists inicio_at timestamptz;
