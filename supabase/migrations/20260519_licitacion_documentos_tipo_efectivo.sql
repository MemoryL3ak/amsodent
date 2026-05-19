-- Agregar 'efectivo' como tipo válido de documento en licitacion_documentos.
-- Idempotente: drop + add. Si por alguna razón el constraint actual ya tiene
-- la lista correcta de 6 valores, esta migración la reescribe igual.

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
      'efectivo'
    )
  );
