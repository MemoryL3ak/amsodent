// Catálogo de módulos permisionables y los permisos por rol por defecto.
// Si un usuario tiene un perfil de permisos asignado, se usan sus `permisos`;
// si no, se derivan del rol con ROLE_DEFAULTS (comportamiento retrocompatible).

export const MODULOS: string[] = [
  'cotizaciones',
  'crear_cotizacion',
  'clientes',
  'mis_clientes',
  'bitacora',
  'productos',
  'campanas',
  'trazabilidad',
  'seguimiento_pagos',
  'cobranza',
  'factoring',
  // Facturación (2026-10-02): emitir en Bsale la factura de una guía.
  'facturacion',
  // Monitoreo de alertas (2026-10-07): alertas por vendedor y su cumplimiento.
  'monitoreo_alertas',
  // Venta directa (2026-10-07): listado de ventas directas y sus documentos.
  // Emitir exige además rol admin, contabilidad o jefe de ventas especial.
  'venta_directa',
  'mi_correo',
  'chat',
  'metas',
  // 'resumen_canales' se fusionó dentro de 'metas' (2026-09); los perfiles
  // antiguos que aún lo tengan siguen accediendo a /metas (frontend).
  'panel_indicadores',
  'resumen_comercial',
  'cotizaciones_vendedor',
  'sorteo',
  'eventos',
  'comunidad',
  'marcaje',
  'despachos_choferes',
  'tracking_choferes',
  'costeo_fletes',
  'monitoreo_stock',
  'portal_accesos',
  // (2026-10-14) Inventario (antes solo admin; los vendedores lo ven sin KPIs),
  // sus tarjetas KPI (valorización, unidades…) y ver TODAS las cotizaciones
  // (un vendedor ve solo las suyas): asignables por perfil.
  'inventario',
  'inventario_kpis',
  // (2026-10-20) Ver el costo de los productos (solo lectura) sin ser admin: en
  // la cotización y en la ficha del producto. Asignable por perfil (Francisco).
  'ver_costos',
  // (2026-10-16) Gestión de compras: adjudicadas vs. stock; asignable por perfil.
  'gestion_compras',
  'cotizaciones_todas',
  'usuarios',
  'monitoreo_usuarios',
  'monitoreo_asistencia',
  // Reportería (2026-09-24): reportes a medida sin SQL sobre vistas de
  // negocio. Asignable por perfil; no va en ningún ROLE_DEFAULTS.
  'reporteria',
];

// Módulos visibles para todos los roles autenticados (base comercial + comunicación).
const BASE = [
  'cotizaciones',
  'crear_cotizacion',
  'clientes',
  'mis_clientes',
  'bitacora',
  'productos',
  // (2026-10-14) Campañas y Campañas de margen ya no son de todos: solo admin
  // y quien las tenga en su perfil de permisos (pedido de Ariel).
  'mi_correo',
  'chat',
];

function normRol(rol?: string): string {
  return String(rol || '').trim().toLowerCase();
}

export function esRolAdmin(rol?: string): boolean {
  const r = normRol(rol);
  return r === 'admin' || r === 'administrador';
}

// Acceso por rol según la matriz vigente (ver SidebarLayout/RequireRole).
export const ROLE_DEFAULTS: Record<string, string[]> = {
  // (2026-10-14) 'inventario' para ventas y jefaturas: ven el stock, sin las
  // tarjetas KPI ('inventario_kpis' se asigna por perfil) y sin mover stock.
  jefe_ventas: [...BASE, 'trazabilidad', 'metas', 'panel_indicadores', 'resumen_comercial', 'cotizaciones_vendedor', 'monitoreo_alertas', 'inventario'],
  jefe_ventas_especial: [...BASE, 'trazabilidad', 'seguimiento_pagos', 'cobranza', 'factoring', 'facturacion', 'venta_directa', 'metas', 'panel_indicadores', 'resumen_comercial', 'cotizaciones_vendedor', 'monitoreo_alertas', 'inventario'],
  ventas: [...BASE, 'metas', 'inventario'],
  ventas_especial: [...BASE, 'metas', 'sorteo', 'monitoreo_stock', 'inventario'],
  contabilidad: ['mi_correo', 'chat', 'seguimiento_pagos', 'cobranza', 'facturacion', 'venta_directa', 'metas'],
};

// (2026-10-16) Pedido de Ariel: "todos pueden ver el inventario" (las tarjetas
// KPI siguen por 'inventario_kpis': admins y quien lo tenga en su perfil).
export const PARA_TODOS = ['inventario'];

// Permisos efectivos de un usuario: perfil asignado o, en su defecto, por rol.
export function permisosEfectivos(rol: string | undefined, permisosPerfil?: any): string[] {
  if (esRolAdmin(rol)) return [...MODULOS]; // admin ve todo
  const propios = Array.isArray(permisosPerfil)
    ? permisosPerfil.filter((m) => typeof m === 'string')
    : ROLE_DEFAULTS[normRol(rol)] || [...BASE];
  return [...new Set([...propios, ...PARA_TODOS])];
}
