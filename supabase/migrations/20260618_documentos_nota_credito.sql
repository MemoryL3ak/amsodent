-- Notas de crédito en Seguimiento de Pagos: nuevo tipo de documento que
-- descuenta del monto a cobrar de una factura/boleta (deriva_de_id apunta a la
-- factura). Llevan monto y, opcionalmente, archivo PDF.
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
      'nota_credito'
    )
  );
