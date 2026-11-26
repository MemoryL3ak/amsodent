// productosSoloVer.js
// (2026-11-26) Permiso «productos_ver»: ver el catálogo de productos sin crear,
// editar, cargar ni eliminar (pedido de Ariel para el usuario de la sala de
// ventas). Vale como «solo ver» cuando el perfil NO trae además 'productos' ni
// los permisos de crear/editar. El admin nunca queda en solo lectura.
// Espejo de `soloVeProductos` en backend/src/auth/permisos.ts.
const TRABAJAN_EL_CATALOGO = ["productos", "crear_productos", "editar_productos"];

export function soloVeProductos(rol, permisos) {
  const r = String(rol || "").trim().toLowerCase();
  if (r === "admin" || r === "administrador") return false;
  const p = Array.isArray(permisos) ? permisos : [];
  return p.includes("productos_ver") && !TRABAJAN_EL_CATALOGO.some((k) => p.includes(k));
}
