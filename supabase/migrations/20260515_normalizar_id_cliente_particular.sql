-- Normalización: para todas las cotizaciones de tipo "Cliente particular",
-- el id_licitacion debe coincidir con el id interno (correlativo automático).
-- Esto sobrescribe cualquier id_licitacion manual que hubiera en esos registros.
--
-- IMPORTANTE: es una operación de una sola pasada. Después de aplicarla, los
-- registros nuevos ya quedan así desde el frontend / backend.

-- Ejecutamos en transacción para que si hay un conflicto con UNIQUE
-- (caso raro: que otra licitación no-particular ya use el mismo número como
-- id_licitacion), todo se revierte y no quedan datos a medias.
begin;

update public.licitaciones
set id_licitacion = id::text
where tipo_compra = 'Cliente particular'
  and (id_licitacion is null or id_licitacion <> id::text);

commit;
