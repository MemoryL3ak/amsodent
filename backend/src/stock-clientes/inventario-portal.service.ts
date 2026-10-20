import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ── Inventario del portal de clientes por lotes de costo (2026-10-19) ───────
   Pedido de Ariel: una sección «Inventario» donde el cliente va agregando el
   stock nuevo; cada ingreso (lote) tiene su costo, así que un mismo producto
   puede tener varios costos, y se guarda el historial (la pantalla muestra
   los últimos 5 movimientos). La editan el administrador y el asistente de la
   cuenta del portal. En Gestión de Stock el stock solo baja y el precio
   unitario no se edita (decisiones de Ariel):
   · las salidas descuentan primero el lote más antiguo (FIFO);
   · el precio unitario del producto = costo promedio ponderado de lo que
     queda (se guarda en stock_productos_cliente.precio_unitario, así todo lo
     que ya lo leía sigue igual);
   · los productos nuevos y la carga masiva se hacen aquí, con su costo.
   Tablas: stock_lotes_cliente y stock_movimientos_cliente (migración
   20261019_portal_inventario_lotes). Sin ellas el portal sigue como antes. */

export type LoteFifo = { id: number; restante: number; costo: number; fecha?: string | null; created_at?: string | null };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const texto = (v: any, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const normNombre = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// Igual que normalizarRut del portal: minúsculas, solo dígitos y k.
const normRut = (v: any) => String(v ?? '').toLowerCase().replace(/[^0-9k]/g, '');
const MIGRACION = 'El Inventario aún no está activo: falta aplicar la migración 20261019_portal_inventario_lotes en Supabase.';

/* El lote más antiguo primero: por fecha de ingreso, luego por creación. */
export function ordenarFifo<T extends LoteFifo>(lotes: T[]): T[] {
  return [...lotes].sort(
    (a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id - b.id,
  );
}

/* Descuenta `cantidad` de los lotes, del más antiguo al más nuevo. Devuelve el
   restante nuevo de cada lote tocado y lo que no alcanzó a salir de ningún
   lote (stock sin lote, p. ej. cargado antes de existir el Inventario). */
export function consumirFifo(lotes: LoteFifo[], cantidad: number) {
  let falta = r2(Math.max(0, Number(cantidad) || 0));
  const cambios: { id: number; restante: number; consumido: number; costo: number }[] = [];
  for (const l of ordenarFifo(lotes)) {
    if (falta <= 0) break;
    const restante = r2(l.restante);
    if (restante <= 0) continue;
    const usa = Math.min(restante, falta);
    cambios.push({ id: l.id, restante: r2(restante - usa), consumido: r2(usa), costo: Number(l.costo) || 0 });
    falta = r2(falta - usa);
  }
  return { cambios, sinLote: falta };
}

/* Costo promedio ponderado (entero de pesos) de lo que queda; null si no queda nada. */
export function costoPromedio(lotes: Pick<LoteFifo, 'restante' | 'costo'>[]): number | null {
  let unidades = 0;
  let valor = 0;
  for (const l of lotes) {
    const q = Number(l.restante) || 0;
    if (q <= 0) continue;
    unidades += q;
    valor += q * (Number(l.costo) || 0);
  }
  return unidades > 0 ? Math.round(valor / unidades) : null;
}

type Usuario = { email: string | null; nombre: string | null };
const usuarioDe = (p: any): Usuario => ({ email: p?.usuario_email || 'cuenta principal', nombre: p?.usuario_nombre || null });
const esAdminToken = (p: any) => String(p?.rol || 'admin') !== 'asistente';

@Injectable()
export class InventarioPortalService {
  private readonly logger = new Logger(InventarioPortalService.name);
  private cacheListo: { ts: number; ok: boolean } | null = null;

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  /* ¿Están las tablas del Inventario? (caché: 10 min si sí, 1 min si no). */
  async listo(): Promise<boolean> {
    if (this.cacheListo && Date.now() - this.cacheListo.ts < (this.cacheListo.ok ? 600_000 : 60_000)) return this.cacheListo.ok;
    const { error } = await this.db.from('stock_lotes_cliente').select('id').limit(1);
    const ok = !error;
    if (error && !/(does not exist|schema cache|PGRST205|42P01)/i.test(`${error.code} ${error.message}`)) this.logger.warn(`Inventario: ${error.message}`);
    this.cacheListo = { ts: Date.now(), ok };
    return ok;
  }

  async exigirListo() {
    if (!(await this.listo())) throw new BadRequestException(MIGRACION);
  }

  private async sucursalPorDefecto(rut: string, sucursalId: any): Promise<number | null> {
    const id = Number(sucursalId) || null;
    if (id) {
      const { data } = await this.db.from('stock_sucursales').select('id, rut').eq('id', id).maybeSingle();
      if (!data || normRut((data as any).rut) !== rut) throw new ForbiddenException('Esa sucursal no es de tu cuenta.');
      return id;
    }
    // Como listarSucursales: la más antigua activa (la Casa Matriz).
    const { data } = await this.db.from('stock_sucursales').select('id').eq('rut', rut).eq('activo', true).order('created_at', { ascending: true }).limit(1);
    return Number((data || [])[0]?.id) || null;
  }

  private async producto(rut: string, productoId: number) {
    const { data, error } = await this.db.from('stock_productos_cliente').select('*').eq('id', productoId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data || (data as any).activo === false) throw new NotFoundException('Ese producto no existe.');
    if (normRut((data as any).rut) !== rut) throw new ForbiddenException('Ese producto no es de tu cuenta.');
    return data as any;
  }

  private async lotesDe(productoId: number): Promise<any[]> {
    const { data, error } = await this.db.from('stock_lotes_cliente').select('*').eq('producto_id', productoId).order('fecha', { ascending: true }).order('id', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data || []) as any[];
  }

  private aFifo = (l: any): LoteFifo => ({ id: Number(l.id), restante: Number(l.cantidad_restante) || 0, costo: Number(l.costo_unitario) || 0, fecha: l.fecha, created_at: l.created_at });

  /* ── Lectura: productos de la sucursal con sus lotes y últimos 5 movimientos ── */
  async listar(rutIn: string, sucursalId: any) {
    await this.exigirListo();
    const rut = normRut(rutIn);
    const suc = await this.sucursalPorDefecto(rut, sucursalId);
    let q = this.db.from('stock_productos_cliente').select('id, nombre, sku, marca, unidad, stock_actual, stock_minimo, stock_alerta, precio_unitario, sucursal_id').eq('rut', rut).eq('activo', true);
    q = suc ? q.eq('sucursal_id', suc) : q.is('sucursal_id', null);
    const { data: prods, error } = await q.order('nombre', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const productos = (prods || []) as any[];
    const ids = productos.map((p) => Number(p.id));
    const lotes: any[] = [];
    const movs: any[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const tanda = ids.slice(i, i + 300);
      const [rl, rm] = await Promise.all([
        this.db.from('stock_lotes_cliente').select('id, producto_id, cantidad_inicial, cantidad_restante, costo_unitario, fecha, nota, usuario_email, usuario_nombre, created_at').in('producto_id', tanda).order('fecha', { ascending: true }).order('id', { ascending: true }).range(0, 20000),
        this.db.from('stock_movimientos_cliente').select('id, producto_id, tipo, cantidad, costo_unitario, stock_resultante, costo_promedio, nota, usuario_email, usuario_nombre, created_at').in('producto_id', tanda).order('created_at', { ascending: false }).range(0, 5000),
      ]);
      if (rl.error) throw new BadRequestException(rl.error.message);
      if (rm.error) throw new BadRequestException(rm.error.message);
      lotes.push(...(rl.data || []));
      movs.push(...(rm.data || []));
    }
    return {
      sucursal_id: suc,
      productos: productos.map((p) => {
        const propios = lotes.filter((l) => Number(l.producto_id) === Number(p.id));
        const conStock = propios.filter((l) => Number(l.cantidad_restante) > 0);
        return {
          id: Number(p.id),
          nombre: p.nombre,
          sku: p.sku || '',
          marca: p.marca || '',
          unidad: p.unidad || '',
          stock_actual: Number(p.stock_actual) || 0,
          stock_minimo: Number(p.stock_minimo) || 0,
          stock_alerta: p.stock_alerta == null ? null : Number(p.stock_alerta),
          costo_promedio: costoPromedio(conStock.map(this.aFifo)) ?? (Number(p.precio_unitario) || 0),
          // Stock que no está en ningún lote (cargado antes del Inventario sin costo conocido).
          sin_lote: r2(Math.max(0, (Number(p.stock_actual) || 0) - conStock.reduce((a, l) => a + (Number(l.cantidad_restante) || 0), 0))),
          lotes: conStock.map((l) => ({ id: Number(l.id), fecha: l.fecha, cantidad_inicial: Number(l.cantidad_inicial), cantidad_restante: Number(l.cantidad_restante), costo_unitario: Number(l.costo_unitario) || 0, nota: l.nota || '', usuario: l.usuario_nombre || l.usuario_email || '' })),
          movimientos: movs.filter((m) => Number(m.producto_id) === Number(p.id)).slice(0, 5).map((m) => ({ id: Number(m.id), tipo: m.tipo, cantidad: Number(m.cantidad), costo_unitario: m.costo_unitario == null ? null : Number(m.costo_unitario), stock_resultante: m.stock_resultante == null ? null : Number(m.stock_resultante), costo_promedio: m.costo_promedio == null ? null : Number(m.costo_promedio), nota: m.nota || '', usuario: m.usuario_nombre || m.usuario_email || '', fecha: m.created_at })),
        };
      }),
    };
  }

  /* ── Ingreso de stock (un lote nuevo con su costo) ── */
  async ingresar(payload: any, body: any, opts: { permitirExistente?: boolean } = {}) {
    await this.exigirListo();
    const rut = normRut(payload?.rut);
    if (!rut) throw new ForbiddenException('Sesión inválida.');
    const cantidad = r2(Number(String(body?.cantidad ?? '').replace(',', '.')));
    if (!(cantidad > 0) || cantidad > 10_000_000) throw new BadRequestException('Indica una cantidad mayor que 0.');
    const costo = Math.round(Number(String(body?.costo_unitario ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')));
    if (!Number.isFinite(costo) || costo < 0) throw new BadRequestException('Indica el costo unitario (0 o más).');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.fecha || '')) ? String(body.fecha) : hoyEnChile();
    if (fecha > hoyEnChile()) throw new BadRequestException('La fecha del ingreso no puede ser futura.');
    const nota = texto(body?.nota, 200) || null;
    const usuario = usuarioDe(payload);

    let prod: any;
    let creado = false;
    if (Number(body?.producto_id) > 0) {
      prod = await this.producto(rut, Number(body.producto_id));
    } else {
      const n = body?.nuevo || {};
      const nombre = texto(n.nombre, 200);
      if (!nombre) throw new BadRequestException('El producto nuevo necesita un nombre.');
      const sku = texto(n.sku, 80) || null;
      const suc = await this.sucursalPorDefecto(rut, body?.sucursal_id);
      let q = this.db.from('stock_productos_cliente').select('*').eq('rut', rut).eq('activo', true);
      q = suc ? q.eq('sucursal_id', suc) : q.is('sucursal_id', null);
      const { data: existentes } = await q;
      const igual = ((existentes || []) as any[]).find((p) => (sku && String(p.sku || '').trim().toUpperCase() === sku.toUpperCase()) || normNombre(p.nombre) === normNombre(nombre));
      if (igual && !opts.permitirExistente) throw new BadRequestException(`«${igual.nombre}» ya está en esta sucursal: ingresa el stock desde su fila.`);
      if (igual) {
        prod = igual;
      } else {
        const admin = esAdminToken(payload);
        const minimo = admin ? Math.max(0, Number(n.stock_minimo) || 0) : 0;
        const alerta = admin && Number(n.stock_alerta) > 0 ? Number(n.stock_alerta) : null;
        const fila: Record<string, any> = {
          rut, sucursal_id: suc, nombre, sku, marca: texto(n.marca, 100) || null, unidad: texto(n.unidad, 50) || null,
          stock_actual: 0, stock_minimo: minimo, stock_alerta: alerta, precio_unitario: costo, activo: true,
          ubicacion_id: Number(n.ubicacion_id) || null, actualizado_at: new Date().toISOString(),
        };
        const { data, error } = await this.db.from('stock_productos_cliente').insert(fila).select('*').single();
        if (error) throw new BadRequestException(`No se pudo crear el producto: ${error.message}`);
        prod = data;
        creado = true;
      }
    }

    const { error: errLote } = await this.db.from('stock_lotes_cliente').insert({
      rut, producto_id: Number(prod.id), cantidad_inicial: cantidad, cantidad_restante: cantidad, costo_unitario: costo, fecha, nota,
      usuario_email: usuario.email, usuario_nombre: usuario.nombre,
    });
    if (errLote) throw new BadRequestException(`No se pudo registrar el ingreso: ${errLote.message}`);
    const lotes = await this.lotesDe(Number(prod.id));
    const stock = r2((Number(prod.stock_actual) || 0) + cantidad);
    const promedio = costoPromedio(lotes.map(this.aFifo)) ?? costo;
    const { error: errProd } = await this.db.from('stock_productos_cliente').update({ stock_actual: stock, precio_unitario: promedio, actualizado_at: new Date().toISOString() }).eq('id', prod.id);
    if (errProd) throw new BadRequestException(`El ingreso quedó registrado pero no se pudo actualizar el stock: ${errProd.message}`);
    await this.anotar({ rut, productoId: Number(prod.id), tipo: 'ingreso', cantidad, costo, stock, promedio, nota, usuario });
    return { ok: true, creado, producto: { id: Number(prod.id), nombre: prod.nombre, stock_actual: stock, costo_promedio: promedio } };
  }

  /* ── Carga masiva: cada fila es un ingreso (crea el producto si no existe) ── */
  async cargaMasiva(payload: any, body: any) {
    await this.exigirListo();
    const filas = Array.isArray(body?.filas) ? body.filas.slice(0, 500) : [];
    if (!filas.length) throw new BadRequestException('La planilla no trae filas.');
    const resultado: { fila: number; nombre: string; ok: boolean; creado?: boolean; error?: string }[] = [];
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i] || {};
      const nombre = texto(f.nombre, 200);
      try {
        const r = await this.ingresar(payload, {
          sucursal_id: body?.sucursal_id, cantidad: f.cantidad, costo_unitario: f.costo, fecha: body?.fecha, nota: texto(f.nota, 200) || 'Carga masiva',
          nuevo: { nombre, sku: f.sku, marca: f.marca, unidad: f.unidad },
        }, { permitirExistente: true });
        resultado.push({ fila: i + 1, nombre, ok: true, creado: r.creado });
      } catch (e: any) {
        resultado.push({ fila: i + 1, nombre, ok: false, error: String(e?.message || e).slice(0, 200) });
      }
    }
    return { ok: true, ingresados: resultado.filter((r) => r.ok).length, creados: resultado.filter((r) => r.creado).length, errores: resultado.filter((r) => !r.ok), resultado };
  }

  /* ── Salida desde Gestión de Stock: descuenta FIFO y recalcula el promedio ──
     Devuelve el precio unitario nuevo (promedio de lo que queda; si no queda
     nada, el que tenía). */
  async registrarSalida(args: { rut: string; producto: any; nuevoStock: number; usuario: Usuario }): Promise<number | null> {
    const anterior = Number(args.producto.stock_actual) || 0;
    const cantidad = r2(anterior - args.nuevoStock);
    if (!(cantidad > 0)) return Number(args.producto.precio_unitario) || null;
    const lotes = await this.lotesDe(Number(args.producto.id));
    const fifo = lotes.map(this.aFifo);
    const { cambios } = consumirFifo(fifo, cantidad);
    for (const c of cambios) {
      const { error } = await this.db.from('stock_lotes_cliente').update({ cantidad_restante: c.restante }).eq('id', c.id);
      if (error) throw new BadRequestException(`No se pudo descontar el lote: ${error.message}`);
    }
    const restantes = fifo.map((l) => ({ ...l, restante: cambios.find((c) => c.id === l.id)?.restante ?? l.restante }));
    const promedio = costoPromedio(restantes) ?? (Number(args.producto.precio_unitario) || null);
    const consumido = cambios.reduce((a, c) => a + c.consumido, 0);
    const costoSalida = consumido > 0 ? Math.round(cambios.reduce((a, c) => a + c.consumido * c.costo, 0) / consumido) : null;
    await this.anotar({ rut: args.rut, productoId: Number(args.producto.id), tipo: 'salida', cantidad, costo: costoSalida, stock: r2(args.nuevoStock), promedio, nota: null, usuario: args.usuario });
    return promedio;
  }

  private async anotar(m: { rut: string; productoId: number; tipo: 'ingreso' | 'salida'; cantidad: number; costo: number | null; stock: number; promedio: number | null; nota: string | null; usuario: Usuario }) {
    const { error } = await this.db.from('stock_movimientos_cliente').insert({
      rut: m.rut, producto_id: m.productoId, tipo: m.tipo, cantidad: m.cantidad, costo_unitario: m.costo, stock_resultante: m.stock, costo_promedio: m.promedio,
      nota: m.nota, usuario_email: m.usuario.email, usuario_nombre: m.usuario.nombre,
    });
    if (error) this.logger.warn(`Movimiento de inventario sin registrar (producto ${m.productoId}): ${error.message}`);
  }
}
