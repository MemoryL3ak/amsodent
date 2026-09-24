/* ── Vistas de negocio de Reportería (2026-09-24) ─────────────────────────
   Conjuntos de datos "ya cruzados" y con nombres en español para que
   cualquier usuario con el módulo arme sus reportes sin SQL: el constructor
   los usa como origen igual que una tabla, pero cada vista es una consulta
   de solo lectura definida AQUÍ (no hay migración: se envuelve como
   subconsulta). Las columnas se declaran con etiqueta y tipo para la UI, y
   las marcadas `sensible` (costo y margen) solo salen para los roles con
   permiso de ver costos.

   Reglas de las consultas:
   - Solo SELECT, sin punto y coma, sin LIMIT (el constructor lo pone).
   - Toda columna expuesta va con alias en snake_case: el constructor filtra,
     agrupa y ordena por esos alias.
   - `round()` siempre sobre ::numeric (round(double, int) no existe). */

export type ColumnaVista = {
  nombre: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'sino';
  sensible?: boolean;
  descripcion?: string;
};

export type VistaNegocio = {
  id: string;
  nombre: string;
  descripcion: string;
  grano: string; // qué es una fila
  sql: string;
  columnas: ColumnaVista[];
};

/* Fragmentos compartidos entre vistas. */
const VENDEDOR = `coalesce(nullif(p.nombre, ''), nullif(l.vendedor_nombre, ''), l.creado_por)`;
const ES_LICITACION = `case when l.tipo_compra ilike '%licitaci%' then 'Sí' else 'No' end`;
const TIPO_DESPACHO = `case
    when coalesce(l.flete_por_pagar, false) then 'Por pagar (lo paga el cliente)'
    when coalesce(l.flete_estimado, 0) > 0 then 'Incluido en la cotización'
    else 'Sin flete / retiro'
  end`;
const OC_AGG = `(
    select licitacion_id,
           count(*) as n_oc,
           string_agg(numero::text, ', ' order by id) as numeros,
           min(fecha_oc) as fecha_oc,
           sum(coalesce(monto, 0)) as monto
    from licitacion_documentos
    where tipo = 'orden_compra'
    group by licitacion_id
  )`;
const GUIAS_AGG = `(
    select licitacion_id,
           count(*) as n_guias,
           string_agg(numero::text, ', ' order by id) as numeros,
           sum(coalesce(monto, 0)) as monto
    from licitacion_documentos
    where tipo = 'guia_despacho'
    group by licitacion_id
  )`;
const FACTURAS_AGG = `(
    select licitacion_id,
           count(*) as n_facturas,
           string_agg(numero::text, ', ' order by id) as numeros,
           sum(coalesce(monto, 0)) as monto,
           sum(case when coalesce(pagada, false) then 0 else 1 end) as pendientes,
           sum(case when coalesce(pagada, false) then 0 else coalesce(monto, 0) end) as monto_pendiente
    from licitacion_documentos
    where tipo in ('factura', 'factura_boleta')
    group by licitacion_id
  )`;

