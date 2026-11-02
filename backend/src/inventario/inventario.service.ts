import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Inventario (pedido 2026-08-27)
   ----------------------------------------------------------------------------
   El stock vigente vive en productos.stock y cada cambio queda en
   inventario_movimientos (entrada / salida / ajuste) con el stock resultante
   estampado. Este servicio es el ÚNICO que escribe stock: lee el valor actual,
   calcula el delta, actualiza el producto y anota el movimiento.

   Requiere la migración 20260827_inventario.sql. Si no está aplicada, los
   errores de columna/tabla se traducen a un mensaje que lo dice.

   (2026-11-02) SUCURSALES. productos.stock sigue siendo el TOTAL (lo leen
   Gestión de compras, el portal, la facturación…); inventario_stock_sucursales
   lo reparte por sucursal propia y los traslados lo mueven entre ellas:
     productos.stock = Σ stock por sucursal + unidades en tránsito.
   Cada movimiento lleva su sucursal (la principal si no se indica) y el stock
   resultante en ella. Sin la migración 20261102 el módulo sigue funcionando
   como antes (un solo stock): `sucursalesListo()` lo detecta.
============================================================================ */

const TIPOS = new Set(['entrada', 'salida', 'ajuste']);
const MIGRACION_SUCURSALES = 'Falta aplicar la migración 20261102_inventario_sucursales.sql en Supabase.';

export type Sucursal = {
  id: number;
  nombre: string;
  direccion: string | null;
  comuna: string | null;
  activa: boolean;
  es_principal: boolean;
  bsale_office_id: number | null;
  orden: number;
  created_at?: string;
};

type LineaTraslado = {
  id?: number;
  traslado_id?: number;
  producto_id: number;
  sku: string | null;
  nombre: string | null;
  cantidad: number;
  cantidad_recibida: number | null;
};

function faltaTabla(mensaje: string) {
  return /does not exist|schema cache/i.test(String(mensaje || ''));
}

