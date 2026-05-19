-- Restringir los valores válidos de licitacion_documentos.tipo.
-- Idempotente: si ya existe un constraint con este nombre (aunque sea con una
-- lista incompleta de valores), lo eliminamos y volvemos a crearlo con los 5
-- tipos válidos.
--
-- Antes de aplicar conviene correr este SELECT para verificar que todos los
-- valores existentes están dentro de la lista permitida:
--
--   select tipo, count(*)
--   from public.licitacion_documentos
--   group by tipo
--   order by count(*) desc;
--
-- Si aparece algún valor distinto a los 5 de abajo, hay que limpiarlo primero
-- (UPDATE) o sumarlo al CHECK; si no, este ALTER TABLE fallará.

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
      'comprobante_pago'
    )
  );
