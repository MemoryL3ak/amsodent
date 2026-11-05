-- (2026-11-05) Un solo módulo de campañas. Pedidos de Ariel:
--   · "Eliminar módulo Campañas (queda solamente Campañas de margen)".
--   · "Al crear una campaña, tenemos fecha de vigencia y límite de productos.
--     La campaña puede finalizar antes de la fecha si los productos llegan a
--     la capacidad máxima declarada. Cada venta realizada va sumando este
--     contador."
--   · "La campaña de portal Amsodent y portal cliente se deben gestionar desde
--     el único módulo campaña de margen."
--
-- 1. canal: dónde rige la campaña — 'plataforma' (cotizar en la plataforma),
--    'portal' (pestaña «Ofertas» del portal del cliente) o 'ambos'. Las que ya
--    existían quedan en 'plataforma'.
alter table public.campanas_margen add column if not exists canal text not null default 'plataforma';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campanas_margen_canal_check') then
    alter table public.campanas_margen
      add constraint campanas_margen_canal_check check (canal in ('plataforma', 'portal', 'ambos'));
  end if;
end $$;

-- 2. limite_unidades: cupo total de unidades de la campaña (null = sin límite).
--    Las unidades vendidas no se guardan: se cuentan desde las líneas de las
--    cotizaciones adjudicadas (punto 3), así el contador no se descuadra si
--    una venta se revierte.
alter table public.campanas_margen add column if not exists limite_unidades integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campanas_margen_limite_check') then
    alter table public.campanas_margen
      add constraint campanas_margen_limite_check check (limite_unidades is null or limite_unidades >= 1);
  end if;
end $$;

-- 3. Con qué campaña se vendió cada línea de una cotización. La pone la
--    pantalla de cotización cuando el precio de la línea es el de la campaña
--    (o cuando la línea viene de un pedido del portal con oferta). Al
--    adjudicarse la cotización, sus unidades suman al cupo.
alter table public.items_licitacion add column if not exists campana_margen_id bigint;
create index if not exists items_licitacion_campana_margen_idx
  on public.items_licitacion (campana_margen_id)
  where campana_margen_id is not null;

-- 4. Las «Ofertas del Portal» pasan a ser campañas de canal 'portal'. Se
--    copian las que existan (hoy son pocas y ya vencidas) para conservar la
--    historia; `oferta_portal_id` evita copiarlas dos veces si la migración se
--    vuelve a correr. La tabla portal_ofertas queda sin uso.
alter table public.campanas_margen add column if not exists oferta_portal_id bigint;
do $$
begin
  if to_regclass('public.portal_ofertas') is not null then
    insert into public.campanas_margen
      (nombre, descripcion, lista_precios, marcas, categorias, skus, margen_pct, desde, hasta, activa, creado_por, created_at, canal, oferta_portal_id)
    select
      o.nombre,
      o.descripcion,
      2,
      case when o.alcance = 'marca' then coalesce(o.valores, '[]'::jsonb) else '[]'::jsonb end,
      case when o.alcance = 'categoria' then coalesce(o.valores, '[]'::jsonb) else '[]'::jsonb end,
      case when o.alcance = 'producto' then coalesce(o.valores, '[]'::jsonb) else '[]'::jsonb end,
      least(o.descuento_pct, 94.99),
      o.desde,
      o.hasta,
      o.activa,
      o.creado_por,
      o.created_at,
      'portal',
      o.id
    from public.portal_ofertas o
    where not exists (select 1 from public.campanas_margen c where c.oferta_portal_id = o.id);
  end if;
end $$;
