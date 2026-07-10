-- Columnas adicionales del xlsx de postulaciones (organismo, descripción, tipo,
-- región, monto, cierre, publicación, URL ficha, líneas de negocio) guardadas en
-- un jsonb `datos`, para prellenar la cotización con la mayor cantidad de campos
-- posible al tomar la postulación.
alter table public.licitaciones_disponibles
  add column if not exists datos jsonb default '{}'::jsonb;
