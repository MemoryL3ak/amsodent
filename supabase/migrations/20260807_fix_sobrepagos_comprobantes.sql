-- Corrección de DATOS (sin cambios de lógica): sobrepagos en Seguimiento de Pagos.
--
-- Regla pedida: en toda factura/boleta en estado PAGADA cuyo monto pagado
-- supere en más de un 1,19% el total a pagar, el pagado debe quedar IGUAL al
-- total a pagar (saldo $0).
--
-- Con la lógica de producción, el "Pagado" del módulo es la suma de los
-- documentos de pago de la cotización (comprobante_pago, webpay, efectivo),
-- guardados en NETO y mostrados en bruto (× 1,19), para TODO tipo de cliente.
-- El total a pagar (bruto − notas de crédito) usa como base:
--   · Cliente Particular → bruto de la factura/boleta (monto neto × 1,19).
--   · Entidad Pública    → bruto de la suma de sus OC (neto × 1,19); sin OC
--     cae al total_con_iva de la cotización (o total_sin_iva × 1,19).
-- El sobrante viene de montos que quedaron guardados en BRUTO (la migración
-- 20260804 solo corrigió los que calzaban exacto con el bruto de la factura;
-- aquí se cubren los demás casos).
--
-- Método, por cada cotización afectada:
--   1. Se respalda el estado previo en licitacion_documentos_backup_20260807.
--   2. Se reescalan proporcionalmente los montos de sus documentos de pago
--      para que la suma en bruto calce con el total a pagar.
--   3. El residuo de redondeo (± algunos pesos) se absorbe en el documento
--      de mayor monto, dejando el saldo dentro de la tolerancia de $1 que
--      usa Seguimiento de Pagos.
--
-- ─── PREVIEW (ejecutar primero, no modifica nada) ───────────────────────────
-- with fact as (
--   select d.licitacion_id, max(coalesce(d.monto, 0)) as fac_neto
--   from licitacion_documentos d
--   where d.tipo in ('factura', 'factura_boleta') and d.pagada is true
--   group by d.licitacion_id
-- ), oc as (
--   select licitacion_id, sum(coalesce(monto, 0)) as oc_neto
--   from licitacion_documentos where tipo = 'orden_compra' group by licitacion_id
-- ), nc as (
--   select licitacion_id, sum(coalesce(monto, 0)) as nc_sum
--   from licitacion_documentos where tipo = 'nota_credito' group by licitacion_id
-- ), pagos as (
--   select licitacion_id, sum(round(monto * 1.19)) as pagado_bruto
--   from licitacion_documentos
--   where tipo in ('comprobante_pago', 'webpay', 'efectivo') and coalesce(monto, 0) > 0
--   group by licitacion_id
-- ), deuda as (
--   select f.licitacion_id,
--          case
--            when lower(coalesce(l.tipo_cliente, '')) like '%particular%' then
--              case when f.fac_neto > 0 then round(f.fac_neto * 1.19)
--                   else coalesce(nullif(l.total_con_iva, 0), 0) end
--            else
--              case when coalesce(oc.oc_neto, 0) > 0 then round(oc.oc_neto * 1.19)
--                   when coalesce(l.total_con_iva, 0) > 0 then l.total_con_iva
--                   else round(coalesce(l.total_sin_iva, 0) * 1.19) end
--          end - coalesce(nc.nc_sum, 0) as deuda_bruto
--   from fact f
--   join licitaciones l on l.id = f.licitacion_id
--   left join oc using (licitacion_id)
--   left join nc using (licitacion_id)
-- )
-- select d.licitacion_id, d.deuda_bruto, p.pagado_bruto,
--        p.pagado_bruto - d.deuda_bruto as excedente
-- from deuda d
-- join pagos p using (licitacion_id)
-- where d.deuda_bruto > 0
--   and p.pagado_bruto > round(d.deuda_bruto * 1.0119)
-- order by excedente desc;
-- ────────────────────────────────────────────────────────────────────────────

-- Respaldo de los documentos que se van a modificar (idempotente).
create table if not exists licitacion_documentos_backup_20260807 (
  id bigint primary key,
  licitacion_id bigint,
  tipo text,
  monto numeric,
  respaldado_en timestamptz default now()
);

