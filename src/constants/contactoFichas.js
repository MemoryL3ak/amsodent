/* ── Contacto al pie de las fichas técnicas (2026-11-05) ─────────────────────
   Pedido de Ariel: el pie de la ficha lleva el correo de Lisbeth
   (lisbeth.riquelme@amsodentmedical.cl), el N° de la tienda y el N° de
   Lisbeth. Un solo lugar para cambiarlos: lo lee FichaTecnica.jsx (el PDF de
   la ficha, suelto o dentro del ZIP).
   Un teléfono vacío simplemente no se imprime. */
export const CONTACTO_FICHA = {
  direccion: "Calle 1 de mayo N.º 45, San Bernardo",
  correo: "lisbeth.riquelme@amsodentmedical.cl",
  // El de la tienda es el mismo que ya sale en la cotización y en la boleta térmica.
  telefonoTienda: "+56 9 4094 3030",
  // PENDIENTE: falta que Ariel confirme el número de Lisbeth.
  telefonoLisbeth: "",
};
