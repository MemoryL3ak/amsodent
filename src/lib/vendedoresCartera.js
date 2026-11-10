// vendedoresCartera.js
// Quiénes pueden figurar como «Vendedor asignado» de un cliente (2026-11-09).
//
// El vendedor asignado existe solo para el Cliente Particular (es su cartera),
// pero el listado —en Asignación de cartera, al crear y al editar un cliente—
// mostraba a todo el equipo, incluidos los vendedores que solo venden a
// Mercado Público. Desde hoy quedan:
//   • los ADMINISTRADORES, y
//   • los vendedores cuyo canal en Metas vende a particulares (terreno,
//     tienda, página web, freelance; los mixtos terreno/mercado también).
// Un vendedor solo de Mercado Público, sin canal asignado o bloqueado no
// aparece. El canal sale de /metas/canal del periodo vigente (el backend
// arrastra el último periodo guardado si el mes actual no tiene).
// Si Metas no responde, no se esconde a nadie de venta (se cae al rol), para
// que la lista nunca quede vacía por una falla de red.
import { api } from "./api";
import { canalLabel, esCanalParticular, normalizeCanal } from "./canales";

const ROLES_VENTA = ["ventas", "ventas_especial", "jefe_ventas", "jefe_ventas_especial"];

const correo = (v) => String(v || "").trim().toLowerCase();

export function esRolAdmin(rol) {
  const r = String(rol || "").trim().toLowerCase();
  return r === "admin" || r === "administrador";
}

// Metas guarda el periodo como 'YYYY-MM-01'.
export function periodoMetasActual(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** correo → canal, según Metas. Devuelve null si no se pudo consultar. */
export async function cargarCanalVendedores() {
  try {
    const filas = await api.get(`/metas/canal?periodo=${periodoMetasActual()}`);
    const m = {};
    for (const f of Array.isArray(filas) ? filas : []) {
      const e = correo(f?.vendedor_email);
      if (e) m[e] = normalizeCanal(f?.canal);
    }
    return m;
  } catch {
    return null;
  }
}

/** Canal del perfil (por correo principal o alterno). */
export function canalDe(perfil, canalPorCorreo) {
  if (!canalPorCorreo) return "";
  return canalPorCorreo[correo(perfil?.email)] || canalPorCorreo[correo(perfil?.email_alterno)] || "";
}

/** Perfiles que pueden tener cartera de clientes particulares. */
export function vendedoresCartera(perfiles, canalPorCorreo) {
  return (perfiles || []).filter((p) => {
    if (!p?.email || p?.bloqueado === true) return false;
    const rol = String(p.rol || "").trim().toLowerCase();
    if (esRolAdmin(rol)) return true;
    if (!ROLES_VENTA.includes(rol)) return false;
    if (!canalPorCorreo) return true;
    return esCanalParticular(canalDe(p, canalPorCorreo));
  });
}

/** Segunda línea del listado: «Administrador» o el canal del vendedor. */
export function detalleVendedor(perfil, canalPorCorreo) {
  if (esRolAdmin(perfil?.rol)) return "Administrador";
  return canalLabel(canalDe(perfil, canalPorCorreo));
}
