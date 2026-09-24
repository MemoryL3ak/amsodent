import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin } from '../auth/permisos';
import { VISTAS, VISTAS_POR_ID, columnasVisibles, puedeVerCostos } from './vistas';

/* ── Reportería (2026-09-17) ──────────────────────────────────────────────
   Motor del módulo /reporteria: catálogo de tablas, constructor visual
   (config estructurada → SQL), SQL libre de solo lectura y reportes
   guardados. Todo pasa por la función `reporteria_sql` de la migración
   20260917 (SELECT-only, timeout 15 s, tope 5.000 filas), que solo puede
   invocar el service role: el navegador jamás habla directo con la base. */

const LIMITE_FILAS = 10000;

/* Tablas recomendadas del negocio, con descripción para el catálogo. El
   resto de tablas públicas también aparece (vía information_schema), pero
   estas van primero y con contexto. */
const TABLAS_RECOMENDADAS: Record<string, string> = {
  licitaciones: 'Cotizaciones: cliente, comuna, estado, tipo de compra, montos y fechas. La tabla madre del negocio.',
  licitacion_documentos: 'Cadena documental por cotización: orden_compra, guia_despacho, factura/factura_boleta, nota_credito, cierre_forzado. Montos NETOS (bruto = neto × 1,19).',
  items_licitacion: 'Ítems de cada cotización: producto, cantidad, precio unitario, costo.',
  clientes: 'Maestro de clientes: RUT, razón social, región/comuna, contacto, crédito del particular.',
  productos: 'Catálogo de productos: SKU, marca, listas de precios, peso, stock.',
  proveedores: 'Proveedores: contacto, rubro, marcas y condición de compra (crédito/contado/tarjeta).',
  inventario_movimientos: 'Libro de inventario: entradas y salidas por producto con motivo y fecha.',
  stock_solicitudes_cotizacion: 'Pedidos del portal del cliente: ítems, etapa del flujo (aprobación/validación/pago), SOS y datos de pago.',
  stock_productos_cliente: 'Stock declarado por cada cliente en su portal: producto, cantidades, mínimos y semáforo.',
  stock_clientes_portal: 'Accesos al portal por RUT: habilitación, vigencia y último acceso.',
  vendedor_metas_mensuales: 'Metas mensuales por vendedor (correo, periodo, meta neta).',
  vendedor_metas_canal_mensuales: 'Canal asignado a cada vendedor por periodo.',
  licitaciones_disponibles: 'Procesos de Mercado Público capturados: código, entidad, fechas, origen (listado/explorador).',
  cobranza_actividades: 'Bitácora del calendario de cobranza: hitos por factura vencida.',
  actividades_bitacora: 'Bitácora comercial: actividades, visitas y llamadas del equipo.',
  fletes_costeos: 'Costeo de fletes: cobro real de couriers vs flete estimado, por guía.',
};

type FiltroConsulta = { campo: string; operador: string; valor?: string };
type AgregacionConsulta = { funcion: string; campo: string };
export type ConfigConstructor = {
  tabla: string;
  columnas?: string[];
  filtros?: FiltroConsulta[];
  agrupar?: string[];
  agregaciones?: AgregacionConsulta[];
  ordenarPor?: string;
  ordenDesc?: boolean;
  limite?: number;
};

const OPERADORES: Record<string, string> = {
  igual: '=',
  distinto: '<>',
  mayor: '>',
  mayor_igual: '>=',
  menor: '<',
  menor_igual: '<=',
  contiene: 'ilike',
  no_contiene: 'not ilike',
  vacio: 'is null',
  no_vacio: 'is not null',
};

const AGREGACIONES: Record<string, string> = {
  conteo: 'count',
  suma: 'sum',
  promedio: 'avg',
  minimo: 'min',
  maximo: 'max',
};

