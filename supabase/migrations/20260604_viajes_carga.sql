-- Detalle de la carga del viaje: cuántos bultos/cajas y una descripción de lo
-- que se entrega. Complementa el módulo de despachos internos / choferes.
alter table public.viajes
  add column if not exists bultos        integer,
  add column if not exists detalle_carga text;

comment on column public.viajes.bultos is 'Cantidad de cajas/bultos a entregar en el viaje.';
comment on column public.viajes.detalle_carga is 'Descripción de la carga (qué se entrega).';
