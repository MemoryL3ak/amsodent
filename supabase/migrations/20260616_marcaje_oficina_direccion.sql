-- Dirección (texto libre) de la oficina autorizada para marcaje. Es referencial;
-- la validación del radio sigue usando latitud/longitud + radio_metros.
alter table if exists public.marcaje_oficinas
  add column if not exists direccion text;
