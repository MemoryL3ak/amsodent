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
  'mi_correo',
  'chat',
  'metas',
  'resumen_canales',
  'panel_indicadores',
  'resumen_comercial',
  'cotizaciones_vendedor',
  'sorteo',
  'marcaje',
  'despachos_choferes',
  'tracking_choferes',
  'monitoreo_stock',
  'portal_accesos',
  'usuarios',
  'monitoreo_usuarios',
  'monitoreo_asistencia',
];

// Módulos visibles para todos los roles autenticados (base comercial + comunicación).
const BASE = [
  'cotizaciones',
  'crear_cotizacion',
  'clientes',
  'mis_clientes',
  'bitacora',
  'productos',
  'campanas',
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
  jefe_ventas: [...BASE, 'trazabilidad', 'metas', 'resumen_canales', 'panel_indicadores', 'resumen_comercial', 'cotizaciones_vendedor'],
  jefe_ventas_especial: [...BASE, 'trazabilidad', 'seguimiento_pagos', 'cobranza', 'factoring', 'metas', 'resumen_canales', 'panel_indicadores', 'resumen_comercial', 'cotizaciones_vendedor'],
  ventas: [...BASE, 'metas'],
  ventas_especial: [...BASE, 'metas', 'sorteo', 'monitoreo_stock'],
  contabilidad: ['mi_correo', 'chat', 'seguimiento_pagos', 'cobranza', 'metas', 'resumen_canales'],
};

// Permisos efectivos de un usuario: perfil asignado o, en su defecto, por rol.
export function permisosEfectivos(rol: string | undefined, permisosPerfil?: any): string[] {
  if (esRolAdmin(rol)) return [...MODULOS]; // admin ve todo
  if (Array.isArray(permisosPerfil)) {
    return permisosPerfil.filter((m) => typeof m === 'string');
  }
  return ROLE_DEFAULTS[normRol(rol)] || [...BASE];
}
