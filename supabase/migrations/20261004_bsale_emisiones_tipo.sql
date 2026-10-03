-- Emisiones en Bsale: también guías de despacho y órdenes (notas de venta).
-- (2026-10-02) Hasta ahora solo se emitían facturas. La fila dice ahora de qué
-- tipo es cada emisión, de qué documento del sistema nació y con qué líneas
-- salió (para las guías: qué se despachó de cada SKU).
--   tipo: factura | guia | nota_venta
alter table if exists public.bsale_emisiones
  add column if not exists tipo          text not null default 'factura',
  add column if not exists origen_doc_id bigint,     -- licitacion_documentos.id de la orden de compra (guías y notas)
  add column if not exists lineas        jsonb;      -- [{sku, cantidad, neto_unitario}]

create index if not exists bsale_emisiones_origen_idx on public.bsale_emisiones (origen_doc_id);
