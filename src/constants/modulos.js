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
  // (2026-10-14) Campañas y Campañas de margen: solo admin y quien lo tenga en su perfil.
  { key: "campanas", label: "Campañas y Campañas de margen", grupo: "Comercial" },
  // (2026-10-14) Un vendedor ve solo sus cotizaciones; con esto ve todas.
  { key: "cotizaciones_todas", label: "Ver todas las cotizaciones (no solo las propias)", grupo: "Comercial" },
  // Venta directa (2026-10-07): listado y documentos de las ventas directas.
  // Emitir exige además rol admin, contabilidad o jefe de ventas especial.
  { key: "venta_directa", label: "Venta directa", grupo: "Comercial" },
  { key: "trazabilidad", label: "Trazabilidad", grupo: "Post-venta" },
  { key: "seguimiento_pagos", label: "Seguimiento de Pagos", grupo: "Post-venta" },
  { key: "cobranza", label: "Cobranza", grupo: "Post-venta" },
  { key: "factoring", label: "Factoring", grupo: "Post-venta" },
  // Facturación (2026-10-02): emitir en Bsale la factura de una guía. Además
  // del módulo, el backend exige rol administración, contabilidad o jefe de
  // ventas especial.
  { key: "facturacion", label: "Facturación (emitir en Bsale)", grupo: "Post-venta" },
  { key: "mi_correo", label: "Mi Correo", grupo: "Comunicación" },
  { key: "chat", label: "Chat Grupal", grupo: "Comunicación" },
  // "Resumen canales" se fusionó dentro de Definición de metas (2026-09):
  // la clave resumen_canales ya no es asignable; los perfiles antiguos que
  // la tengan siguen accediendo a /metas (ver SidebarLayout).
  { key: "metas", label: "Definición de metas", grupo: "Metas" },
  { key: "panel_indicadores", label: "Panel de Indicadores", grupo: "Reportes" },
  { key: "resumen_comercial", label: "Resumen Comercial (incluido en Panel de Ejecutivos)", grupo: "Reportes" },
  { key: "cotizaciones_vendedor", label: "Panel de Ejecutivos", grupo: "Reportes" },
  // Reportería (2026-09-24): reportes a medida sin SQL sobre vistas de
  // negocio. Costo y margen solo los ven admin y jefaturas de ventas; las
  // tablas crudas y el SQL libre siguen siendo solo admin.
  { key: "reporteria", label: "Reportería (reportes a medida)", grupo: "Reportes" },
  // "Análisis Mercado Público" NO es asignable por perfil: es solo admin
  // (RequireRole en la ruta + AdminGuard en el backend).
  { key: "sorteo", label: "Sorteo", grupo: "Herramientas" },
  { key: "eventos", label: "Evento (inscripciones)", grupo: "Herramientas" },
  { key: "comunidad", label: "Comunidad Amsodent", grupo: "Herramientas" },
  { key: "marcaje", label: "Marcar Asistencia", grupo: "Herramientas" },
  { key: "despachos_choferes", label: "Despachos y Choferes", grupo: "Logística" },
  { key: "tracking_choferes", label: "Tracking en Vivo", grupo: "Logística" },
  { key: "costeo_fletes", label: "Fletes", grupo: "Logística" },
  // (2026-10-14) Inventario (ver el stock; mover stock sigue siendo solo admin)
  // y sus tarjetas KPI (ocultas a los vendedores).
  { key: "inventario", label: "Inventario (ver stock) — ya lo ven todos", grupo: "Abastecimiento" },
  { key: "inventario_kpis", label: "Inventario: KPIs (valorización, unidades…)", grupo: "Abastecimiento" },
  { key: "monitoreo_stock", label: "Monitoreo Stock Clientes", grupo: "Portal del Cliente" },
  { key: "portal_accesos", label: "Acceso Portal Clientes", grupo: "Portal del Cliente" },
  // "Recursos Humanos" NO es asignable por perfil: es solo admin (sueldos,
  // fichas y evaluaciones son datos sensibles). El portal del trabajador
  // ("Mi Ficha", /mi-ficha) sí está disponible para todo el equipo.
  { key: "usuarios", label: "Usuarios", grupo: "Administración" },
  { key: "monitoreo_usuarios", label: "Monitoreo de Usuarios", grupo: "Administración" },
  { key: "monitoreo_asistencia", label: "Monitoreo de Asistencia", grupo: "Administración" },
  // Monitoreo de alertas (2026-10-07): alertas de cada vendedor y su cumplimiento.
  { key: "monitoreo_alertas", label: "Monitoreo de Alertas", grupo: "Administración" },
];

export const MODULO_KEYS = MODULOS.map((m) => m.key);

// (2026-10-14) "campanas" salió de la base: solo admin y por perfil.
const BASE = ["cotizaciones", "crear_cotizacion", "clientes", "mis_clientes", "bitacora", "productos", "mi_correo", "chat"];

// Fallback por rol (debe reflejar backend/src/auth/permisos.ts).
const ROLE_DEFAULTS = {
  jefe_ventas: [...BASE, "trazabilidad", "metas", "panel_indicadores", "resumen_comercial", "cotizaciones_vendedor", "monitoreo_alertas", "inventario"],
  jefe_ventas_especial: [...BASE, "trazabilidad", "seguimiento_pagos", "cobranza", "factoring", "facturacion", "venta_directa", "metas", "panel_indicadores", "resumen_comercial", "cotizaciones_vendedor", "monitoreo_alertas", "inventario"],
  ventas: [...BASE, "metas", "inventario"],
  ventas_especial: [...BASE, "metas", "sorteo", "monitoreo_stock", "inventario"],
  contabilidad: ["mi_correo", "chat", "seguimiento_pagos", "cobranza", "facturacion", "venta_directa", "metas"],
};

export function esAdminRol(rol) {
  const r = String(rol || "").trim().toLowerCase();
  return r === "admin" || r === "administrador";
}

export function permisosFallback(rol) {
  if (esAdminRol(rol)) return [...MODULO_KEYS];
  const r = String(rol || "").trim().toLowerCase();
  // (2026-10-16) El inventario lo ven todos (igual que permisosEfectivos en el backend).
  return [...new Set([...(ROLE_DEFAULTS[r] || BASE), "inventario"])];
}
