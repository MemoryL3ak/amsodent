-- Productos equivalentes + jerarquía de cotizaciones madre/hija.
--
-- 1) Cada producto puede declarar hasta 3 productos equivalentes (por SKU).
--    Al guardar una cotización, si algún ítem tiene equivalencias se ofrece
--    crear una cotización alternativa (hija) usando esas equivalencias.
-- 2) Las cotizaciones hijas guardan la referencia a su cotización madre
--    (madre_id). Las hijas no vuelven a analizar equivalencias al guardarse.

alter table public.productos
  add column if not exists equivalente_1 text,
  add column if not exists equivalente_2 text,
  add column if not exists equivalente_3 text;

alter table public.licitaciones
  add column if not exists madre_id bigint references public.licitaciones(id) on delete set null;

create index if not exists licitaciones_madre_idx on public.licitaciones (madre_id);
