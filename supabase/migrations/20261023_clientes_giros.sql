-- Migración 2026-10-23: varios giros por cliente (pedido de Ariel).
-- Hasta ahora el giro vivía solo en la cotización (licitaciones.giro, texto
-- libre) y la ficha del cliente no tenía giro. Ahora la ficha guarda una
-- LISTA de giros (el primero es el principal). Bsale guarda un solo texto de
-- giro por cliente (`activity`): el backend manda los giros unidos con « / ».
-- Re-ejecutable.

alter table public.clientes
  add column if not exists giros text[] not null default '{}';

comment on column public.clientes.giros is
  'Giros del cliente; el primero es el principal. Se envían a Bsale unidos con " / " en el campo activity (bsale-clientes.service.ts).';

-- Relleno inicial: los giros que ya se escribieron en las cotizaciones de cada
-- cliente (mismo RUT, comparado sin puntos ni guion), de la más reciente a la
-- más antigua, sin repetidos (sin distinguir mayúsculas) y hasta 6. Solo para
-- las fichas que aún no tienen giros.
with cot as (
  select upper(regexp_replace(coalesce(l.rut_entidad, ''), '[^0-9kK]', '', 'g')) as rut_n,
         lower(btrim(l.giro)) as clave,
         (array_agg(left(btrim(l.giro), 80) order by l.created_at desc nulls last))[1] as giro,
         max(l.created_at) as ultima
    from public.licitaciones l
   where coalesce(btrim(l.giro), '') <> ''
   group by 1, 2
),
agrupado as (
  select rut_n,
         (array_agg(giro order by ultima desc nulls last))[1:6] as giros
    from cot
   where rut_n <> ''
   group by rut_n
)
update public.clientes c
   set giros = a.giros
  from agrupado a
 where upper(regexp_replace(coalesce(c.rut, ''), '[^0-9kK]', '', 'g')) = a.rut_n
   and coalesce(array_length(c.giros, 1), 0) = 0;
