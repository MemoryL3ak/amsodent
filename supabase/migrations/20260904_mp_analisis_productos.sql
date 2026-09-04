-- Análisis global de productos en Mercado Público (pedido 2026-09-04):
-- resultado agregado de las licitaciones ADJUDICADAS del rubro (calzan con el
-- catálogo mp_keywords) de los últimos 30 días, hayamos postulado o no.
-- Fila única: leerla no gasta cuota del ticket; refrescarla sí (~110 llamadas).
create table if not exists public.mp_analisis_productos (
  id integer primary key check (id = 1),
  actualizado_at timestamptz not null default now(),
  resultado jsonb
);

alter table public.mp_analisis_productos enable row level security;
-- Sin políticas: solo el backend (service_role) lee y escribe.