do $$
declare
  r record;
  v_pagado_bruto numeric;
  v_residuo numeric;
  v_doc_id bigint;
begin
  for r in (
    with fact as (
      select d.licitacion_id, max(coalesce(d.monto, 0)) as fac_neto
      from licitacion_documentos d
      where d.tipo in ('factura', 'factura_boleta') and d.pagada is true
      group by d.licitacion_id
    ), oc as (
      select licitacion_id, sum(coalesce(monto, 0)) as oc_neto
      from licitacion_documentos where tipo = 'orden_compra' group by licitacion_id
    ), nc as (
      select licitacion_id, sum(coalesce(monto, 0)) as nc_sum
      from licitacion_documentos where tipo = 'nota_credito' group by licitacion_id
    ), pagos as (
      select licitacion_id, sum(round(monto * 1.19)) as pagado_bruto
      from licitacion_documentos
      where tipo in ('comprobante_pago', 'webpay', 'efectivo')
        and coalesce(monto, 0) > 0
      group by licitacion_id
    ), deuda as (
      select f.licitacion_id,
             case
               when lower(coalesce(l.tipo_cliente, '')) like '%particular%' then
                 case when f.fac_neto > 0 then round(f.fac_neto * 1.19)
                      else coalesce(nullif(l.total_con_iva, 0), 0) end
               else
                 case when coalesce(oc.oc_neto, 0) > 0 then round(oc.oc_neto * 1.19)
                      when coalesce(l.total_con_iva, 0) > 0 then l.total_con_iva
                      else round(coalesce(l.total_sin_iva, 0) * 1.19) end
             end - coalesce(nc.nc_sum, 0) as deuda_bruto
      from fact f
      join licitaciones l on l.id = f.licitacion_id
      left join oc using (licitacion_id)
      left join nc using (licitacion_id)
    )
    select d.licitacion_id, d.deuda_bruto, p.pagado_bruto
    from deuda d
    join pagos p using (licitacion_id)
    where d.deuda_bruto > 0
      and p.pagado_bruto > round(d.deuda_bruto * 1.0119)
  ) loop
    -- 1. Respaldo (solo la primera vez que se toca cada documento).
    insert into licitacion_documentos_backup_20260807 (id, licitacion_id, tipo, monto)
    select id, licitacion_id, tipo, monto
    from licitacion_documentos
    where licitacion_id = r.licitacion_id
      and tipo in ('comprobante_pago', 'webpay', 'efectivo')
      and coalesce(monto, 0) > 0
    on conflict (id) do nothing;

    -- 2. Reescalado proporcional: la suma bruta pasa a ser ≈ deuda_bruto.
    update licitacion_documentos
    set monto = greatest(0, round(monto * r.deuda_bruto / r.pagado_bruto))
    where licitacion_id = r.licitacion_id
      and tipo in ('comprobante_pago', 'webpay', 'efectivo')
      and coalesce(monto, 0) > 0;

    -- 3. Residuo de redondeo → se absorbe en el documento de mayor monto.
    select sum(round(monto * 1.19)) into v_pagado_bruto
    from licitacion_documentos
    where licitacion_id = r.licitacion_id
      and tipo in ('comprobante_pago', 'webpay', 'efectivo')
      and coalesce(monto, 0) > 0;

    v_residuo := coalesce(v_pagado_bruto, 0) - r.deuda_bruto;
    if abs(v_residuo) > 1 then
      select id into v_doc_id
      from licitacion_documentos
      where licitacion_id = r.licitacion_id
        and tipo in ('comprobante_pago', 'webpay', 'efectivo')
        and coalesce(monto, 0) > 0
      order by monto desc, id asc
      limit 1;

      update licitacion_documentos
      set monto = greatest(0, monto - round(v_residuo / 1.19))
      where id = v_doc_id;
    end if;

    raise notice 'Cotización %: pagado bruto % → % (total a pagar)',
      r.licitacion_id, r.pagado_bruto, r.deuda_bruto;
  end loop;
end $$;

-- Verificación posterior: el PREVIEW de arriba debe devolver 0 filas.
--
-- Rollback si hiciera falta:
-- update licitacion_documentos d
-- set monto = b.monto
-- from licitacion_documentos_backup_20260807 b
-- where d.id = b.id;
