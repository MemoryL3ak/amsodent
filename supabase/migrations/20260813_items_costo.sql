-- Costo unitario con el que se calculó el margen de la cotización al momento
-- de guardarla (incluye el costo editado a mano en la cotización, que antes
-- vivía solo en el JSON de la licitación y los paneles no lo veían: el KPI de
-- margen se calculaba siempre con el costo vigente del catálogo).
-- NULL = fila anterior a esta columna → los paneles usan el costo del catálogo,
-- como siempre lo hicieron.
alter table items_licitacion
  add column if not exists costo numeric;

comment on column items_licitacion.costo is
  'Costo unitario usado para el margen al guardar la cotización (manual o de catálogo). NULL = usar costo de catálogo.';
