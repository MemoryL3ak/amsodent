-- (2026-10-07) Facturas y boletas ya cubiertas por sus pagos → pagadas.
-- Había facturas/boletas con su comprobante de pago por el total que nunca se
-- marcaron pagadas (115 de clientes particulares y 5 de entidades públicas al
-- 2026-10-06): Seguimiento de Pagos las mostraba pendientes, Trazabilidad
-- decía "Pago pendiente" y la cobranza podía seguir avisando.
-- Desde ahora el servidor marca la factura al registrar el pago que la
-- completa; esto corrige las que ya estaban así. Misma regla:
--   · pagos = comprobante_pago + webpay + efectivo, en NETO;
--   · cuentan los vinculados a la factura y, si la cotización tiene UNA sola
--     factura, también los sin factura asignada;
--   · se descuentan las notas de crédito (están en BRUTO → /1,19);
--   · tolerancia de $5.
with fac as (
  select f.id, f.licitacion_id, f.monto,
         (select count(*) from public.licitacion_documentos x
           where x.licitacion_id = f.licitacion_id and x.tipo in ('factura', 'factura_boleta')) as n_fact
    from public.licitacion_documentos f
   where f.tipo in ('factura', 'factura_boleta')
     and coalesce(f.pagada, false) = false
     and coalesce(f.monto, 0) > 0
),
pag as (
  select fac.id as factura_id,
         sum(p.monto) as pagado,
         max(p.fecha_oc) as ultima,
         (array_agg(p.forma_pago order by p.fecha_oc desc nulls last) filter (where p.forma_pago is not null))[1] as forma
    from fac
    join public.licitacion_documentos p
      on p.licitacion_id = fac.licitacion_id
     and p.tipo in ('comprobante_pago', 'webpay', 'efectivo')
     and (
           p.deriva_de_id = fac.id
           or (fac.n_fact = 1 and (
                 p.deriva_de_id is null
                 or p.deriva_de_id not in (
                      select y.id from public.licitacion_documentos y
                       where y.licitacion_id = fac.licitacion_id and y.tipo in ('factura', 'factura_boleta'))))
         )
   group by fac.id
),
nc as (
  select deriva_de_id as factura_id, sum(monto) / 1.19 as nc
    from public.licitacion_documentos
   where tipo = 'nota_credito' and deriva_de_id is not null
   group by deriva_de_id
)
update public.licitacion_documentos d
   set pagada = true,
       fecha_pago = coalesce(d.fecha_pago, pag.ultima::date),
       forma_pago = coalesce(d.forma_pago, pag.forma)
  from fac
  join pag on pag.factura_id = fac.id
  left join nc on nc.factura_id = fac.id
 where d.id = fac.id
   and pag.pagado >= fac.monto - coalesce(nc.nc, 0) - 5;
