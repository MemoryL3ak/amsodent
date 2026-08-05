-- Corrección de datos: alinear tipo_compra con tipo_cliente en cotizaciones
-- Cliente Particular.
--
-- El botón "Guardar Tipo de Cotización" (disponible cuando la cotización está
-- bloqueada: Adjudicada/Perdida/Cancelada) persistía solo tipo_cliente, así
-- que las cotizaciones convertidas a Cliente Particular quedaron con su
-- tipo_compra de licitación ("Compra ágil", etc.). La sección Documentos de
-- la ficha se gatea por tipo_compra, por lo que esas cotizaciones solo
-- ofrecían OC/Guía y no dejaban cargar Factura o Boleta (ej.: cotización #13).
--
-- El frontend ya se corrigió para (a) considerar particular también por
-- tipo_cliente y (b) alinear tipo_compra al guardar el tipo de cotización;
-- esta migración repara las filas ya desalineadas.

update licitaciones
set tipo_compra = 'Cliente particular'
where lower(trim(coalesce(tipo_cliente, ''))) = 'cliente particular'
  and (tipo_compra is null or tipo_compra <> 'Cliente particular');
