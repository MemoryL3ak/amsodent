-- Jerarquía madre/hija de cotizaciones (equivalencias de productos).
-- 'madre': cotización normal — al guardarla se analizan las equivalencias de
--          sus ítems (solo entidad pública) y se ofrece crear una alternativa.
-- 'hija':  cotización alternativa creada desde el popup de equivalencias; su
--          id_licitacion es un correlativo de la madre (<código madre>-1, -2…)
--          y al guardarla NO se analizan sus propias equivalencias.
-- El vínculo con la madre es licitaciones.madre_id
-- (migración 20260724_productos_equivalentes_cotizacion_madre.sql).

alter table public.licitaciones
  add column if not exists jerarquia text default 'madre';

update public.licitaciones
  set jerarquia = case when madre_id is not null then 'hija' else 'madre' end
  where jerarquia is null or (madre_id is not null and jerarquia <> 'hija');
