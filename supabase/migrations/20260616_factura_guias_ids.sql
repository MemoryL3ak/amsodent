-- Una factura puede asociarse a MÁS DE UNA guía de despacho.
-- deriva_de_id sigue apuntando a la guía principal (compatibilidad); guias_ids
-- guarda todas las guías asociadas (array de IDs de licitacion_documentos).
alter table if exists public.licitacion_documentos
  add column if not exists guias_ids jsonb;
