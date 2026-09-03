import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Integración con Bsale — etapa 1: catálogo y stock (pedido 2026-09-04)
   ----------------------------------------------------------------------------
   Amsodent factura con Bsale, así que Bsale es la FUENTE DE VERDAD del stock.
   Esta etapa sincroniza en una dirección (Bsale → sistema):

   1. Baja las VARIANTES (el SKU vive en `code`) y los STOCKS (disponible por
      sucursal) de la API v1 de Bsale, paginando de a 50 (su tope).
   2. Cruza por SKU contra `productos` y, donde el stock difiere, actualiza
      productos.stock dejando el cambio como 'ajuste' en
      inventario_movimientos — el mismo libro auditable que usa un conteo
      físico del módulo Inventario, con motivo "Sincronización Bsale".
   3. Reporta las diferencias de CATÁLOGO sin tocar nada: SKUs que existen en
      Bsale pero no en el sistema, y productos internos sin SKU en Bsale.
      Crear productos automáticamente queda para una etapa posterior (el
      catálogo interno tiene freno anti-duplicados y campos obligatorios que
      Bsale no trae).

   El resultado queda en `bsale_estado` (fila única) para que el módulo
   Inventario muestre la última corrida sin re-consultar la API.

   Config (.env):
     BSALE_ACCESS_TOKEN  → token de la API (Bsale: Configuración → Integraciones).
     BSALE_URL           → opcional, default https://api.bsale.io (p. ej. el
                           ambiente de prueba de Bsale).
============================================================================ */

const LIMITE_PAGINA = 50; // tope de la API de Bsale
const CONCURRENCIA = 4; // páginas en paralelo (la API es estable pero no la saturamos)
const MAX_DETALLE = 500; // tope de filas por lista en el reporte de diferencias

function normSku(raw: unknown): string {
  return String(raw || '').trim().toUpperCase();
}