function sinMigracion(mensaje: string) {
  if (!faltaTabla(mensaje)) return mensaje;
  if (/sucursal|traslado/i.test(mensaje)) return MIGRACION_SUCURSALES;
  return 'Falta aplicar la migración 20260827_inventario.sql en Supabase.';
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

@Injectable()
export class InventarioService {
  constructor(private supabase: SupabaseService) {}

  /* ---------------------------------------------------------------- sucursales */

  // Se consulta una vez: si la tabla existe queda en true para siempre; si
  // falta la migración se vuelve a mirar al minuto (para no pegarle a
  // Supabase en cada movimiento mientras tanto).
  private listoCache: { valor: boolean; hasta: number } | null = null;

  async sucursalesListo(): Promise<boolean> {
    const ahora = Date.now();
    if (this.listoCache && (this.listoCache.valor || this.listoCache.hasta > ahora)) return this.listoCache.valor;
    const { error } = await this.supabase.getClient().from('inventario_sucursales').select('id').limit(1);
    const valor = !error;
    if (error && !faltaTabla(error.message)) throw new BadRequestException(error.message);
    this.listoCache = { valor, hasta: ahora + 60_000 };
    return valor;
  }

  private async exigirSucursales() {
    if (!(await this.sucursalesListo())) throw new BadRequestException(MIGRACION_SUCURSALES);
  }

  /* Todas las sucursales (activas e inactivas), la principal primero. */
  async listarSucursales(): Promise<Sucursal[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('inventario_sucursales')
      .select('*')
      .order('es_principal', { ascending: false })
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return (data || []).map(normalizarSucursal);
  }

  async principal(): Promise<Sucursal | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('inventario_sucursales')
      .select('*')
      .eq('es_principal', true)
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(sinMigracion(error.message));
    if (data) return normalizarSucursal(data);
    // Sin principal marcada (no debería pasar): la primera activa.
    const todas = await this.listarSucursales();
    return todas.find((s) => s.activa) || todas[0] || null;
  }

  async sucursalPorId(id: number): Promise<Sucursal> {
    const { data, error } = await this.supabase
      .getClient()
      .from('inventario_sucursales')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(sinMigracion(error.message));
    if (!data) throw new NotFoundException('Sucursal no encontrada.');
    return normalizarSucursal(data);
  }

  /* Sucursal del movimiento: la indicada o la principal. Null = módulo sin la
     migración de sucursales (comportamiento histórico, un solo stock). */
  private async sucursalDelMovimiento(sucursalId?: unknown): Promise<Sucursal | null> {
    if (!(await this.sucursalesListo())) return null;
    const id = Number(sucursalId);
    const s = id ? await this.sucursalPorId(id) : await this.principal();
    if (!s) throw new BadRequestException('No hay ninguna sucursal definida en el Inventario.');
    if (!s.activa) throw new BadRequestException(`La sucursal «${s.nombre}» está inactiva: actívala o elige otra.`);
    return s;
  }

  /* Resumen por sucursal para el mantenedor: SKUs con stock, unidades y
     valorización (stock × costo del catálogo). */
  async resumenSucursales(verCostos = true) {
    await this.exigirSucursales();
    const client = this.supabase.getClient();
    const sucursales = await this.listarSucursales();
    const { data: st, error } = await client
      .from('inventario_stock_sucursales')
      .select('producto_id, sucursal_id, stock')
      .neq('stock', 0)
      .range(0, 50000);
    if (error) throw new BadRequestException(sinMigracion(error.message));
    const costos = new Map<number, number>();
    if (verCostos && (st || []).length) {
      const ids = [...new Set((st || []).map((r: any) => Number(r.producto_id)))];
      for (let i = 0; i < ids.length; i += 500) {
        const { data } = await client.from('productos').select('id, costo').in('id', ids.slice(i, i + 500));
        for (const p of data || []) costos.set(Number(p.id), num(p.costo));
      }
    }
    const porSucursal = new Map<number, { skus: number; unidades: number; valor: number }>();
    for (const r of st || []) {
      const sid = Number(r.sucursal_id);
      const e = porSucursal.get(sid) || { skus: 0, unidades: 0, valor: 0 };
      const stock = num(r.stock);
      if (stock > 0) {
        e.skus += 1;
        e.unidades += stock;
        e.valor += stock * (costos.get(Number(r.producto_id)) || 0);
      }
      porSucursal.set(sid, e);
    }
    const { data: tr } = await client
      .from('inventario_traslados')
      .select('id, origen_id, destino_id')
      .eq('estado', 'en_transito')
      .range(0, 5000);
    const enTransito = new Map<number, number>();
    for (const t of tr || []) {
      enTransito.set(Number(t.origen_id), (enTransito.get(Number(t.origen_id)) || 0) + 1);
      enTransito.set(Number(t.destino_id), (enTransito.get(Number(t.destino_id)) || 0) + 1);
    }
    return sucursales.map((s) => {
      const e = porSucursal.get(s.id) || { skus: 0, unidades: 0, valor: 0 };
      return {
        ...s,
        skus_con_stock: e.skus,
        unidades: e.unidades,
        ...(verCostos ? { valorizacion: e.valor } : {}),
        traslados_en_transito: enTransito.get(s.id) || 0,
      };
    });
  }

  async crearSucursal(body: Record<string, any>) {
    await this.exigirSucursales();
    const fila = this.validarSucursal(body);
    const client = this.supabase.getClient();
    if (fila.es_principal) await this.quitarPrincipal();
    const { data, error } = await client.from('inventario_sucursales').insert([fila]).select().single();
    if (error) throw new BadRequestException(errorSucursal(error.message));
    return normalizarSucursal(data);
  }

  async editarSucursal(id: number, body: Record<string, any>) {
    await this.exigirSucursales();
    const actual = await this.sucursalPorId(id);
    const fila = this.validarSucursal({ ...actual, ...body });
    const client = this.supabase.getClient();

    if (actual.es_principal && !fila.es_principal) {
      throw new BadRequestException('Siempre debe haber una sucursal principal: marca otra como principal en su lugar.');
    }
    if (actual.es_principal && !fila.activa) {
      throw new BadRequestException('La sucursal principal no se puede desactivar.');
    }
    if (actual.activa && !fila.activa) {
      // No se desactiva con stock ni con traslados abiertos: quedaría stock invisible.
      const { data: conStock } = await client
        .from('inventario_stock_sucursales')
        .select('producto_id')
        .eq('sucursal_id', id)
        .neq('stock', 0)
        .limit(1);
      if ((conStock || []).length) {
        throw new BadRequestException('La sucursal aún tiene stock: trasládalo a otra sucursal antes de desactivarla.');
      }
      const { data: abiertos } = await client
        .from('inventario_traslados')
        .select('id')
        .eq('estado', 'en_transito')
        .or(`origen_id.eq.${id},destino_id.eq.${id}`)
        .limit(1);
      if ((abiertos || []).length) {
        throw new BadRequestException('La sucursal tiene traslados en tránsito: recíbelos o anúlalos antes de desactivarla.');
      }
    }
    if (fila.es_principal && !fila.activa) {
      throw new BadRequestException('La sucursal principal tiene que estar activa.');
    }
    if (fila.es_principal && !actual.es_principal) await this.quitarPrincipal();

    const { data, error } = await client.from('inventario_sucursales').update(fila).eq('id', id).select().single();
    if (error) throw new BadRequestException(errorSucursal(error.message));
    return normalizarSucursal(data);
  }

  private validarSucursal(body: Record<string, any>) {
    const nombre = String(body?.nombre || '').trim().replace(/\s+/g, ' ');
    if (!nombre) throw new BadRequestException('La sucursal necesita un nombre.');
    if (nombre.length > 80) throw new BadRequestException('El nombre de la sucursal es demasiado largo (máximo 80 caracteres).');
    const office = body?.bsale_office_id === '' || body?.bsale_office_id == null ? null : Number(body.bsale_office_id);
    if (office !== null && (!Number.isInteger(office) || office <= 0)) {
      throw new BadRequestException('El id de sucursal en Bsale debe ser un número entero positivo (o quedar vacío).');
    }
    return {
      nombre,
      direccion: String(body?.direccion || '').trim() || null,
      comuna: String(body?.comuna || '').trim() || null,
      activa: body?.activa === undefined ? true : !!body.activa,
      es_principal: !!body?.es_principal,
      bsale_office_id: office,
      orden: Number.isFinite(Number(body?.orden)) ? Number(body.orden) : 0,
    };
  }

  // El índice único parcial exige que haya a lo más una principal: se quita
  // la marca actual antes de poner la nueva.
  private async quitarPrincipal() {
    const { error } = await this.supabase
      .getClient()
      .from('inventario_sucursales')
      .update({ es_principal: false })
      .eq('es_principal', true);
    if (error) throw new BadRequestException(sinMigracion(error.message));
  }

  /* --------------------------------------------------------- stock por sucursal */

  private async stockEnSucursal(productoId: number, sucursalId: number): Promise<number> {
    const { data, error } = await this.supabase
      .getClient()
      .from('inventario_stock_sucursales')
      .select('stock')
      .eq('producto_id', productoId)
      .eq('sucursal_id', sucursalId)
      .maybeSingle();
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return num(data?.stock);
  }

  /* Stock del producto en TODAS las sucursales (id → stock, solo las ≠ 0). */
  private async stockPorSucursal(productoId: number): Promise<Map<number, number>> {
    const { data, error } = await this.supabase
      .getClient()
      .from('inventario_stock_sucursales')
      .select('sucursal_id, stock')
      .eq('producto_id', productoId);
    if (error) throw new BadRequestException(sinMigracion(error.message));
    const out = new Map<number, number>();
    for (const r of data || []) if (num(r.stock) !== 0) out.set(Number(r.sucursal_id), num(r.stock));
    return out;
  }

  private async guardarStockSucursal(productoId: number, sucursalId: number, stock: number) {
    const { error } = await this.supabase
      .getClient()
      .from('inventario_stock_sucursales')
      .upsert([{ producto_id: productoId, sucursal_id: sucursalId, stock, updated_at: new Date().toISOString() }], {
        onConflict: 'producto_id,sucursal_id',
      });
    if (error) throw new BadRequestException(sinMigracion(error.message));
  }

  private async guardarStockTotal(productoId: number, stock: number) {
    const { error } = await this.supabase.getClient().from('productos').update({ stock }).eq('id', productoId);
    if (error) throw new BadRequestException(sinMigracion(error.message));
  }

  /* Una fila del libro. Devuelve lo insertado. */
  private async anotar(fila: Record<string, any>) {
    const { data, error } = await this.supabase.getClient().from('inventario_movimientos').insert([fila]).select().single();
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return data;
  }

  /* ------------------------------------------------------------------ lecturas */

  /* Resumen para la grilla: catálogo con stock, umbral y datos de valorización.
     Se pagina server-side contra Supabase (tope 20.000, igual que productos).
     verCostos=false (ni admin ni «ver_costos» en el perfil): las filas salen
     sin `costo`, así la valorización no se reconstruye desde la red.
     (2026-11-02) Con sucursales, cada fila trae además `sucursales`
     ({sucursal_id: stock}, solo las ≠ 0) y `en_transito` (unidades que
     salieron de una sucursal y aún no se reciben en la otra). */
  async resumen(verCostos = true) {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('productos')
      .select('id, sku, nombre, marca, categoria, formato, estado, costo, stock, stock_minimo')
      .range(0, 20000)
      .order('id', { ascending: true });
    if (error) throw new BadRequestException(sinMigracion(error.message));
    const filas: any[] = (data || []).map((p: any) => {
      if (verCostos) return { ...p };
      const sinCosto = { ...p };
      delete sinCosto.costo;
      return sinCosto;
    });

    if (await this.sucursalesListo()) {
      const porProducto = new Map<number, any>();
      for (const p of filas) porProducto.set(Number(p.id), p);
      const { data: st, error: errSt } = await client
        .from('inventario_stock_sucursales')
        .select('producto_id, sucursal_id, stock')
        .neq('stock', 0)
        .range(0, 50000);
      if (errSt) throw new BadRequestException(sinMigracion(errSt.message));
      for (const r of st || []) {
        const p = porProducto.get(Number(r.producto_id));
        if (!p) continue;
        (p.sucursales ||= {})[Number(r.sucursal_id)] = num(r.stock);
      }
      const { data: tr, error: errTr } = await client
        .from('inventario_traslado_lineas')
        .select('producto_id, cantidad, inventario_traslados!inner(estado)')
        .eq('inventario_traslados.estado', 'en_transito')
        .range(0, 20000);
      if (errTr) throw new BadRequestException(sinMigracion(errTr.message));
      for (const l of tr || []) {
        const p = porProducto.get(Number(l.producto_id));
        if (p) p.en_transito = (p.en_transito || 0) + num(l.cantidad);
      }
    }
    return filas;
  }

  /* Movimientos, del más nuevo al más viejo. productoId acota a un producto
     (historial de su ficha); sin él devuelve el libro completo acotado.
     (2026-11-02) sucursalId y tipo filtran en el servidor; tipo "traslado"
     trae las salidas y entradas de traslado. */
  async movimientos(productoId?: number, limit = 300, filtros?: { sucursalId?: number; tipo?: string }) {
    let query = this.supabase
      .getClient()
      .from('inventario_movimientos')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, Math.max(0, Math.min(Number(limit) || 300, 2000) - 1));
    if (productoId) query = query.eq('producto_id', productoId);
    if (filtros?.sucursalId) query = query.eq('sucursal_id', filtros.sucursalId);
    const tipo = String(filtros?.tipo || '').trim().toLowerCase();
    if (tipo === 'traslado') query = query.in('tipo', ['traslado_salida', 'traslado_entrada']);
    else if (tipo) query = query.eq('tipo', tipo);
    const { data, error } = await query;
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return data;
  }

  /* ---------------------------------------------------------------- escrituras */

  /* Registra UN movimiento y deja el stock del producto consistente.
     entrada: suma `cantidad` (positiva). salida: resta (no deja stock
     negativo: mejor rechazar y que se corrija con un ajuste consciente).
     ajuste: `nuevoStock` es el conteo físico y el delta se calcula aquí.
     (2026-11-02) Todo ocurre EN UNA SUCURSAL (`sucursalId`, o la principal):
     la salida y el ajuste se validan contra el stock de esa sucursal, y el
     delta se aplica a la sucursal y al total del producto. */
  async registrarMovimiento(
    body: {
      productoId?: number;
      tipo?: string;
      cantidad?: number;
      nuevoStock?: number;
      motivo?: string;
      referencia?: string;
      costoUnitario?: number;
      sucursalId?: number;
    },
    email: string,
  ) {
    const client = this.supabase.getClient();
    const productoId = Number(body?.productoId);
    const tipo = String(body?.tipo || '').trim().toLowerCase();
    if (!productoId) throw new BadRequestException('Falta el producto del movimiento.');
    if (!TIPOS.has(tipo)) throw new BadRequestException('Tipo de movimiento inválido (entrada, salida o ajuste).');

    const sucursal = await this.sucursalDelMovimiento(body?.sucursalId);

    const { data: prod, error: errProd } = await client
      .from('productos')
      .select('id, sku, nombre, stock')
      .eq('id', productoId)
      .single();
    if (errProd) throw new BadRequestException(sinMigracion(errProd.message));
    if (!prod) throw new NotFoundException('Producto no encontrado.');

    const stockTotal = num(prod.stock);
    // Sin sucursales, el stock "de la sucursal" es el total (comportamiento histórico).
    const stockSucursal = sucursal ? await this.stockEnSucursal(productoId, sucursal.id) : stockTotal;
    const donde = sucursal ? ` en ${sucursal.nombre}` : '';

    let delta: number;
    if (tipo === 'ajuste') {
      const nuevo = Number(body?.nuevoStock);
      if (!Number.isFinite(nuevo) || nuevo < 0) {
        throw new BadRequestException('El ajuste necesita el stock contado (número mayor o igual a 0).');
      }
      delta = nuevo - stockSucursal;
      if (delta === 0) throw new BadRequestException(`El stock contado es igual al vigente${donde}: no hay nada que ajustar.`);
    } else {
      const cantidad = Number(body?.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new BadRequestException('La cantidad debe ser un número mayor a 0.');
      }
      delta = tipo === 'entrada' ? cantidad : -cantidad;
      if (tipo === 'salida' && stockSucursal + delta < 0) {
        throw new BadRequestException(
          `La salida (${cantidad}) supera el stock vigente${donde} (${stockSucursal}). Si el conteo real es otro, registra un ajuste.`,
        );
      }
    }

    const resultanteTotal = stockTotal + delta;
    const resultanteSucursal = stockSucursal + delta;
    const costoUnitario =
      tipo === 'entrada' && Number(body?.costoUnitario) > 0 ? Number(body.costoUnitario) : null;

    /* Primero el movimiento y después el stock: si el segundo update fallara,
       queda un movimiento con stock_resultante distinto al del producto y la
       inconsistencia es VISIBLE en el historial (al revés, un stock cambiado
       sin movimiento sería invisible e inauditable). */
    const mov = await this.anotar({
      producto_id: productoId,
      sku: prod.sku || null,
      tipo,
      cantidad: tipo === 'ajuste' ? delta : Math.abs(delta),
      stock_resultante: resultanteTotal,
      motivo: String(body?.motivo || '').trim() || null,
      referencia: String(body?.referencia || '').trim() || null,
      costo_unitario: costoUnitario,
      usuario_email: email || null,
      ...(sucursal ? { sucursal_id: sucursal.id, stock_resultante_sucursal: resultanteSucursal } : {}),
    });
    if (sucursal) await this.guardarStockSucursal(productoId, sucursal.id, resultanteSucursal);
    await this.guardarStockTotal(productoId, resultanteTotal);

    return {
      movimiento: mov,
      stock: resultanteTotal,
      stock_sucursal: sucursal ? resultanteSucursal : null,
      sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null,
    };
  }

  /* (2026-11-02) Un stock TOTAL que viene de afuera (la sincronización con
     Bsale): se aplica como AJUSTE. Con sucursales, la diferencia cae en la
     principal (Bsale tiene una sola sucursal); si la rebaja supera lo que
     hay ahí, el resto se descuenta de las demás sucursales, de la que más
     tiene a la que menos, dejando un movimiento por cada una. Devuelve
     cuántos movimientos anotó (0 = sin cambio). */
  async aplicarStockExterno(
    productoId: number,
    nuevoTotal: number,
    opts: {
      sku?: string | null;
      motivo: string;
      referencia?: string;
      usuario?: string | null;
      stockActual?: number;
      // Stock por sucursal de Bsale (office id → disponible) y el contexto de
      // la corrida (contextoSincronizacion): con sucursales mapeadas, cada una
      // queda EXACTA con la suya (ver planSincronizacion).
      porOficina?: Record<number, number> | null;
      ctx?: ContextoSync | null;
    },
  ): Promise<{ cambio: boolean; movimientos: number; avisos: string[] }> {
    const client = this.supabase.getClient();
    let actual = Number(opts.stockActual);
    let sku = opts.sku ?? null;
    if (!Number.isFinite(actual)) {
      const { data: prod, error } = await client.from('productos').select('sku, stock').eq('id', productoId).single();
      if (error) throw new BadRequestException(sinMigracion(error.message));
      actual = num(prod?.stock);
      sku = sku ?? (prod?.sku || null);
    }
    const nuevo = Math.max(0, num(nuevoTotal));

    const base = {
      producto_id: productoId,
      sku,
      tipo: 'ajuste',
      motivo: opts.motivo,
      referencia: opts.referencia || null,
      usuario_email: opts.usuario || null,
    };

    // (2026-11-02) Sucursales mapeadas a Bsale: cada una queda con el stock de
    // su sucursal de Bsale (más lo que Bsale no sabe: traslados sin guía). Las
    // no mapeadas no se tocan y el total = Σ sucursales + en tránsito.
    const plan = planSincronizacion(opts.ctx || null, productoId, opts.porOficina || null);
    if (plan) {
      if (!plan.length) return { cambio: false, movimientos: 0, avisos: [] };
      let acumulado = actual;
      for (const parte of plan) {
        acumulado += parte.delta;
        await this.anotar({
          ...base,
          cantidad: parte.delta,
          stock_resultante: acumulado,
          sucursal_id: parte.sucursalId,
          stock_resultante_sucursal: parte.resultante,
        });
        await this.guardarStockSucursal(productoId, parte.sucursalId, parte.resultante);
      }
      await this.guardarStockTotal(productoId, acumulado);
      return { cambio: true, movimientos: plan.length, avisos: [] };
    }

    const delta = nuevo - actual;
    if (delta === 0) return { cambio: false, movimientos: 0, avisos: [] };

    if (!(await this.sucursalesListo())) {
      await this.anotar({ ...base, cantidad: delta, stock_resultante: nuevo });
      await this.guardarStockTotal(productoId, nuevo);
      return { cambio: true, movimientos: 1, avisos: [] };
    }

    const principal = await this.principal();
    if (!principal) throw new BadRequestException('No hay ninguna sucursal definida en el Inventario.');
    const porSucursal = await this.stockPorSucursal(productoId);
    const avisos: string[] = [];
    // Reparto del delta: todo a la principal si alcanza; si no, el resto sale
    // de las otras sucursales (de mayor a menor stock).
    const partes: Array<{ sucursalId: number; nombre: string; delta: number; resultante: number }> = [];
    const enPrincipal = porSucursal.get(principal.id) || 0;
    if (delta > 0 || enPrincipal + delta >= 0) {
      partes.push({ sucursalId: principal.id, nombre: principal.nombre, delta, resultante: enPrincipal + delta });
    } else {
      let pendiente = -delta;
      if (enPrincipal > 0) {
        partes.push({ sucursalId: principal.id, nombre: principal.nombre, delta: -enPrincipal, resultante: 0 });
        pendiente -= enPrincipal;
      }
      const otras = [...porSucursal.entries()]
        .filter(([id, stock]) => id !== principal.id && stock > 0)
        .sort((a, b) => b[1] - a[1]);
      let nombres: Map<number, string> | null = null;
      for (const [id, stock] of otras) {
        if (pendiente <= 0) break;
        const rebaja = Math.min(stock, pendiente);
        if (!nombres) nombres = new Map((await this.listarSucursales()).map((s) => [s.id, s.nombre]));
        partes.push({ sucursalId: id, nombre: nombres.get(id) || `sucursal ${id}`, delta: -rebaja, resultante: stock - rebaja });
        pendiente -= rebaja;
      }
      if (pendiente > 0) {
        // Solo pasa si la rebaja alcanza unidades en tránsito: el total queda
        // igual en Bsale, pero ninguna sucursal las tenía. Queda avisado.
        avisos.push(`${sku || productoId}: ${pendiente} unidad(es) rebajadas por Bsale no estaban en ninguna sucursal (en tránsito).`);
      }
    }

    let acumulado = actual;
    for (const parte of partes) {
      acumulado += parte.delta;
      await this.anotar({
        ...base,
        cantidad: parte.delta,
        stock_resultante: acumulado,
        sucursal_id: parte.sucursalId,
        stock_resultante_sucursal: parte.resultante,
        motivo: parte.sucursalId === principal.id ? opts.motivo : `${opts.motivo} · rebajado de ${parte.nombre}`,
      });
      await this.guardarStockSucursal(productoId, parte.sucursalId, parte.resultante);
    }
    if (acumulado !== nuevo) {
      // El resto no cupo en ninguna sucursal (aviso de arriba): el total manda igual.
      await this.anotar({ ...base, cantidad: nuevo - acumulado, stock_resultante: nuevo, motivo: `${opts.motivo} · sin sucursal (en tránsito)` });
    }
    await this.guardarStockTotal(productoId, nuevo);
    return { cambio: true, movimientos: partes.length + (acumulado !== nuevo ? 1 : 0), avisos };
  }

  async actualizarStockMinimo(productoId: number, stockMinimo: number) {
    const valor = Number(stockMinimo);
    if (!Number.isFinite(valor) || valor < 0) {
      throw new BadRequestException('El stock mínimo debe ser un número mayor o igual a 0.');
    }
    const { error } = await this.supabase
      .getClient()
      .from('productos')
      .update({ stock_minimo: valor })
      .eq('id', productoId);
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return { ok: true, stock_minimo: valor };
  }

  /* Carga masiva (conteo inicial o re-conteo): filas {sku, stock, stock_minimo?}.
     Cada fila con stock distinto al vigente genera un AJUSTE con el motivo
     indicado, así la carga completa queda auditable en el libro. Los SKUs que
     no existen en el catálogo se devuelven sin aplicar.
     (2026-11-02) El conteo es DE UNA SUCURSAL (sucursalId o la principal):
     se compara contra el stock de esa sucursal. */
  async cargaMasiva(rows: Array<Record<string, any>>, email: string, motivo?: string, sucursalId?: number) {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('No llegaron filas.');
    if (rows.length > 10000) throw new BadRequestException('Máximo 10.000 filas por carga.');
    const client = this.supabase.getClient();
    const sucursal = await this.sucursalDelMovimiento(sucursalId);

    const skus = [
      ...new Set(rows.map((r) => String(r?.sku || '').trim().toUpperCase()).filter(Boolean)),
    ];
    const porSku = new Map<string, any>();
    for (let i = 0; i < skus.length; i += 200) {
      const { data, error } = await client
        .from('productos')
        .select('id, sku, stock')
        .in('sku', skus.slice(i, i + 200));
      if (error) throw new BadRequestException(sinMigracion(error.message));
      for (const p of data || []) porSku.set(String(p.sku || '').trim().toUpperCase(), { ...p, vigente: num(p.stock) });
    }
    if (sucursal) {
      // El vigente a comparar es el de la sucursal (0 si nunca tuvo stock ahí).
      const ids = [...porSku.values()].map((p) => Number(p.id));
      for (const p of porSku.values()) p.vigente = 0;
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await client
          .from('inventario_stock_sucursales')
          .select('producto_id, stock')
          .eq('sucursal_id', sucursal.id)
          .in('producto_id', ids.slice(i, i + 500));
        if (error) throw new BadRequestException(sinMigracion(error.message));
        const porId = new Map((data || []).map((r: any) => [Number(r.producto_id), num(r.stock)]));
        for (const p of porSku.values()) if (porId.has(Number(p.id))) p.vigente = porId.get(Number(p.id)) as number;
      }
    }

    const motivoFinal = String(motivo || '').trim() || 'Carga masiva de inventario';
    let aplicadas = 0;
    let sinCambio = 0;
    const noEncontrados: string[] = [];
    const errores: string[] = [];

    for (const row of rows) {
      const sku = String(row?.sku || '').trim().toUpperCase();
      const stockNuevo = Number(row?.stock);
      if (!sku) continue;
      const prod = porSku.get(sku);
      if (!prod) {
        noEncontrados.push(sku);
        continue;
      }
      try {
        // Stock (solo si viene y difiere): ajuste auditado.
        if (Number.isFinite(stockNuevo) && stockNuevo >= 0) {
          if (prod.vigente !== stockNuevo) {
            await this.registrarMovimiento(
              { productoId: prod.id, tipo: 'ajuste', nuevoStock: stockNuevo, motivo: motivoFinal, sucursalId: sucursal?.id },
              email,
            );
            prod.vigente = stockNuevo; // por si el mismo SKU viene repetido
            aplicadas++;
          } else {
            sinCambio++;
          }
        }
        // Stock mínimo (opcional en la misma planilla).
        const minimo = Number(row?.stock_minimo);
        if (Number.isFinite(minimo) && minimo >= 0) {
          await this.actualizarStockMinimo(prod.id, minimo);
        }
      } catch (e: any) {
        errores.push(`${sku}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }

    return {
      aplicadas,
      sin_cambio: sinCambio,
      no_encontrados: noEncontrados,
      errores,
      sucursal: sucursal ? { id: sucursal.id, nombre: sucursal.nombre } : null,
    };
  }

  /* ----------------------------------------------------------------- traslados */

  /* Traslados (del más nuevo al más viejo) con sus líneas y los nombres de
     origen/destino. estado: en_transito | recibido | anulado | (vacío = todos). */
  async traslados(filtros?: { estado?: string; limit?: number }) {
    await this.exigirSucursales();
    const client = this.supabase.getClient();
    const limit = Math.max(1, Math.min(Number(filtros?.limit) || 300, 1000));
    let query = client.from('inventario_traslados').select('*').order('created_at', { ascending: false }).range(0, limit - 1);
    const estado = String(filtros?.estado || '').trim().toLowerCase();
    if (estado) query = query.eq('estado', estado);
    const { data, error } = await query;
    if (error) throw new BadRequestException(sinMigracion(error.message));
    const traslados: any[] = data || [];
    const lineasPor = await this.lineasDe(traslados.map((t) => Number(t.id)));
    const nombres = new Map((await this.listarSucursales()).map((s) => [s.id, s]));
    return traslados.map((t) => this.armarTraslado(t, lineasPor.get(Number(t.id)) || [], nombres));
  }

  async trasladoPorId(id: number) {
    await this.exigirSucursales();
    const { data, error } = await this.supabase.getClient().from('inventario_traslados').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(sinMigracion(error.message));
    if (!data) throw new NotFoundException('Traslado no encontrado.');
    const lineas = (await this.lineasDe([id])).get(id) || [];
    const nombres = new Map((await this.listarSucursales()).map((s) => [s.id, s]));
    return this.armarTraslado(data, lineas, nombres);
  }

  private armarTraslado(t: any, lineas: LineaTraslado[], sucursales: Map<number, Sucursal>) {
    const origen = sucursales.get(Number(t.origen_id));
    const destino = sucursales.get(Number(t.destino_id));
    return {
      ...t,
      origen: { id: Number(t.origen_id), nombre: origen?.nombre || `Sucursal ${t.origen_id}` },
      destino: { id: Number(t.destino_id), nombre: destino?.nombre || `Sucursal ${t.destino_id}` },
      lineas,
      items: lineas.length,
      unidades: lineas.reduce((a, l) => a + num(l.cantidad), 0),
      unidades_recibidas: t.estado === 'recibido' ? lineas.reduce((a, l) => a + num(l.cantidad_recibida), 0) : null,
    };
  }

  private async lineasDe(ids: number[]): Promise<Map<number, LineaTraslado[]>> {
    const out = new Map<number, LineaTraslado[]>();
    if (!ids.length) return out;
    const client = this.supabase.getClient();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await client
        .from('inventario_traslado_lineas')
        .select('*')
        .in('traslado_id', ids.slice(i, i + 200))
        .order('id', { ascending: true });
      if (error) throw new BadRequestException(sinMigracion(error.message));
      for (const l of data || []) {
        const tid = Number(l.traslado_id);
        if (!out.has(tid)) out.set(tid, []);
        out.get(tid)!.push({ ...l, cantidad: num(l.cantidad), cantidad_recibida: l.cantidad_recibida == null ? null : num(l.cantidad_recibida) });
      }
    }
    return out;
  }

  /* Crea un traslado: valida stock en el origen para TODAS las líneas antes de
     escribir nada, y luego saca el stock del origen (queda en tránsito). Con
     `recibirAhora` se recibe de inmediato en el destino (mismo usuario). */
  async crearTraslado(
    body: {
      origenId?: number;
      destinoId?: number;
      lineas?: Array<{ productoId?: number; cantidad?: number }>;
      motivo?: string;
      referencia?: string;
      recibirAhora?: boolean;
    },
    email: string,
  ) {
    await this.exigirSucursales();
    const client = this.supabase.getClient();
    const origenId = Number(body?.origenId);
    const destinoId = Number(body?.destinoId);
    if (!origenId || !destinoId) throw new BadRequestException('Elige la sucursal de origen y la de destino.');
    if (origenId === destinoId) throw new BadRequestException('El origen y el destino tienen que ser sucursales distintas.');
    const origen = await this.sucursalPorId(origenId);
    const destino = await this.sucursalPorId(destinoId);
    if (!origen.activa) throw new BadRequestException(`La sucursal de origen «${origen.nombre}» está inactiva.`);
    if (!destino.activa) throw new BadRequestException(`La sucursal de destino «${destino.nombre}» está inactiva.`);

    // Líneas: se juntan las repetidas y se exige cantidad > 0.
    const pedidas = new Map<number, number>();
    for (const l of Array.isArray(body?.lineas) ? body.lineas : []) {
      const pid = Number(l?.productoId);
      const cant = Number(l?.cantidad);
      if (!pid) continue;
      if (!Number.isFinite(cant) || cant <= 0) throw new BadRequestException('Cada línea necesita una cantidad mayor a 0.');
      pedidas.set(pid, (pedidas.get(pid) || 0) + cant);
    }
    if (!pedidas.size) throw new BadRequestException('Agrega al menos un producto al traslado.');
    if (pedidas.size > 200) throw new BadRequestException('Máximo 200 productos por traslado.');

    const ids = [...pedidas.keys()];
    const productos = new Map<number, any>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await client.from('productos').select('id, sku, nombre, stock').in('id', ids.slice(i, i + 200));
      if (error) throw new BadRequestException(sinMigracion(error.message));
      for (const p of data || []) productos.set(Number(p.id), p);
    }
    const stockOrigen = new Map<number, number>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await client
        .from('inventario_stock_sucursales')
        .select('producto_id, stock')
        .eq('sucursal_id', origen.id)
        .in('producto_id', ids.slice(i, i + 500));
      if (error) throw new BadRequestException(sinMigracion(error.message));
      for (const r of data || []) stockOrigen.set(Number(r.producto_id), num(r.stock));
    }
    const problemas: string[] = [];
    for (const [pid, cant] of pedidas) {
      const p = productos.get(pid);
      if (!p) {
        problemas.push(`producto ${pid}: no existe`);
        continue;
      }
      const hay = stockOrigen.get(pid) || 0;
      if (hay < cant) problemas.push(`${p.sku || p.nombre}: en ${origen.nombre} hay ${hay} y se piden ${cant}`);
    }
    if (problemas.length) {
      throw new BadRequestException(
        `No alcanza el stock en el origen${problemas.length > 5 ? ` (${problemas.length} productos)` : ''}: ${problemas.slice(0, 5).join('; ')}.`,
      );
    }

    const motivo = String(body?.motivo || '').trim() || null;
    const referencia = String(body?.referencia || '').trim() || null;
    const { data: creado, error: errT } = await client
      .from('inventario_traslados')
      .insert([{ origen_id: origen.id, destino_id: destino.id, estado: 'en_transito', motivo, referencia, usuario_email: email || null }])
      .select()
      .single();
    if (errT) throw new BadRequestException(sinMigracion(errT.message));
    const trasladoId = Number(creado.id);

    const filasLineas = ids.map((pid) => {
      const p = productos.get(pid);
      return { traslado_id: trasladoId, producto_id: pid, sku: p?.sku || null, nombre: p?.nombre || null, cantidad: pedidas.get(pid) };
    });
    const { error: errL } = await client.from('inventario_traslado_lineas').insert(filasLineas);
    if (errL) throw new BadRequestException(sinMigracion(errL.message));

    // Sale del origen: el total del producto no cambia (queda en tránsito).
    for (const pid of ids) {
      const p = productos.get(pid);
      const cant = pedidas.get(pid) as number;
      const resultante = (stockOrigen.get(pid) || 0) - cant;
      await this.anotar({
        producto_id: pid,
        sku: p?.sku || null,
        tipo: 'traslado_salida',
        cantidad: cant,
        stock_resultante: num(p?.stock),
        stock_resultante_sucursal: resultante,
        sucursal_id: origen.id,
        traslado_id: trasladoId,
        motivo: motivo || `Traslado #${trasladoId} a ${destino.nombre}`,
        referencia,
        usuario_email: email || null,
      });
      await this.guardarStockSucursal(pid, origen.id, resultante);
    }

    if (body?.recibirAhora) return this.recibirTraslado(trasladoId, {}, email);
    return this.trasladoPorId(trasladoId);
  }

  /* Recibe un traslado en tránsito: entra al destino lo recibido. Si llega
     menos que lo enviado, la diferencia queda como AJUSTE negativo en el
     destino (merma en tránsito) y el total del producto baja. */
  async recibirTraslado(
    id: number,
    body: { lineas?: Array<{ lineaId?: number; productoId?: number; cantidadRecibida?: number }>; nota?: string },
    email: string,
  ) {
    const t = await this.trasladoPorId(id);
    if (t.estado !== 'en_transito') throw new BadRequestException(`El traslado #${id} ya está ${etiquetaEstado(t.estado)}.`);
    const destino = await this.sucursalPorId(t.destino.id);
    if (!destino.activa) throw new BadRequestException(`La sucursal de destino «${destino.nombre}» está inactiva.`);

    const recibidasPorLinea = new Map<number, number>();
    for (const l of Array.isArray(body?.lineas) ? body.lineas : []) {
      const linea = (t.lineas as LineaTraslado[]).find(
        (x) => (l?.lineaId && Number(x.id) === Number(l.lineaId)) || (!l?.lineaId && l?.productoId && Number(x.producto_id) === Number(l.productoId)),
      );
      if (!linea) continue;
      const rec = Number(l?.cantidadRecibida);
      if (!Number.isFinite(rec) || rec < 0) throw new BadRequestException(`Cantidad recibida inválida para ${linea.sku || linea.nombre}.`);
      if (rec > linea.cantidad) {
        throw new BadRequestException(`${linea.sku || linea.nombre}: no se pueden recibir ${rec} si se enviaron ${linea.cantidad}. Si llegó de más, registra una entrada aparte.`);
      }
      recibidasPorLinea.set(Number(linea.id), rec);
    }

    const client = this.supabase.getClient();
    for (const linea of t.lineas as LineaTraslado[]) {
      const recibida = recibidasPorLinea.has(Number(linea.id)) ? (recibidasPorLinea.get(Number(linea.id)) as number) : linea.cantidad;
      const faltante = linea.cantidad - recibida;
      const { data: prod, error } = await client.from('productos').select('id, sku, stock').eq('id', linea.producto_id).single();
      if (error) throw new BadRequestException(sinMigracion(error.message));
      const total = num(prod?.stock);
      const enDestino = await this.stockEnSucursal(linea.producto_id, destino.id);
      const resultanteDestino = enDestino + recibida;
      if (recibida > 0) {
        await this.anotar({
          producto_id: linea.producto_id,
          sku: linea.sku || prod?.sku || null,
          tipo: 'traslado_entrada',
          cantidad: recibida,
          stock_resultante: total,
          stock_resultante_sucursal: resultanteDestino,
          sucursal_id: destino.id,
          traslado_id: id,
          motivo: t.motivo || `Traslado #${id} desde ${t.origen.nombre}`,
          referencia: t.referencia || null,
          usuario_email: email || null,
        });
        await this.guardarStockSucursal(linea.producto_id, destino.id, resultanteDestino);
      }
      if (faltante > 0) {
        await this.anotar({
          producto_id: linea.producto_id,
          sku: linea.sku || prod?.sku || null,
          tipo: 'ajuste',
          cantidad: -faltante,
          stock_resultante: total - faltante,
          stock_resultante_sucursal: resultanteDestino,
          sucursal_id: destino.id,
          traslado_id: id,
          motivo: `Faltante en traslado #${id}: enviadas ${linea.cantidad}, recibidas ${recibida}`,
          referencia: t.referencia || null,
          usuario_email: email || null,
        });
        await this.guardarStockTotal(linea.producto_id, total - faltante);
      }
      const { error: errL } = await client.from('inventario_traslado_lineas').update({ cantidad_recibida: recibida }).eq('id', linea.id);
      if (errL) throw new BadRequestException(sinMigracion(errL.message));
    }

    const { error: errT } = await client
      .from('inventario_traslados')
      .update({
        estado: 'recibido',
        recibido_por: email || null,
        recibido_at: new Date().toISOString(),
        nota_recepcion: String(body?.nota || '').trim() || null,
      })
      .eq('id', id);
    if (errT) throw new BadRequestException(sinMigracion(errT.message));
    return this.trasladoPorId(id);
  }

  /* Anula un traslado en tránsito: el stock vuelve completo al origen. */
  async anularTraslado(id: number, body: { motivo?: string }, email: string) {
    const t = await this.trasladoPorId(id);
    if (t.estado !== 'en_transito') throw new BadRequestException(`El traslado #${id} ya está ${etiquetaEstado(t.estado)}: solo se anulan los que están en tránsito.`);
    const origen = await this.sucursalPorId(t.origen.id);
    const motivo = String(body?.motivo || '').trim() || null;
    const client = this.supabase.getClient();
    for (const linea of t.lineas as LineaTraslado[]) {
      const { data: prod, error } = await client.from('productos').select('id, sku, stock').eq('id', linea.producto_id).single();
      if (error) throw new BadRequestException(sinMigracion(error.message));
      const enOrigen = await this.stockEnSucursal(linea.producto_id, origen.id);
      const resultante = enOrigen + linea.cantidad;
      await this.anotar({
        producto_id: linea.producto_id,
        sku: linea.sku || prod?.sku || null,
        tipo: 'traslado_entrada',
        cantidad: linea.cantidad,
        stock_resultante: num(prod?.stock),
        stock_resultante_sucursal: resultante,
        sucursal_id: origen.id,
        traslado_id: id,
        motivo: `Anulación de traslado #${id}${motivo ? `: ${motivo}` : ''}`,
        referencia: t.referencia || null,
        usuario_email: email || null,
      });
      await this.guardarStockSucursal(linea.producto_id, origen.id, resultante);
    }
    const { error: errT } = await client
      .from('inventario_traslados')
      .update({ estado: 'anulado', anulado_por: email || null, anulado_at: new Date().toISOString(), motivo_anulacion: motivo })
      .eq('id', id);
    if (errT) throw new BadRequestException(sinMigracion(errT.message));
    return this.trasladoPorId(id);
  }

  /* ------------------------------------------------ sincronización con Bsale */

  /* Contexto de UNA corrida de sincronización (3 consultas, una vez por
     corrida): sucursales y su mapeo a Bsale, stock por sucursal, unidades en
     tránsito y la COMPENSACIÓN por sucursal mapeada = lo que Bsale no sabe:
       · traslados SIN guía en Bsale (en tránsito o recibidos): Bsale sigue
         contando esas unidades en el origen → origen −enviadas; destino
         +recibidas.
       · traslados CON guía recibidos acá pero que Bsale aún no recepciona:
         destino +recibidas (hasta que Bsale las marque; bsale_recibido_at).
     Null = sin la migración de sucursales. */
  async contextoSincronizacion(): Promise<ContextoSync | null> {
    if (!(await this.sucursalesListo())) return null;
    const client = this.supabase.getClient();
    const sucursales = await this.listarSucursales();
    const mapeadas = sucursales
      .filter((s) => s.activa && s.bsale_office_id)
      .map((s) => ({ sucursal: s, office: Number(s.bsale_office_id) }));
    const principal = sucursales.find((s) => s.es_principal) || sucursales.find((s) => s.activa) || null;

    const stock = new Map<number, Map<number, number>>();
    const { data: st, error: errSt } = await client
      .from('inventario_stock_sucursales')
      .select('producto_id, sucursal_id, stock')
      .neq('stock', 0)
      .range(0, 50000);
    if (errSt) throw new BadRequestException(sinMigracion(errSt.message));
    for (const r of st || []) {
      const pid = Number(r.producto_id);
      if (!stock.has(pid)) stock.set(pid, new Map());
      stock.get(pid)!.set(Number(r.sucursal_id), num(r.stock));
    }

    const compensacion = new Map<number, Map<number, number>>();
    const enTransito = new Map<number, number>();
    const { data: tr, error: errTr } = await client
      .from('inventario_traslados')
      .select('id, origen_id, destino_id, estado, bsale_id, bsale_recibido_at')
      .in('estado', ['en_transito', 'recibido'])
      .range(0, 20000);
    if (errTr) throw new BadRequestException(sinMigracion(errTr.message));
    const porId = new Map<number, any>((tr || []).map((t: any) => [Number(t.id), t]));
    const esMapeada = new Set(mapeadas.map((m) => m.sucursal.id));
    const sumar = (pid: number, sid: number, n: number) => {
      if (!esMapeada.has(sid) || !n) return;
      if (!compensacion.has(pid)) compensacion.set(pid, new Map());
      const m = compensacion.get(pid)!;
      m.set(sid, (m.get(sid) || 0) + n);
    };
    const lineasPor = await this.lineasDe([...porId.keys()]);
    for (const [tid, lineas] of lineasPor) {
      const t = porId.get(tid);
      if (!t) continue;
      const origen = Number(t.origen_id);
      const destino = Number(t.destino_id);
      const conGuia = !!t.bsale_id;
      for (const l of lineas) {
        const pid = Number(l.producto_id);
        const recibida = l.cantidad_recibida == null ? l.cantidad : num(l.cantidad_recibida);
        if (t.estado === 'en_transito') enTransito.set(pid, (enTransito.get(pid) || 0) + l.cantidad);
        if (!conGuia) {
          sumar(pid, origen, -l.cantidad);
          if (t.estado === 'recibido') sumar(pid, destino, recibida);
        } else if (t.estado === 'recibido' && !t.bsale_recibido_at) {
          sumar(pid, destino, recibida);
        }
      }
    }
    return { sucursales, mapeadas, principal, stock, compensacion, enTransito };
  }

  /* ¿La sincronización tiene algo que escribir para este producto? Con
     sucursales mapeadas y stock por oficina, lo decide el plan; si no, el
     total (comportamiento histórico). */
  requiereCambioSync(ctx: ContextoSync | null, productoId: number, actual: number, nuevoTotal: number, porOficina: Record<number, number> | null): boolean {
    const partes = planSincronizacion(ctx, productoId, porOficina);
    if (partes) return partes.length > 0;
    return Math.max(0, num(nuevoTotal)) !== num(actual);
  }

  /* Traslados con guía en Bsale que aún esperan algo de Bsale: en tránsito
     (¿ya la recepcionaron o anularon allá?) o recibidos acá sin que Bsale los
     marque recibidos todavía. */
  async trasladosConGuiaPendientes() {
    const { data, error } = await this.supabase
      .getClient()
      .from('inventario_traslados')
      .select('id, estado, bsale_id, bsale_recibido_at')
      .not('bsale_id', 'is', null)
      .or('estado.eq.en_transito,and(estado.eq.recibido,bsale_recibido_at.is.null)')
      .range(0, 2000);
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return (data || []) as Array<{ id: number; estado: string; bsale_id: number; bsale_recibido_at: string | null }>;
  }

  /* Lo que Bsale dice de cada guía de traslado pendiente: `received` = 1 →
     se recibe acá (completo, usuario «bsale»); `state` = 1 (anulada) estando
     en tránsito → se anula acá y el stock vuelve al origen. `leer` trae
     /shippings/{id}.json. Nunca lanza por una guía puntual. */
  async sincronizarTrasladosBsale(
    leer: (bsaleId: number) => Promise<any>,
    usuario: string | null,
  ): Promise<{ revisados: number; recibidos: number; anulados: number; cambios: boolean; avisos: string[] }> {
    const out = { revisados: 0, recibidos: 0, anulados: 0, cambios: false, avisos: [] as string[] };
    const pendientes = await this.trasladosConGuiaPendientes();
    const client = this.supabase.getClient();
    for (const t of pendientes) {
      let sh: any;
      try {
        sh = await leer(Number(t.bsale_id));
      } catch (e: any) {
        out.avisos.push(`Traslado #${t.id}: no se pudo leer su guía en Bsale (${String(e?.message || e).slice(0, 80)}).`);
        continue;
      }
      out.revisados += 1;
      try {
        if (t.estado === 'en_transito' && Number(sh?.state) === 1) {
          await this.anularTraslado(Number(t.id), { motivo: 'Guía anulada en Bsale' }, usuario || 'bsale');
          out.anulados += 1;
          out.cambios = true;
          continue;
        }
        if (Number(sh?.received) === 1) {
          if (t.estado === 'en_transito') {
            await this.recibirTraslado(Number(t.id), { nota: 'Recepcionado en Bsale' }, usuario || 'bsale');
            out.recibidos += 1;
            out.cambios = true;
          }
          const { error } = await client
            .from('inventario_traslados')
            .update({ bsale_recibido_at: new Date().toISOString() })
            .eq('id', t.id)
            .is('bsale_recibido_at', null);
          if (error) throw new BadRequestException(sinMigracion(error.message));
          out.cambios = true;
        }
      } catch (e: any) {
        out.avisos.push(`Traslado #${t.id}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    return out;
  }

  /* Deja en el traslado la guía de traslado interno emitida en Bsale. */
  async marcarGuiaBsale(
    trasladoId: number,
    datos: { shippingId: number | null; docId: number | null; numero: string | null; url: string | null; usuario: string | null },
  ) {
    const { error } = await this.supabase
      .getClient()
      .from('inventario_traslados')
      .update({
        bsale_id: datos.shippingId || datos.docId || null,
        bsale_doc_id: datos.docId,
        bsale_numero: datos.numero,
        bsale_url: datos.url,
        bsale_emitido_at: new Date().toISOString(),
        bsale_emitido_por: datos.usuario,
      })
      .eq('id', trasladoId);
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return { ok: true };
  }
}

export type ContextoSync = {
  sucursales: Sucursal[];
  mapeadas: Array<{ sucursal: Sucursal; office: number }>;
  principal: Sucursal | null;
  stock: Map<number, Map<number, number>>; // producto → sucursal → stock (≠ 0)
  compensacion: Map<number, Map<number, number>>; // producto → sucursal mapeada → unidades que Bsale no sabe
  enTransito: Map<number, number>; // producto → unidades en tránsito (todos los traslados)
};

/* Plan de una sincronización para un producto: por cada sucursal mapeada a
   Bsale, el stock que debe quedar = disponible en esa sucursal de Bsale +
   compensación (lo que Bsale no sabe). Null = no aplica (sin contexto, sin
   sucursales mapeadas o sin stock por oficina): se usa el total. */
export function planSincronizacion(
  ctx: ContextoSync | null,
  productoId: number,
  porOficina: Record<number, number> | null,
): Array<{ sucursalId: number; nombre: string; delta: number; resultante: number }> | null {
  if (!ctx || !ctx.mapeadas.length || !porOficina) return null;
  const partes: Array<{ sucursalId: number; nombre: string; delta: number; resultante: number }> = [];
  const stockSuc = ctx.stock.get(productoId);
  const comp = ctx.compensacion.get(productoId);
  for (const { sucursal, office } of ctx.mapeadas) {
    // Bsale puede quedar negativo (sobreventa); el libro no lo permite: se pisa a 0.
    const objetivo = Math.max(0, num(porOficina[office]) + (comp?.get(sucursal.id) || 0));
    const actual = stockSuc?.get(sucursal.id) || 0;
    if (objetivo !== actual) partes.push({ sucursalId: sucursal.id, nombre: sucursal.nombre, delta: objetivo - actual, resultante: objetivo });
  }
  return partes;
}

function normalizarSucursal(s: any): Sucursal {
  return {
    id: Number(s.id),
    nombre: String(s.nombre || ''),
    direccion: s.direccion ?? null,
    comuna: s.comuna ?? null,
    activa: s.activa !== false,
    es_principal: !!s.es_principal,
    bsale_office_id: s.bsale_office_id == null ? null : Number(s.bsale_office_id),
    orden: num(s.orden),
    created_at: s.created_at,
  };
}

function errorSucursal(mensaje: string) {
  if (/duplicate key|inventario_sucursales_nombre_idx/i.test(mensaje)) return 'Ya existe una sucursal con ese nombre.';
  if (/inventario_sucursales_principal_idx/i.test(mensaje)) return 'Ya hay una sucursal principal.';
  return sinMigracion(mensaje);
}

function etiquetaEstado(estado: string) {
  return estado === 'recibido' ? 'recibido' : estado === 'anulado' ? 'anulado' : 'en tránsito';
}
