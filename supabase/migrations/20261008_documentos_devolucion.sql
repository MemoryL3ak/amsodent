-- Dinero de las notas de crédito (pedido 2026-10-08): "pensar en el flujo de
-- anulación de una factura: se le devuelve dinero al cliente, la factura debe
-- quedar impaga y hay que dar trazabilidad a la devolución; si se devuelve el
-- dinero o queda como saldo a favor se decide al emitir la NC, y todo se ve en
-- Trazabilidad → Facturas".
--
-- 1. La nota de crédito guarda la decisión en `dinero`:
--      devolver        → queda una devolución pendiente hasta registrarla
--      saldo_favor     → el monto queda a favor del cliente para otra factura
--      rebajar_deuda   → no había pago: el documento deja de cobrarse
--      sin_movimiento  → solo se anula el documento
-- 2. La devolución es un documento tipo 'devolucion' colgado de la factura
--    (deriva_de_id) que apunta a la nota de crédito (origen_doc_id). Guarda el
--    monto NETO, como los comprobantes de pago: es un pago con signo contrario.
--    forma_pago = medio (Transferencia, Efectivo…), banco_pago, numero = N° del
--    comprobante y el archivo del comprobante si se adjuntó.
-- 3. El saldo a favor aplicado a otra factura es un 'comprobante_pago' con
--    forma_pago «Saldo a favor» y origen_doc_id = la nota de crédito (no
--    necesita columnas nuevas).
-- Sin esta migración el código sigue andando: la NC se emite igual (sin
-- guardar la decisión) y registrar una devolución avisa que falta aplicarla.
alter table public.licitacion_documentos
  add column if not exists dinero text;
comment on column public.licitacion_documentos.dinero is
  'Nota de crédito: qué pasa con el dinero (devolver | saldo_favor | rebajar_deuda | sin_movimiento)';

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
      'portal_cliente',
      'devolucion'
    )
  );
