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
  // Emite quien tiene rol admin, contabilidad o jefe de ventas especial, o
  // quien tiene este módulo o «facturacion» entre sus permisos efectivos.
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
  // (2026-10-14) Inventario (antes solo admin; los vendedores lo ven sin KPIs)
  // y ver TODAS las cotizaciones (un vendedor ve solo las suyas): asignables
  // por perfil. (2026-10-22) 'inventario_kpis' dejó de existir: las tarjetas
  // KPI del Inventario son SOLO admin (pedido de Ariel); si un perfil viejo
  // aún trae la clave, se ignora.
  'inventario',
  // (2026-11-02) Traslados de stock entre sucursales propias (crear, recibir
  // y anular) sin ser admin. Asignable por perfil; el mantenedor de
  // sucursales y el resto de los movimientos siguen siendo solo admin.
  'inventario_traslados',
  // (2026-10-20) Ver el costo de los productos (solo lectura) sin ser admin: en
  // la cotización y en la ficha del producto. Asignable por perfil (Francisco).
  'ver_costos',
  // (2026-10-23) Crear productos con el formulario completo, SKU incluido, sin
  // ser admin (pedido de Ariel para Francisco). Asignable por perfil.
  'crear_productos',
  // (2026-10-27) Editar productos del catálogo con el formulario completo
  // (precios, costo, medidas, SKU), como un admin, salvo aprobar los
  // pendientes. Pedido de Ariel para Francisco. Asignable por perfil.
  'editar_productos',
  // (2026-10-16) Gestión de compras: adjudicadas vs. stock; asignable por perfil.
  'gestion_compras',
  // (2026-11-03) Proveedores y Órdenes de Compra a proveedores por perfil
  // (pedido de Ariel: «habilitar módulo de abastecimiento a Francisco»).
  // Antes eran solo admin por el menú y el backend no los restringía.
  'proveedores',
  'ordenes_compra',
  'cotizaciones_todas',
  'usuarios',
  'monitoreo_usuarios',
  'monitoreo_asistencia',
  // Reportería (2026-09-24): reportes a medida sin SQL sobre vistas de
  // negocio. Asignable por perfil; no va en ningún ROLE_DEFAULTS.
  'reporteria',
  // (2026-11-06) El Repositorio de documentos ya no tiene permiso por perfil:
  // lo ve y descarga cualquier usuario con sesión; subir, editar y eliminar es
  // solo de administradores (AdminGuard en repositorio.controller).
  // (2026-11-06) Recepción de stock (la de Bsale): cargar stock con guía,
  // factura, despacho interno o sin documento. Asignable por perfil.
  'recepcion_stock',
  // (2026-11-05) Apertura y cierre de caja de la sala de ventas. Además de
  // quien lo tenga en su perfil, lo recibe siempre el usuario de la tienda
  // (ver permisosDeUsuario): la caja asocia solo sus ventas.
  'caja',
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
  // tarjetas KPI (solo admin desde 2026-10-22) y sin mover stock.
  jefe_ventas: [...BASE, 'trazabilidad', 'metas', 'panel_indicadores', 'resumen_comercial', 'cotizaciones_vendedor', 'monitoreo_alertas', 'inventario'],
  jefe_ventas_especial: [...BASE, 'trazabilidad', 'seguimiento_pagos', 'cobranza', 'factoring', 'facturacion', 'venta_directa', 'metas', 'panel_indicadores', 'resumen_comercial', 'cotizaciones_vendedor', 'monitoreo_alertas', 'inventario'],
  // (2026-10-23) Venta directa para todos los vendedores (pedido de Ariel): el
  // módulo y la emisión (puedeEmitir usa estos permisos efectivos).
  ventas: [...BASE, 'metas', 'inventario', 'venta_directa'],
  ventas_especial: [...BASE, 'metas', 'sorteo', 'monitoreo_stock', 'inventario', 'venta_directa'],
  contabilidad: ['mi_correo', 'chat', 'seguimiento_pagos', 'cobranza', 'facturacion', 'venta_directa', 'metas'],
};

// (2026-10-16) Pedido de Ariel: "todos pueden ver el inventario" (las tarjetas
// KPI y la valorización son solo de los admin; el costo por fila, además, de
// quien tenga 'ver_costos' en su perfil).
export const PARA_TODOS = ['inventario'];

/* (2026-11-05) Usuario de la sala de ventas: el único cuyas ventas entran a la
   caja y el que siempre puede abrirla y cerrarla. Se puede cambiar con
   CAJA_USUARIO sin tocar el código. */
export function cajaUsuario(): string {
  return String(process.env.CAJA_USUARIO || 'ventas@amsodentmedical.cl').trim().toLowerCase();
}

/* Permisos efectivos de una persona concreta: los de su rol o perfil, más la
   caja si es el usuario de la tienda. */
export function permisosDeUsuario(rol: string | undefined, permisosPerfil: any, email?: string | null): string[] {
  const permisos = permisosEfectivos(rol, permisosPerfil);
  const correo = String(email || '').trim().toLowerCase();
  return correo && correo === cajaUsuario() && !permisos.includes('caja') ? [...permisos, 'caja'] : permisos;
}

// Permisos efectivos de un usuario: perfil asignado o, en su defecto, por rol.
export function permisosEfectivos(rol: string | undefined, permisosPerfil?: any): string[] {
  if (esRolAdmin(rol)) return [...MODULOS]; // admin ve todo
  const propios = Array.isArray(permisosPerfil)
    ? permisosPerfil.filter((m) => typeof m === 'string')
    : ROLE_DEFAULTS[normRol(rol)] || [...BASE];
  return [...new Set([...propios, ...PARA_TODOS])];
}
