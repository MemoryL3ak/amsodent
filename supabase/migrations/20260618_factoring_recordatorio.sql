-- Marca temporal del aviso "factoring por vencer" (1 semana antes del
-- vencimiento). Se setea cuando se notifica para no reenviar el aviso.
alter table if exists public.licitacion_documentos
  add column if not exists factoring_recordatorio_at timestamptz;
