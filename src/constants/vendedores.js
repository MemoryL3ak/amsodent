// Vendedores que se tratan como equipo comercial aunque su rol no sea de
// venta (2026-09-17): Diego Cruz es admin pero vende. Esta lista lo hace
// visible SIEMPRE en Definición de Metas y en el Avance de Metas del Panel
// de Indicadores. Casos futuros iguales: agregar el correo aquí.
export const VENDEDORES_SIEMPRE_VISIBLES = ["diego.cruz@bvan.cl"];

export function esVendedorSiempreVisible(email) {
  return VENDEDORES_SIEMPRE_VISIBLES.includes(String(email || "").trim().toLowerCase());
}
