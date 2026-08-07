-- Fecha de la última actualización de precios del producto (costo o listas).
-- La estampa el backend cuando detecta un cambio real en costo/lista1/lista2/lista3.
alter table public.productos
  add column if not exists precio_actualizado_at timestamptz;
