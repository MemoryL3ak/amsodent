// Factor que se aplica a Lista 2 para obtener Lista 3.
// Lista 3 se usa exclusivamente para tipo de compra "Licitación 9 a 24 meses".
// Para cambiar el factor, modificar este valor: afecta a toda la app
// (listado de Productos, formularios Crear/Editar Producto, cotizaciones).
export const FACTOR_LISTA_3 = 1.08;

// Calcula el precio Lista 3 a partir de Lista 2. Retorna 0 si no hay base.
export function calcularLista3(lista2) {
  const base = Number(lista2 ?? 0);
  if (base <= 0) return 0;
  return Math.round(base * FACTOR_LISTA_3);
}
