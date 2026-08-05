-- Despacho interno: flete = km IDA Y VUELTA (bodega → cliente → bodega)
-- × valor por km configurado. Sin tramos: configuración mínima.
--
-- fletes_interno_config: fila única con la dirección de origen (bodega), sus
--   coordenadas (geocodificadas al guardar o en el primer cálculo) y el valor
--   NETO por kilómetro.

drop table if exists public.fletes_tarifas_interno;

create table if not exists public.fletes_interno_config (
  id smallint primary key default 1 check (id = 1),
  direccion_origen text,
  origen_lat numeric,
  origen_lng numeric,
  valor_km numeric not null default 0
);

-- Por si se aplicó la versión anterior de esta migración (config con tramos).
alter table public.fletes_interno_config add column if not exists valor_km numeric not null default 0;
alter table public.fletes_interno_config drop column if exists tarifa_km_extra;

insert into public.fletes_interno_config (id) values (1)
on conflict (id) do nothing;

alter table public.fletes_interno_config enable row level security;