async function fetchConTimeout(url: string, init: any = {}, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

@Injectable()
export class BsaleService {
  private readonly logger = new Logger(BsaleService.name);
  private sincronizando = false;

  constructor(private supabase: SupabaseService) {}

  private get token(): string {
    return (process.env.BSALE_ACCESS_TOKEN || '').trim();
  }

  private get base(): string {
    return (process.env.BSALE_URL || 'https://api.bsale.io').replace(/\/+$/, '');
  }

  async estado() {
    const { data } = await this.supabase
      .getClient()
      .from('bsale_estado')
      .select('actualizado_at, resumen')
      .eq('id', 1)
      .maybeSingle();
    return {
      token_configurado: !!this.token,
      sincronizando: this.sincronizando,
      ultima: data || null,
    };
  }

  // Diferencias de catálogo de la última corrida (listas completas, acotadas).
  async diferencias() {
    const { data, error } = await this.supabase
      .getClient()
      .from('bsale_estado')
      .select('actualizado_at, detalle')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260904_bsale_estado.sql en Supabase.'
          : error.message,
      );
    }
    return data || { actualizado_at: null, detalle: null };
  }

  /* GET a la API de Bsale con el token. Errores con cuerpo legible. */
  private async apiGet(path: string): Promise<any> {
    const res = await fetchConTimeout(`${this.base}/v1${path}`, {
      headers: { access_token: this.token, Accept: 'application/json' },
    });
    if (!res.ok) {
      const cuerpo = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Bsale ${res.status} en ${path}: ${cuerpo || res.statusText}`);
    }
    return res.json();
  }

  /* Baja un recurso paginado completo (items de todas las páginas).
     La primera página entrega `count`; el resto se pide en tandas. */
  private async paginado(recurso: string, extraQs = ''): Promise<any[]> {
    const qs = (offset: number) => `${recurso}?limit=${LIMITE_PAGINA}&offset=${offset}${extraQs}`;
    const primera = await this.apiGet(qs(0));
    const items: any[] = [...(primera?.items || [])];
    const total = Number(primera?.count || items.length);
    const offsets: number[] = [];
    for (let off = LIMITE_PAGINA; off < total; off += LIMITE_PAGINA) offsets.push(off);
    for (let i = 0; i < offsets.length; i += CONCURRENCIA) {
      const tanda = offsets.slice(i, i + CONCURRENCIA);
      const paginas = await Promise.all(tanda.map((off) => this.apiGet(qs(off))));
      for (const p of paginas) items.push(...(p?.items || []));
    }
    return items;
  }

  /* Sincronización de stock Bsale → productos.stock (+ libro de movimientos). */
  async sincronizar(opts?: { usuario?: string }) {
    if (!this.token) {
      throw new BadRequestException(
        'Falta configurar BSALE_ACCESS_TOKEN en el backend. El token se genera en Bsale: Configuración → Integraciones → API.',
      );
    }
    if (this.sincronizando) {
      throw new BadRequestException('Ya hay una sincronización con Bsale en curso.');
    }
    this.sincronizando = true;
    const inicio = Date.now();
    try {
      const client = this.supabase.getClient();

      // 1. Variantes: el SKU interno vive en `code`.
      const variantes = await this.paginado('/variants.json');
      const skuPorVariante = new Map<number, string>();
      const descPorSku = new Map<string, string>();
      for (const v of variantes) {
        const sku = normSku(v?.code);
        const id = Number(v?.id);
        if (!id || !sku) continue;
        skuPorVariante.set(id, sku);
        if (!descPorSku.has(sku)) descPorSku.set(sku, String(v?.description || '').trim());
      }

      // 2. Stocks: disponible por variante (sumando sucursales).
      const stocks = await this.paginado('/stocks.json');
      const disponiblePorVariante = new Map<number, number>();
      for (const s of stocks) {
        const vid = Number(s?.variant?.id);
        if (!vid) continue;
        const disp = Number(s?.quantityAvailable);
        if (!Number.isFinite(disp)) continue;
        disponiblePorVariante.set(vid, (disponiblePorVariante.get(vid) || 0) + disp);
      }

      // 3. Stock disponible por SKU (varias variantes con el mismo code se suman).
      const stockPorSku = new Map<string, number>();
      for (const [vid, sku] of skuPorVariante) {
        const disp = disponiblePorVariante.get(vid) || 0;
        stockPorSku.set(sku, (stockPorSku.get(sku) || 0) + disp);
      }

      // 4. Catálogo interno.
      const { data: productos, error: errProd } = await client
        .from('productos')
        .select('id, sku, nombre, stock')
        .range(0, 20000);
      if (errProd) {
        throw new BadRequestException(
          /stock.*does not exist|does not exist.*stock|schema cache/i.test(errProd.message)
            ? 'Falta aplicar la migración 20260827_inventario.sql (columna productos.stock).'
            : errProd.message,
        );
      }

      // 5. Cruce por SKU y ajustes de stock (solo donde difiere).
      const skusInternos = new Set<string>();
      const cambios: Array<{ id: number; sku: string; actual: number; nuevo: number }> = [];
      const productosSinBsale: Array<{ sku: string; nombre: string }> = [];
      let matcheados = 0;
      for (const p of productos || []) {
        const sku = normSku(p?.sku);
        if (!sku) continue;
        skusInternos.add(sku);
        if (!stockPorSku.has(sku)) {
          if (productosSinBsale.length < MAX_DETALLE) {
            productosSinBsale.push({ sku, nombre: String(p?.nombre || '') });
          }
          continue;
        }
        matcheados += 1;
        const actual = Number(p?.stock || 0);
        // Bsale puede quedar negativo (sobreventa); el libro interno no lo
        // permite, así que se piso a 0 y la diferencia queda a la vista allá.
        const nuevo = Math.max(0, Number(stockPorSku.get(sku) || 0));
        if (nuevo !== actual) cambios.push({ id: Number(p.id), sku, actual, nuevo });
      }
      const skusBsaleSinProducto: Array<{ sku: string; descripcion: string }> = [];
      for (const [sku] of stockPorSku) {
        if (skusInternos.has(sku)) continue;
        if (skusBsaleSinProducto.length < MAX_DETALLE) {
          skusBsaleSinProducto.push({ sku, descripcion: descPorSku.get(sku) || '' });
        }
      }
      let totalSkusBsaleSinProducto = 0;
      for (const [sku] of stockPorSku) if (!skusInternos.has(sku)) totalSkusBsaleSinProducto += 1;
      let totalProductosSinBsale = 0;
      for (const p of productos || []) {
        const sku = normSku(p?.sku);
        if (sku && !stockPorSku.has(sku)) totalProductosSinBsale += 1;
      }

      // 6. Aplicar: productos.stock + movimiento 'ajuste' por cada cambio.
      let actualizados = 0;
      const errores: string[] = [];
      const TANDA = 8;
      for (let i = 0; i < cambios.length; i += TANDA) {
        const tanda = cambios.slice(i, i + TANDA);
        await Promise.all(tanda.map(async (c) => {
          const { error: errUp } = await client
            .from('productos')
            .update({ stock: c.nuevo })
            .eq('id', c.id);
          if (errUp) {
            errores.push(`${c.sku}: ${errUp.message.slice(0, 120)}`);
            return;
          }
          const { error: errMov } = await client.from('inventario_movimientos').insert([{
            producto_id: c.id,
            sku: c.sku,
            tipo: 'ajuste',
            cantidad: c.nuevo - c.actual,
            stock_resultante: c.nuevo,
            motivo: 'Sincronización Bsale',
            referencia: 'bsale',
            usuario_email: opts?.usuario || null,
          }]);
          if (errMov) errores.push(`${c.sku} (movimiento): ${errMov.message.slice(0, 120)}`);
          actualizados += 1;
        }));
      }

      const resumen = {
        corrido_at: new Date().toISOString(),
        duracion_s: Math.round((Date.now() - inicio) / 1000),
        variantes_bsale: variantes.length,
        variantes_con_sku: skuPorVariante.size,
        skus_bsale: stockPorSku.size,
        productos_internos: (productos || []).length,
        matcheados,
        actualizados,
        sin_cambio: matcheados - cambios.length,
        skus_bsale_sin_producto: totalSkusBsaleSinProducto,
        productos_sin_bsale: totalProductosSinBsale,
        errores: errores.slice(0, 20),
      };

      const { error: errEstado } = await client.from('bsale_estado').upsert([{
        id: 1,
        actualizado_at: new Date().toISOString(),
        resumen,
        detalle: {
          skus_bsale_sin_producto: skusBsaleSinProducto,
          productos_sin_bsale: productosSinBsale,
        },
      }]);
      if (errEstado && !/does not exist|schema cache/i.test(errEstado.message)) {
        this.logger.warn(`No se pudo guardar bsale_estado: ${errEstado.message}`);
      }

      this.logger.log(
        `Bsale sincronizado en ${resumen.duracion_s}s: ${matcheados} matcheados, ` +
        `${actualizados} stocks actualizados, ${totalSkusBsaleSinProducto} SKUs de Bsale sin producto interno.`,
      );
      return resumen;
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.logger.error(`Sincronización Bsale falló: ${msg}`);
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`No se pudo sincronizar con Bsale: ${msg.slice(0, 300)}`);
    } finally {
      this.sincronizando = false;
    }
  }
}