// Identificadores seguros: solo lo que existe en el catálogo, siempre
// entre comillas dobles. Nada del usuario se concatena sin pasar por aquí.
const RE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function ident(nombre: string): string {
  const n = String(nombre || '').trim();
  if (!RE_IDENT.test(n)) throw new BadRequestException(`Identificador no válido: "${n}".`);
  return `"${n}"`;
}
function literal(valor: string): string {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

@Injectable()
export class ReporteriaService {
  private readonly logger = new Logger(ReporteriaService.name);
  private catalogoCache: { data: any; en: number } | null = null;

  constructor(private supabase: SupabaseService) {}

  /* Candados del lado del backend (defensa en profundidad: la función SQL
     tiene los suyos, pero validar aquí da mensajes claros y cubre también a
     `damaria_sql`, el motor de respaldo). */
  private validarLectura(consulta: string): string {
    const sql = String(consulta || '').trim().replace(/;\s*$/, '');
    if (!sql) throw new BadRequestException('Escribe una consulta.');
    if (!/^\s*(select|with)\b/i.test(sql)) {
      throw new BadRequestException('Solo se permiten consultas SELECT (o WITH ... SELECT).');
    }
    if (sql.includes(';')) {
      throw new BadRequestException('Una sola consulta, sin punto y coma.');
    }
    if (/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|vacuum|reindex|comment|lock|listen|notify|prepare|deallocate|import|merge|set_config|pg_terminate_backend|pg_cancel_backend|pg_read_file|pg_ls_dir|lo_import|lo_export|dblink)\b/i.test(sql)) {
      throw new BadRequestException('La consulta contiene palabras no permitidas: este motor es de solo lectura.');
    }
    return sql;
  }

  private async rpcSql(consulta: string): Promise<any[]> {
    const sql = this.validarLectura(consulta);
    // El tope de filas viaja DENTRO de la consulta: vale con cualquiera de
    // los dos motores. (Un LIMIT del usuario queda dentro de la subconsulta.)
    const envuelta = `select * from (${sql}) reporte_sub limit ${LIMITE_FILAS + 1}`;
    const client = this.supabase.getClient();
    let { data, error } = await client.rpc('reporteria_sql', { consulta: envuelta });
    if (error && /could not find the function|schema cache/i.test(String(error.message || ''))) {
      // Motor de respaldo: la función de DamarIA (ya desplegada) es
      // estructuralmente de solo lectura. La nueva solo agrega timeout mayor
      // y lista negra; mientras no se migre, esto mantiene el módulo vivo.
      ({ data, error } = await client.rpc('damaria_sql', { consulta: envuelta }));
    }
    if (error) throw new BadRequestException(String(error.message || ''));
    return Array.isArray(data) ? data : [];
  }

  /* ── Catálogo: vistas de negocio (según rol) + tablas crudas (admin) ── */
  async catalogo(rol?: string) {
    const admin = esRolAdmin(rol);
    const vistas = VISTAS.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      descripcion: v.descripcion,
      grano: v.grano,
      columnas: columnasVisibles(v, rol),
    }));
    const base = { vistas, puedeSQL: admin, puedeTablas: admin, veCostos: puedeVerCostos(rol) };
    if (!admin) return { ...base, tablas: [], recomendadas: [] };
    const crudo = await this.catalogoTablas();
    return { ...base, ...crudo };
  }

  private async catalogoTablas() {
    // Cache de 5 minutos: el esquema no cambia a cada rato.
    if (this.catalogoCache && Date.now() - this.catalogoCache.en < 5 * 60_000) {
      return this.catalogoCache.data;
    }
    const filas = await this.rpcSql(`
      select c.table_name as tabla, c.column_name as columna, c.data_type as tipo, c.ordinal_position as posicion
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by c.table_name, c.ordinal_position
    `);
    const porTabla: Record<string, any> = {};
    for (const f of filas) {
      const t = String(f.tabla);
      porTabla[t] = porTabla[t] || { tabla: t, descripcion: TABLAS_RECOMENDADAS[t] || null, columnas: [] };
      porTabla[t].columnas.push({ nombre: f.columna, tipo: f.tipo });
    }
    const tablas = Object.values(porTabla).sort((a: any, b: any) => {
      const ra = TABLAS_RECOMENDADAS[a.tabla] ? 0 : 1;
      const rb = TABLAS_RECOMENDADAS[b.tabla] ? 0 : 1;
      return ra - rb || a.tabla.localeCompare(b.tabla);
    });
    const data = { tablas, recomendadas: Object.keys(TABLAS_RECOMENDADAS) };
    this.catalogoCache = { data, en: Date.now() };
    return data;
  }

  /* ── Constructor visual → SQL ───────────────────────────────────────── */
  private async validarContraCatalogo(tabla: string, campos: string[], rol?: string) {
    const vista = VISTAS_POR_ID[tabla];
    if (vista) {
      const nombres = new Set(columnasVisibles(vista, rol).map((c) => c.nombre));
      for (const c of campos) {
        if (!nombres.has(c)) {
          const existe = vista.columnas.some((x) => x.nombre === c);
          if (existe) throw new ForbiddenException(`La columna "${c}" (costo/margen) no está disponible para tu perfil.`);
          throw new BadRequestException(`La columna "${c}" no existe en "${vista.nombre}".`);
        }
      }
      return;
    }
    if (!esRolAdmin(rol)) {
      throw new ForbiddenException('Las tablas crudas son solo para administración: elige una vista de negocio.');
    }
    const cat = await this.catalogoTablas();
    const t = (cat.tablas as any[]).find((x) => x.tabla === tabla);
    if (!t) throw new BadRequestException(`La tabla "${tabla}" no existe en el catálogo.`);
    const nombres = new Set(t.columnas.map((c: any) => c.nombre));
    for (const c of campos) {
      if (!nombres.has(c)) {
        throw new BadRequestException(`La columna "${c}" no existe en la tabla "${tabla}".`);
      }
    }
  }

  construirSQL(config: ConfigConstructor): string {
    // Origen: una vista de negocio (subconsulta definida en vistas.ts) o una
    // tabla cruda. En ambos casos el resto del SQL se arma igual.
    const vista = VISTAS_POR_ID[String(config.tabla || '')];
    const tabla = vista ? `(${vista.sql.trim()}) ${ident(vista.id)}` : ident(config.tabla);
    const agrupar = (config.agrupar || []).filter(Boolean);
    const agregaciones = (config.agregaciones || []).filter((a) => a?.funcion && a?.campo);
    const columnas = (config.columnas || []).filter(Boolean);

    let select: string;
    if (agrupar.length || agregaciones.length) {
      const partes: string[] = agrupar.map((c) => ident(c));
      for (const a of agregaciones) {
        const fn = AGREGACIONES[a.funcion];
        if (!fn) throw new BadRequestException(`Agregación no válida: "${a.funcion}".`);
        const campo = a.campo === '*' ? '*' : ident(a.campo);
        partes.push(`${fn}(${campo})::numeric as ${ident(`${a.funcion}_${a.campo === '*' ? 'filas' : a.campo}`)}`);
      }
      if (!partes.length) throw new BadRequestException('Agrega al menos una columna o agregación.');
      select = partes.join(', ');
    } else {
      select = columnas.length ? columnas.map((c) => ident(c)).join(', ') : '*';
    }

    const where: string[] = [];
    for (const f of config.filtros || []) {
      if (!f?.campo || !f?.operador) continue;
      const op = OPERADORES[f.operador];
      if (!op) throw new BadRequestException(`Operador no válido: "${f.operador}".`);
      const campo = ident(f.campo);
      if (op === 'is null' || op === 'is not null') {
        where.push(`${campo} ${op}`);
      } else if (op === 'ilike' || op === 'not ilike') {
        where.push(`${campo}::text ${op} ${literal(`%${f.valor ?? ''}%`)}`);
      } else {
        const v = String(f.valor ?? '');
        // Numérico se compara como número; el resto como texto.
        const esNum = v !== '' && !Number.isNaN(Number(v)) && !/^0\d/.test(v);
        where.push(esNum ? `${campo}::numeric ${op} ${v}` : `${campo}::text ${op} ${literal(v)}`);
      }
    }

    let sql = `select ${select} from ${tabla}`;
    if (where.length) sql += ` where ${where.join(' and ')}`;
    if (agrupar.length) sql += ` group by ${agrupar.map((c) => ident(c)).join(', ')}`;
    if (config.ordenarPor) {
      // El orden puede apuntar a una columna o al alias de una agregación.
      sql += ` order by ${ident(config.ordenarPor)} ${config.ordenDesc ? 'desc' : 'asc'} nulls last`;
    }
    const limite = Math.min(Math.max(Number(config.limite) || 500, 1), LIMITE_FILAS);
    sql += ` limit ${limite}`;
    return sql;
  }

  async ejecutarConstructor(config: ConfigConstructor, rol?: string) {
    if (!config?.tabla) throw new BadRequestException('Elige un origen para el reporte.');
    const campos = [
      ...(config.columnas || []),
      ...(config.filtros || []).map((f) => f.campo),
      ...(config.agrupar || []),
      ...(config.agregaciones || []).map((a) => a.campo).filter((c) => c !== '*'),
    ].filter(Boolean);
    await this.validarContraCatalogo(config.tabla, campos, rol);
    // En una vista, "todas las columnas" = las visibles para el rol (así el
    // `select *` nunca filtra costo/margen a quien no puede verlos).
    const vista = VISTAS_POR_ID[config.tabla];
    const cfg = { ...config };
    const agrupado = (cfg.agrupar || []).length > 0 || (cfg.agregaciones || []).length > 0;
    if (vista && !agrupado && !(cfg.columnas || []).length) {
      cfg.columnas = columnasVisibles(vista, rol).map((c) => c.nombre);
    }
    const sql = this.construirSQL(cfg);
    return await this.ejecutarSQL(sql, { incluirSQL: esRolAdmin(rol) });
  }

  /* ── SQL libre (solo lectura; candados en rpcSql y en la función) ────── */
  async ejecutarSQL(consulta: string, opts: { incluirSQL?: boolean } = {}) {
    const sql = String(consulta || '').trim();
    const inicio = Date.now();
    const filas = await this.rpcSql(sql);
    const truncado = filas.length > LIMITE_FILAS;
    const visibles = truncado ? filas.slice(0, LIMITE_FILAS) : filas;
    const columnas = visibles.length ? Object.keys(visibles[0]) : [];
    return {
      columnas,
      filas: visibles,
      total: visibles.length,
      truncado,
      ms: Date.now() - inicio,
      ...(opts.incluirSQL ? { sql } : {}),
    };
  }

  /* ── Reportes guardados ─────────────────────────────────────────────── */
  private faltaTabla(error: any): boolean {
    return /reportes_guardados/.test(String(error?.message || '')) &&
      /does not exist|schema cache/i.test(String(error?.message || ''));
  }

  async listarGuardados() {
    const { data, error } = await this.supabase
      .getClient()
      .from('reportes_guardados')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      if (this.faltaTabla(error)) return [];
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  async guardarReporte(body: any, email: string) {
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El reporte necesita un nombre.');
    const tipo = body?.tipo === 'sql' ? 'sql' : 'constructor';
    const fila: Record<string, any> = {
      nombre,
      descripcion: String(body?.descripcion || '').trim() || null,
      tipo,
      config: body?.config ?? null,
      sql: tipo === 'sql' ? String(body?.sql || '').trim() || null : null,
      updated_at: new Date().toISOString(),
    };
    const client = this.supabase.getClient();
    let res;
    if (body?.id) {
      res = await client.from('reportes_guardados').update(fila).eq('id', Number(body.id)).select().single();
    } else {
      fila.creado_por = email || null;
      res = await client.from('reportes_guardados').insert([fila]).select().single();
    }
    if (res.error) {
      if (this.faltaTabla(res.error)) {
        throw new BadRequestException('Falta aplicar la migración 20260917_reporteria.sql en Supabase.');
      }
      throw new BadRequestException(res.error.message);
    }
    return res.data;
  }

  async eliminarReporte(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('reportes_guardados')
      .delete()
      .eq('id', Number(id));
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
