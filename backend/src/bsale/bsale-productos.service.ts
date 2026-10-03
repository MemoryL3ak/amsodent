import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BsaleFacturacionService } from './bsale-facturacion.service';

/* ── Productos del sistema → Bsale (2026-10-03) ──────────────────────────────
   Pedido de Ariel: "cuando se asigne un SKU a un producto o se cree un producto
   nuevo con SKU, se envíe a Bsale". Bsale es quien emite los documentos, y un
   SKU que no existe allá no se puede vender ni despachar.

   Qué se hace por cada producto con SKU:
     1. Se busca la variante con ese código. Si ya existe, solo se anota su id.
     2. Si no, se crea el PRODUCTO (nombre, tipo de producto = la categoría del
        sistema, que coincide con los tipos de la cuenta) y su VARIANTE con el
        SKU como código.
     3. Se ponen los precios NETOS en las listas de Bsale: WEB-PARTICULAR (2)
        recibe la lista 1 del sistema y PRECIO MP (3) la lista 2 (así están los
        productos actuales, p. ej. IME00053: 25.126 / 22.269 en ambos lados).
        Bsale no permite crear la fila de precio: ya existe para toda variante
        y solo se edita (PUT).
   El IVA (impuesto 1) está marcado "para todos los productos" en la cuenta,
   así que un producto nuevo lo recibe solo; igual se verifica.
   Nunca frena el guardado del producto: si Bsale falla, el producto queda en
   el sistema y el resultado se devuelve para mostrarlo (y se anota en
   productos.bsale_sync_error cuando la migración 20261006 está aplicada).
   `BSALE_PRODUCTOS=off` lo apaga. */

const LISTAS: { lista: number; nombre: string; campo: string }[] = [
  { lista: 2, nombre: 'WEB-PARTICULAR', campo: 'lista1' },
  { lista: 3, nombre: 'PRECIO MP', campo: 'lista2' },
];
const TIPO_SIN_TIPO = 1;

export type ResultadoBsale = {
  estado: 'creado' | 'ya_existia' | 'sin_sku' | 'apagada' | 'error';
  mensaje?: string;
  variante_id?: number | null;
  producto_id?: number | null;
  nombre_bsale?: string;
  tipo_producto?: string;
  precios?: { lista: number; nombre: string; neto: number }[];
  avisos?: string[];
};

const normSku = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const sinAcentos = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

