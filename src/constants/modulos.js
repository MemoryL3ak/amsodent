// Catálogo de módulos permisionables (clave → etiqueta + grupo) para la UI de
// perfiles, y un fallback de permisos por rol por si el backend no entrega
// `permisos` (compatibilidad). El backend es la fuente principal.

export const MODULOS = [
  { key: "cotizaciones", label: "Cotizaciones", grupo: "Comercial" },
  { key: "crear_cotizacion", label: "Nueva Cotización", grupo: "Comercial" },
  { key: "clientes", label: "Clientes", grupo: "Comercial" },
  { key: "mis_clientes", label: "Mis clientes", grupo: "Comercial" },
  { key: "bitacora", label: "Bitácora actividades", grupo: "Comercial" },
  { key: "productos", label: "Productos", grupo: "Comercial" },
  { key: "campanas", label: "Campañas", grupo: "Comercial" },
  { key: "trazabilidad", label: "Trazabilidad", grupo: "Post-venta" },
  { key: "seguimiento_pagos", label: "Seguimiento de Pagos", grupo: "Post-venta" },
  { key: "cobranza", label: "Cobranza", grupo: "Post-venta" },
  { key: "factoring", label: "Factoring", grupo: "Post-venta" },
  { key: "mi_correo", label: "Mi Correo", grupo: "Comunicación" },
  { key: "chat", label: "Chat Grupal", grupo: "Comunicación" },
  { key: "metas", label: "Definición de metas", grupo: "Metas" },
  { key: "resumen_canales", label: "Resumen canales", grupo: "Metas" },
  { key: "panel_indicadores", label: "Panel de Indicadores", grupo: "Reportes" },
  { key: "resumen_comercial", label: "Resumen Comercial (incluido en Panel de Ejecutivos)", grupo: "Reportes" },
  { key: "cotizaciones_vendedor", label: "Panel de Ejecutivos", grupo: "Reportes" },
  // "Análisis Mercado Público" NO es asignable por perfil: es solo admin
  // (RequireRole en la ruta + AdminGuard en el backend).
  { key: "sorteo", label: "Sorteo", grupo: "Herramientas" },
  { key: "eventos", label: "Evento (inscripciones)", grupo: "Herramientas" },
  { key: "marcaje", label: "Marcar Asistencia", grupo: "Herramientas" },
  { key: "despachos_choferes", label: "Despachos y Choferes", grupo: "Logística" },
  { key: "tracking_choferes", label: "Tracking en Vivo", grupo: "Logística" },
  { key: "costeo_fletes", label: "Fletes", grupo: "Logística" },
  { key: "monitoreo_stock", label: "Monitoreo Stock Clientes", grupo: "Portal del Cliente" },
  { key: "portal_accesos", label: "Acceso Portal Clientes", grupo: "Portal del Cliente" },
  { key: "usuarios", label: "Usuarios", grupo: "Administración" },
  { key: "monitoreo_usuarios", label: "Monitoreo de Usuarios", grupo: "Administración" },
  { key: "monitoreo_asistencia", label: "Monitoreo de Asistencia", grupo: "Administración" },
];

export const MODULO_KEYS = MODULOS.map((m) => m.key);

const BASE = ["cotizaciones", "crear_cotizacion", "clientes", "mis_clientes", "bitacora", "productos", "campanas", "mi_correo", "chat"];

// Fallback por rol (debe reflejar backend/src/auth/permisos.ts).
const ROLE_DEFAULTS = {
  jefe_ventas: [...BASE, "trazabilidad", "metas", "resumen_canales", "panel_indicadores", "resumen_comercial", "cotizaciones_vendedor"],
  jefe_ventas_especial: [...BASE, "trazabilidad", "seguimiento_pagos", "cobranza", "factoring", "metas", "resumen_canales", "panel_indicadores", "resumen_comercial", "cotizaciones_vendedor"],
  ventas: [...BASE, "metas"],
  ventas_especial: [...BASE, "metas", "sorteo", "monitoreo_stock"],
  contabilidad: ["mi_correo", "chat", "seguimiento_pagos", "cobranza", "metas", "resumen_canales"],
};

export function esAdminRol(rol) {
  const r = String(rol || "").trim().toLowerCase();
  return r === "admin" || r === "administrador";
}

export function permisosFallback(rol) {
  if (esAdminRol(rol)) return [...MODULO_KEYS];
  const r = String(rol || "").trim().toLowerCase();
  return ROLE_DEFAULTS[r] || [...BASE];
}
