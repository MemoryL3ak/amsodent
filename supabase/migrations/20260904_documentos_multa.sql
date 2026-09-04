-- Multas en Seguimiento de Pagos (pedido 2026-09-04): cuando la entidad cursa
-- una multa a Amsodent, se descuenta del monto a cobrar de la factura, igual
-- que una nota de crédito. Se guarda como documento tipo 'multa' colgando de
-- la factura (deriva_de_id); el monto se ingresa BRUTO tal cual (misma
-- convención que la nota de crédito).
-- De paso se suma 'portal_cliente' al CHECK: el portal del cliente inserta ese
-- tipo (portal.service.ts, subida "otro") pero ninguna migración lo había
-- incluido — sin esto, esas subidas chocan con el constraint.
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
      'cierre_forzado',
      'multa',
      'portal_cliente'
    )
  );
