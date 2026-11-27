-- (2026-11-27) Relleno de «creado por» para los clientes antiguos. Ariel, al
-- ver la ficha: «en todos los casos dice creado por "Sin registro"… ¿no puedes
-- ver tú quién lo creó?».
--
-- El relleno anterior (20261127_clientes_creado_por.sql) solo alcanzaba los
-- ~30 días que guarda el monitoreo. Pero la mayoría de los clientes nace SOLO
-- al guardar una cotización nueva: la cotización y el cliente quedan creados
-- en el mismo instante, con el mismo RUT, y la cotización sí guarda quién la
-- hizo (licitaciones.creado_por). Entonces:
--
--   cliente sin creador + cotización del mismo RUT creada a menos de 2 minutos
--   de la creación del cliente  →  lo creó quien hizo esa cotización.
--
-- Solo se atribuye si en esa ventana hay UNA única persona. No toca a los que
-- ya tienen dato. Los clientes cargados en masa o creados a mano desde
-- Clientes (sin cotización en ese momento) siguen sin registro: de ellos no
-- quedó guardado nada. Idempotente.
with cot as (
  select upper(regexp_replace(coalesce(l.rut_entidad, ''), '[^0-9kK]', '', 'g')) as rut_n,
         l.created_at,
         lower(btrim(l.creado_por)) as quien
    from public.licitaciones l
   where coalesce(btrim(l.creado_por), '') <> ''
     and l.created_at is not null
),
cli as (
  select c.id, c.created_at,
         upper(regexp_replace(coalesce(c.rut, ''), '[^0-9kK]', '', 'g')) as rut_n
    from public.clientes c
   where c.creado_por is null
),
atribuido as (
  select c.id, min(k.quien) as quien
    from cli c
    join cot k
      on k.rut_n = c.rut_n
     and k.created_at between c.created_at - interval '2 minutes' and c.created_at + interval '2 minutes'
   where c.rut_n <> ''
   group by c.id
  having count(distinct k.quien) = 1
)
update public.clientes c
   set creado_por = a.quien
  from atribuido a
 where c.id = a.id
   and c.creado_por is null;
