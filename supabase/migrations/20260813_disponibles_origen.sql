-- ============================================================================
-- Postulaciones — origen de cada fila: Listado o Explorador Mercado Público
-- ----------------------------------------------------------------------------
-- Tomar un proceso desde el Explorador ya no lo manda al Listado: queda
-- registrado con origen 'exploracion' y se gestiona en el propio Explorador
-- (misma maquinaria: cupo de 3, aviso al chat, cierre por vencimiento, cargar
-- a cotización). El Listado solo muestra las filas con origen 'listado'.
-- «Agregar al Listado» o subir el xlsx con ese código lo promueve a 'listado'.
-- ============================================================================

alter table public.licitaciones_disponibles
  add column if not exists origen text not null default 'listado';

comment on column public.licitaciones_disponibles.origen is
  'listado = subida por xlsx o agregada a mano (visible en el Listado); exploracion = tomada directo en el Explorador MP (visible solo ahí hasta que se promueva).';