const COLS_COTIZACION: ColumnaVista[] = [
  { nombre: 'n_cotizacion', etiqueta: 'N° cotización', tipo: 'texto' },
  { nombre: 'nombre_cotizacion', etiqueta: 'Nombre de la cotización', tipo: 'texto' },
  { nombre: 'fecha_creacion', etiqueta: 'Fecha de creación', tipo: 'fecha' },
  { nombre: 'cliente', etiqueta: 'Cliente', tipo: 'texto' },
  { nombre: 'rut_cliente', etiqueta: 'RUT cliente', tipo: 'texto' },
  { nombre: 'tipo_cliente', etiqueta: 'Tipo de cliente', tipo: 'texto' },
  { nombre: 'tipo_compra', etiqueta: 'Tipo de compra', tipo: 'texto' },
  { nombre: 'es_licitacion', etiqueta: 'Es licitación', tipo: 'sino', descripcion: 'Sí cuando el tipo de compra es una licitación' },
  { nombre: 'codigo_licitacion', etiqueta: 'Código de licitación', tipo: 'texto', descripcion: 'Solo para licitaciones: el ID de Mercado Público' },
  { nombre: 'region', etiqueta: 'Región', tipo: 'texto' },
  { nombre: 'comuna', etiqueta: 'Comuna', tipo: 'texto' },
  { nombre: 'vendedor', etiqueta: 'Vendedor', tipo: 'texto' },
  { nombre: 'vendedor_correo', etiqueta: 'Correo del vendedor', tipo: 'texto' },
  { nombre: 'estado_cotizacion', etiqueta: 'Estado de la cotización', tipo: 'texto' },
  { nombre: 'estado_entrega', etiqueta: 'Estado de la orden (entrega)', tipo: 'texto' },
  { nombre: 'estado_envio', etiqueta: 'Estado del envío', tipo: 'texto' },
  { nombre: 'fecha_adjudicada', etiqueta: 'Fecha de adjudicación', tipo: 'fecha' },
  { nombre: 'ciclo_cerrado', etiqueta: 'Ciclo cerrado', tipo: 'sino' },
  { nombre: 'tipo_despacho', etiqueta: 'Tipo de despacho', tipo: 'texto', descripcion: 'Por pagar, incluido en la cotización o sin flete' },
  { nombre: 'flete', etiqueta: 'Flete ($ neto)', tipo: 'numero' },
  { nombre: 'terminos', etiqueta: 'Términos (condición de venta)', tipo: 'texto' },
  { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'texto' },
  { nombre: 'total_cotizacion_neto', etiqueta: 'Total cotización (neto)', tipo: 'numero' },
  { nombre: 'total_cotizacion_bruto', etiqueta: 'Total cotización (bruto)', tipo: 'numero' },
];

const COLS_OC: ColumnaVista[] = [
  { nombre: 'tiene_orden_compra', etiqueta: 'Tiene orden de compra', tipo: 'sino' },
  { nombre: 'n_orden_compra', etiqueta: 'N° orden de compra', tipo: 'texto', descripcion: 'Si hay varias, van separadas por coma' },
  { nombre: 'fecha_orden_compra', etiqueta: 'Fecha orden de compra', tipo: 'fecha' },
  { nombre: 'orden_compra_neto', etiqueta: 'Orden de compra (neto)', tipo: 'numero' },
];

