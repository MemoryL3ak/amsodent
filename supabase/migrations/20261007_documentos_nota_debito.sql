-- Notas de débito (pedido 2026-10-07): "permitir generar notas de crédito y
-- notas de débito a las facturas emitidas". La nota de débito se emite en
-- Bsale desde la plataforma (Trazabilidad → Facturas) y queda en la cotización
-- como documento tipo 'nota_debito' colgando de la factura (deriva_de_id), con
-- el monto BRUTO (misma convención que la nota de crédito y la multa).
-- Seguimiento de Pagos la SUMA al saldo de la factura (la nota de crédito y la
-- multa restan). Sin esta migración la nota se emite igual en Bsale, pero no
-- queda registrada en la cotización (el sistema lo avisa).
alter table public.licitacion_documentos
  drop constraint if exists licitacion_documentos_tipo_check;
alter table public.licitacion_documentos
  add constraint licitacion_documentos_tipo_check
  check (
    tipo in (
      'orden_compra',
      'guia_despacho',
      'factura',
      'factura_boleta',
      'comprobante_pago',
      'efectivo',
      'webpay',
      'info_despacho',
      'nota_credito',
      'nota_debito',
      'cierre_forzado',
      'multa',
      'portal_cliente'
    )
  );
