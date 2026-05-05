-- Agrega campos para Guía de Despacho:
--   * empresa_despacho: courier o "Despacho interno"
--   * n_seguimiento:    tracking del courier (null si despacho interno)
--
-- La fecha y el monto de la guía reusan las columnas existentes
-- `fecha_oc` y `monto` (semánticamente: fecha y monto del documento).

alter table public.licitacion_documentos
  add column if not exists empresa_despacho text,
  add column if not exists n_seguimiento    text;
