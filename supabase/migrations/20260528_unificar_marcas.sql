-- Unificación de marcas de productos.
-- Problema: la columna `marca` tiene variantes que son la misma marca salvo
-- mayúsculas/espacios (ej. "SOLVENTUM", "Solventum", " Solventum "), lo que
-- duplica el listado de marcas en filtros y picker.
--
-- Estrategia: "la más usada gana" — cada grupo (misma marca ignorando
-- mayúsculas/espacios) queda con la variante recortada que tiene más productos.
-- Reejecutable: solo toca las filas que difieren del canónico.

-- 1) Casos que NO son solo mayúsculas/espacios — se alinean primero a la marca
--    correcta para que luego se fusionen con su grupo. Revisar antes de correr.
--    'Cramberry' parece typo de 'Cranberry':
update public.productos
set marca = 'Cranberry'
where lower(regexp_replace(btrim(marca), '\s+', ' ', 'g')) = 'cramberry';

--    'DifemPharma' (sin espacio) = 'Difem Pharma':
update public.productos
set marca = 'Difem Pharma'
where lower(regexp_replace(btrim(marca), '\s+', ' ', 'g')) = 'difempharma';

-- 2) Normalización general: la variante más usada de cada grupo gana.
with norm as (
  select
    id,
    regexp_replace(btrim(marca), '\s+', ' ', 'g')        as forma,
    lower(regexp_replace(btrim(marca), '\s+', ' ', 'g'))  as clave
  from public.productos
  where coalesce(btrim(marca), '') <> ''
),
conteo as (
  select clave, forma, count(*) as n
  from norm
  group by clave, forma
),
canonica as (
  select distinct on (clave) clave, forma as canonica
  from conteo
  order by clave, n desc, forma
)
update public.productos p
set marca = c.canonica
from norm n
join canonica c on c.clave = n.clave
where p.id = n.id
  and p.marca is distinct from c.canonica;