@Injectable()
export class BsaleProductosService {
  private readonly logger = new Logger(BsaleProductosService.name);
  private tiposCache: { en: number; tipos: { id: number; nombre: string }[] } | null = null;

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
  ) {}

  get activa(): boolean {
    return String(process.env.BSALE_PRODUCTOS || 'on').toLowerCase() !== 'off' && !!process.env.BSALE_ACCESS_TOKEN;
  }

  /* Tipos de producto de la cuenta (= categorías), una hora en caché. */
  async tiposProducto(): Promise<{ id: number; nombre: string }[]> {
    if (this.tiposCache && Date.now() - this.tiposCache.en < 60 * 60 * 1000) return this.tiposCache.tipos;
    const items: any[] = await this.facturacion.todos('/product_types.json', '&state=0');
    const tipos = items.map((t) => ({ id: Number(t.id), nombre: String(t.name || '').trim() })).filter((t) => t.id > 0);
    this.tiposCache = { en: Date.now(), tipos };
    return tipos;
  }

  /* La categoría del sistema → tipo de producto de Bsale (mismo nombre sin
     acentos: "Cirugía" ↔ "Cirugia"). Si no calza, "Sin Tipo". */
  async tipoPara(categoria: any): Promise<{ id: number; nombre: string }> {
    const tipos = await this.tiposProducto();
    const buscado = sinAcentos(categoria);
    return (
      (buscado && tipos.find((t) => sinAcentos(t.nombre) === buscado)) ||
      tipos.find((t) => t.id === TIPO_SIN_TIPO) ||
      tipos[0] || { id: TIPO_SIN_TIPO, nombre: 'Sin Tipo' }
    );
  }

  async sincronizar(producto: Record<string, any>, opts: { motivo?: string } = {}): Promise<ResultadoBsale> {
    const sku = normSku(producto?.sku);
    const id = Number(producto?.id) || null;
    if (!sku) return { estado: 'sin_sku' };
    if (!this.activa) return { estado: 'apagada', mensaje: 'El envío de productos a Bsale está apagado en el servidor.' };
    const ahora = new Date().toISOString();
    let productoBsaleId: number | null = null;
    try {
      const existente = await this.facturacion.apiGet(`/variants.json?code=${encodeURIComponent(sku)}&expand=[product]`);
      const v = existente?.items?.[0];
      if (v) {
        const res: ResultadoBsale = { estado: 'ya_existia', variante_id: Number(v.id) || null, producto_id: Number(v.product?.id) || null, nombre_bsale: String(v.product?.name || '').trim() };
        await this.anotar(id, { bsale_variant_id: res.variante_id, bsale_product_id: res.producto_id, bsale_sync_at: ahora, bsale_sync_error: null });
        return res;
      }

      const tipo = await this.tipoPara(producto.categoria);
      const nombre = String(producto.nombre || '').trim().slice(0, 150) || sku;
      const descripcion = [producto.marca, producto.formato].map((x) => String(x || '').trim()).filter(Boolean).join(' · ').slice(0, 200);
      const prod = await this.facturacion.apiPost('/products.json', {
        name: nombre, description: descripcion, classification: 0, ledgerAccount: '', costCenter: '',
        allowDecimal: 0, stockControl: 1, printDetailPack: 0, productTypeId: tipo.id,
      });
      productoBsaleId = Number(prod?.id) || null;
      if (!productoBsaleId) throw new Error('Bsale no devolvió el id del producto creado.');

      const variante = await this.facturacion.apiPost('/variants.json', {
        productId: productoBsaleId, description: String(producto.formato || '').trim().slice(0, 80),
        unlimitedStock: 0, allowNegativeStock: 1, code: sku,
      });
      const varianteId = Number(variante?.id) || null;
      if (!varianteId) throw new Error(`Bsale creó el producto ${productoBsaleId} pero no devolvió la variante.`);

      const precios: ResultadoBsale['precios'] = [];
      const avisos: string[] = [];
      for (const l of LISTAS) {
        const neto = Math.round(Number(producto[l.campo]) || 0);
        if (!(neto > 0)) continue;
        try {
          const det = await this.facturacion.apiGet(`/price_lists/${l.lista}/details.json?variantid=${varianteId}`);
          const d = det?.items?.[0];
          if (!d?.id) {
            avisos.push(`La lista ${l.nombre} no tiene fila para la variante nueva: pon el precio a mano en Bsale.`);
            continue;
          }
          await this.facturacion.apiEnviar('PUT', `/price_lists/${l.lista}/details/${Number(d.id)}.json`, { variantValue: neto });
          precios.push({ lista: l.lista, nombre: l.nombre, neto });
        } catch (e: any) {
          avisos.push(`No se pudo poner el precio en la lista ${l.nombre}: ${String(e?.message || e).slice(0, 120)}`);
        }
      }
      try {
        const t = await this.facturacion.apiGet(`/products/${productoBsaleId}/product_taxes.json`);
        if (!(t?.items || []).length) avisos.push('El producto quedó sin IVA asociado en Bsale: revísalo antes de venderlo.');
      } catch { /* solo una verificación */ }

      await this.anotar(id, { bsale_variant_id: varianteId, bsale_product_id: productoBsaleId, bsale_sync_at: ahora, bsale_sync_error: null });
      this.logger.log(`Producto ${sku} creado en Bsale (producto ${productoBsaleId}, variante ${varianteId}, tipo ${tipo.nombre}${precios.length ? `, precios en ${precios.map((p) => p.nombre).join(' y ')}` : ''})${opts.motivo ? ` · ${opts.motivo}` : ''}`);
      return { estado: 'creado', variante_id: varianteId, producto_id: productoBsaleId, tipo_producto: tipo.nombre, precios, avisos };
    } catch (e: any) {
      const detalle = String(e?.message || e).slice(0, 300);
      const mensaje = productoBsaleId ? `${detalle} (el producto ${productoBsaleId} quedó creado en Bsale sin variante: revísalo allá)` : detalle;
      await this.anotar(id, { bsale_sync_error: mensaje.slice(0, 500), bsale_sync_at: ahora });
      this.logger.warn(`Producto ${sku} no se pudo enviar a Bsale: ${mensaje}`);
      return { estado: 'error', mensaje };
    }
  }

  /* Varios productos, uno tras otro (la API de Bsale corta las llamadas
     simultáneas). Para las cargas masivas, en segundo plano. */
  async sincronizarVarios(productos: Record<string, any>[], opts: { motivo?: string; tope?: number } = {}) {
    const tope = Math.max(1, Math.min(Number(opts.tope) || 300, 1000));
    const resumen = { total: 0, creados: 0, ya_existian: 0, errores: 0, omitidos: 0 };
    for (const p of productos.slice(0, tope)) {
      resumen.total++;
      const r = await this.sincronizar(p, opts);
      if (r.estado === 'creado') resumen.creados++;
      else if (r.estado === 'ya_existia') resumen.ya_existian++;
      else if (r.estado === 'error') resumen.errores++;
      else resumen.omitidos++;
    }
    if (productos.length > tope) resumen.omitidos += productos.length - tope;
    return resumen;
  }

  /* Deja en el producto qué variante es en Bsale (o el error). Si la
     migración 20261006 no está aplicada, no pasa nada. */
  private async anotar(productoId: number | null, campos: Record<string, any>) {
    if (!productoId) return;
    try {
      const { error } = await this.supabase.getClient().from('productos').update(campos).eq('id', productoId);
      if (error && !(/bsale_/.test(String(error.message)) && /column|schema cache/i.test(String(error.message)))) {
        this.logger.warn(`No se pudo anotar la sincronización con Bsale en el producto ${productoId}: ${error.message}`);
      }
    } catch (e: any) {
      this.logger.warn(`No se pudo anotar la sincronización con Bsale en el producto ${productoId}: ${e?.message || e}`);
    }
  }
}
