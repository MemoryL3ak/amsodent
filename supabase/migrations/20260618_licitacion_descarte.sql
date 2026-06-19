-- Motivo y comentario al descartar una cotización (estado "Descartada").
-- motivo_descarte: 'Presupuesto' | 'Quiebre stock'. comentario_descarte: obligatorio (UI).
alter table if exists public.licitaciones
  add column if not exists motivo_descarte     text,
  add column if not exists comentario_descarte text;
