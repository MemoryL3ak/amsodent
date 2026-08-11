-- ============================================================================
-- Cierre automático de postulaciones vencidas
-- ----------------------------------------------------------------------------
-- Hasta ahora "caducada" se calculaba al vuelo en la pantalla desde el texto
-- de `datos->>'cierre'`. Eso dejaba dos cabos sueltos:
--   · el contador de "Pendientes" incluía postulaciones a las que ya no se
--     podía postular, así que decía más de lo que realmente había por hacer;
--   · una postulación TOMADA que vencía seguía ocupando uno de los 3 cupos de
--     su dueño para siempre, sin forma de liberarla salvo a mano.
-- Con el cierre persistido, el backend puede marcarlas y soltar la reserva.
--
-- Por qué no se calcula en SQL: `datos->>'cierre'` es texto libre y llega en
-- formatos distintos según el origen ("2026-08-08 17:50" del buscador de
-- Mercado Público, "11-08-26 10:00" del xlsx del portal). Interpretarlo se
-- hace en el backend, que ya tiene el parser, y aquí solo se guarda el
-- resultado.
-- ============================================================================

alter table public.licitaciones_disponibles
  add column if not exists cerrada boolean not null default false,
  add column if not exists cerrada_at timestamptz;

-- El listado filtra por este campo en casi todas las vistas.
create index if not exists licitaciones_disponibles_cerrada_idx
  on public.licitaciones_disponibles (cerrada);

-- Marca de una sola vez las que ya estaban vencidas y traen la fecha en
-- formato ISO ("AAAA-MM-DD HH:mm"), que son las que vinieron del buscador de
-- Mercado Público y sí se pueden comparar en SQL. El resto las cierra el
-- backend en su primera pasada, que entiende todos los formatos.
update public.licitaciones_disponibles
   set cerrada = true,
       cerrada_at = now()
 where cerrada = false
   and datos->>'cierre' ~ '^\d{4}-\d{2}-\d{2}'
   and (datos->>'cierre')::timestamp < now();
