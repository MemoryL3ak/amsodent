-- Forzar cierre en Trazabilidad: ahora exige adjuntar un archivo de respaldo
-- (autorización / justificación). Se guarda como documento de la cotización
-- con tipo 'cierre_forzado'; el motivo opcional va en la columna numero.
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
      'cierre_forzado'
    )
  );
