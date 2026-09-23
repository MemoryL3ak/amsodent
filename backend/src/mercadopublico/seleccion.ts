/* ============================================================================
   Quién quedó seleccionado en una Compra Ágil
   ----------------------------------------------------------------------------
   La API v2 marca al ganador con un campo PLANO dentro de cada cotizante:

     proveedores_cotizando[] → { ..., proveedor_seleccionado: 1, id_oc: 55536059 }

   y no con un objeto anidado `seleccion`. El código lo leía como
   `c.seleccion.proveedor_seleccionado === true`, que nunca existe, así que
   NINGUNA Compra Ágil llegaba a tener desenlace: ni el cambio automático de
   estado ni el panel de Análisis podían decir que habíamos ganado. Además el
   valor es el número 1, no el booleano true, de modo que un `=== true` tampoco
   habría servido.

   Vive aparte para que la lectura sea una sola en todo el backend.
============================================================================ */

export function fueSeleccionado(cotizante: any): boolean {
  const v = cotizante?.proveedor_seleccionado ?? cotizante?.seleccion?.proveedor_seleccionado;
  return v === 1 || v === true || String(v).trim() === '1';
}
