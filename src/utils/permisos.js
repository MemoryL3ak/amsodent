// /src/utils/permisos.js

export function puedeEditarProducto(rol) {
  return rol === "Administrador";
}

export function puedeIngresarSKU(rol) {
  return rol === "Administrador"; // Supervisor y Usuario NO
}

export function puedeCrearProducto(rol) {
  return rol === "Administrador" || rol === "Supervisor" || rol === "Usuario";
}

export function puedeVerLicitacion(rol, licitacion, userId) {
  if (rol === "Administrador") return true;
  if (rol === "Supervisor") return true; // ve todas
  return licitacion.creado_por === userId;
}

export function puedeEditarLicitacion(rol, licitacion, userId) {
  if (rol === "Administrador") return true;
  if (rol === "Supervisor" && licitacion.creado_por === userId) return true;
  if (rol === "Usuario" && licitacion.creado_por === userId) return true;

  return false;
}