export const VISTAS: VistaNegocio[] = [
  {
    id: 'vista_cotizaciones_lineas',
    nombre: 'Cotizaciones · detalle por producto',
    descripcion:
      'Una fila por producto cotizado, con los datos de la cotización, su orden de compra (si tiene), vendedor, despacho, flete, estado y términos. Filtra «Tiene orden de compra = Sí» para ver solo las cotizaciones con OC.',
    grano: 'producto de una cotización',
    sql: `
      select
        l.id as cotizacion_id,
        l.id_licitacion as n_cotizacion,
        l.nombre as nombre_cotizacion,
        coalesce(l.fecha::date, l.created_at::date) as fecha_creacion,
        l.nombre_entidad as cliente,
        l.rut_entidad as rut_cliente,
        l.tipo_cliente,
        l.tipo_compra,
        ${ES_LICITACION} as es_licitacion,
        case when l.tipo_compra ilike '%licitaci%' then l.id_licitacion end as codigo_licitacion,
        l.region,
        l.comuna,
        ${VENDEDOR} as vendedor,
        l.creado_por as vendedor_correo,
        i.orden as linea,
        i.sku,
        i.producto,
        i.formato,
        i.categoria,
        i.cantidad,
        i.valor_unitario as precio_unitario_neto,
        round((coalesce(i.cantidad, 0) * coalesce(i.valor_unitario, 0))::numeric) as precio_total_neto,
        round((coalesce(i.cantidad, 0) * coalesce(i.valor_unitario, 0) * 1.19)::numeric) as precio_total_bruto,
        i.costo as costo_unitario,
        round((coalesce(i.cantidad, 0) * coalesce(i.costo, 0))::numeric) as costo_total,
        round((coalesce(i.cantidad, 0) * (coalesce(i.valor_unitario, 0) - coalesce(i.costo, 0)))::numeric) as margen_neto,
        case when coalesce(i.valor_unitario, 0) > 0
             then round((((coalesce(i.valor_unitario, 0) - coalesce(i.costo, 0)) / i.valor_unitario) * 100)::numeric, 1)
        end as margen_pct,
        case when oc.licitacion_id is null then 'No' else 'Sí' end as tiene_orden_compra,
        oc.numeros as n_orden_compra,
        oc.fecha_oc as fecha_orden_compra,
        oc.monto as orden_compra_neto,
        ${TIPO_DESPACHO} as tipo_despacho,
        l.flete_estimado as flete,
        l.estado as estado_cotizacion,
        coalesce(l.estado_entrega, 'Preparación') as estado_entrega,
        l.estado_envio,
        l.fecha_adjudicada,
        case when coalesce(l.ciclo_cerrado, false) then 'Sí' else 'No' end as ciclo_cerrado,
        l.condicion_venta as terminos,
        l.observaciones,
        l.total_sin_iva as total_cotizacion_neto,
        l.total_con_iva as total_cotizacion_bruto
      from licitaciones l
      join items_licitacion i on i.licitacion_id = l.id
      left join ${OC_AGG} oc on oc.licitacion_id = l.id
      left join profiles p on lower(p.email) = lower(l.creado_por)
    `,
    columnas: [
      { nombre: 'cotizacion_id', etiqueta: 'ID interno', tipo: 'numero' },
      ...COLS_COTIZACION.slice(0, 13),
      { nombre: 'linea', etiqueta: 'N° de línea', tipo: 'numero' },
      { nombre: 'sku', etiqueta: 'SKU', tipo: 'texto' },
      { nombre: 'producto', etiqueta: 'Producto', tipo: 'texto' },
      { nombre: 'formato', etiqueta: 'Formato', tipo: 'texto' },
      { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'texto' },
      { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero' },
      { nombre: 'precio_unitario_neto', etiqueta: 'Precio unitario (neto)', tipo: 'numero' },
      { nombre: 'precio_total_neto', etiqueta: 'Precio total (neto)', tipo: 'numero' },
      { nombre: 'precio_total_bruto', etiqueta: 'Precio total (bruto)', tipo: 'numero' },
      { nombre: 'costo_unitario', etiqueta: 'Costo unitario', tipo: 'numero', sensible: true },
      { nombre: 'costo_total', etiqueta: 'Costo total', tipo: 'numero', sensible: true },
      { nombre: 'margen_neto', etiqueta: 'Margen ($ neto)', tipo: 'numero', sensible: true },
      { nombre: 'margen_pct', etiqueta: 'Margen (%)', tipo: 'numero', sensible: true },
      ...COLS_OC,
      ...COLS_COTIZACION.slice(13),
    ],
  },
  {
    id: 'vista_cotizaciones_resumen',
    nombre: 'Cotizaciones · resumen por cotización',
    descripcion:
      'Una fila por cotización con sus totales, la cadena documental (órdenes de compra, guías, facturas), el saldo por consumir y las facturas con pago pendiente.',
    grano: 'cotización',
    sql: `
      select
        l.id as cotizacion_id,
        l.id_licitacion as n_cotizacion,
        l.nombre as nombre_cotizacion,
        coalesce(l.fecha::date, l.created_at::date) as fecha_creacion,
        l.nombre_entidad as cliente,
        l.rut_entidad as rut_cliente,
        l.tipo_cliente,
        l.tipo_compra,
        ${ES_LICITACION} as es_licitacion,
        case when l.tipo_compra ilike '%licitaci%' then l.id_licitacion end as codigo_licitacion,
        l.region,
        l.comuna,
        ${VENDEDOR} as vendedor,
        l.creado_por as vendedor_correo,
        (select count(*) from items_licitacion i where i.licitacion_id = l.id) as n_productos,
        case when oc.licitacion_id is null then 'No' else 'Sí' end as tiene_orden_compra,
        oc.numeros as n_orden_compra,
        oc.fecha_oc as fecha_orden_compra,
        oc.monto as orden_compra_neto,
        coalesce(g.n_guias, 0) as n_guias,
        g.numeros as n_guia_despacho,
        coalesce(g.monto, 0) as guias_neto,
        case when coalesce(l.ciclo_cerrado, false) then 0
             else round((coalesce(oc.monto, 0) - coalesce(g.monto, 0))::numeric) end as saldo_por_consumir,
        coalesce(f.n_facturas, 0) as n_facturas,
        f.numeros as n_factura,
        coalesce(f.monto, 0) as facturado_neto,
        coalesce(f.pendientes, 0) as facturas_pago_pendiente,
        coalesce(f.monto_pendiente, 0) as facturado_pendiente_neto,
        ${TIPO_DESPACHO} as tipo_despacho,
        l.flete_estimado as flete,
        l.estado as estado_cotizacion,
        coalesce(l.estado_entrega, 'Preparación') as estado_entrega,
        l.estado_envio,
        l.fecha_adjudicada,
        case when coalesce(l.ciclo_cerrado, false) then 'Sí' else 'No' end as ciclo_cerrado,
        l.condicion_venta as terminos,
        l.observaciones,
        l.total_sin_iva as total_cotizacion_neto,
        l.total_con_iva as total_cotizacion_bruto
      from licitaciones l
      left join ${OC_AGG} oc on oc.licitacion_id = l.id
      left join ${GUIAS_AGG} g on g.licitacion_id = l.id
      left join ${FACTURAS_AGG} f on f.licitacion_id = l.id
      left join profiles p on lower(p.email) = lower(l.creado_por)
    `,
    columnas: [
      { nombre: 'cotizacion_id', etiqueta: 'ID interno', tipo: 'numero' },
      ...COLS_COTIZACION.slice(0, 13),
      { nombre: 'n_productos', etiqueta: 'N° de productos', tipo: 'numero' },
      ...COLS_OC,
      { nombre: 'n_guias', etiqueta: 'N° de guías', tipo: 'numero' },
      { nombre: 'n_guia_despacho', etiqueta: 'Guías de despacho', tipo: 'texto' },
      { nombre: 'guias_neto', etiqueta: 'Guías (neto)', tipo: 'numero' },
      { nombre: 'saldo_por_consumir', etiqueta: 'Saldo por consumir (neto)', tipo: 'numero', descripcion: 'OC neto − guías neto; 0 si el ciclo está cerrado' },
      { nombre: 'n_facturas', etiqueta: 'N° de facturas', tipo: 'numero' },
      { nombre: 'n_factura', etiqueta: 'Facturas', tipo: 'texto' },
      { nombre: 'facturado_neto', etiqueta: 'Facturado (neto)', tipo: 'numero' },
      { nombre: 'facturas_pago_pendiente', etiqueta: 'Facturas con pago pendiente', tipo: 'numero' },
      { nombre: 'facturado_pendiente_neto', etiqueta: 'Facturado pendiente de pago (neto)', tipo: 'numero' },
      ...COLS_COTIZACION.slice(13),
    ],
  },
];

export const VISTAS_POR_ID: Record<string, VistaNegocio> = Object.fromEntries(VISTAS.map((v) => [v.id, v]));

/* Roles que pueden ver costo y margen en los reportes (misma línea que el
   resto de la plataforma: administración y jefaturas de ventas). */
const ROLES_VEN_COSTO = new Set(['admin', 'administrador', 'jefe_ventas', 'jefe_ventas_especial']);
export function puedeVerCostos(rol?: string): boolean {
  return ROLES_VEN_COSTO.has(String(rol || '').trim().toLowerCase());
}

/* Columnas de una vista visibles para un rol (sin las sensibles si no puede). */
export function columnasVisibles(vista: VistaNegocio, rol?: string): ColumnaVista[] {
  const conCostos = puedeVerCostos(rol);
  return vista.columnas.filter((c) => conCostos || !c.sensible);
}
