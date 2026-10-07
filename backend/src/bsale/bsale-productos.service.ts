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
   `BSALE_PRODUCTOS=off` lo apaga.

   (2026-10-07) Pedido de Ariel: "si hay un transitorio sin SKU, se debe enviar
   a Bsale; si un producto se crea completo en Amsodent, se debe enviar a
   Bsale". En Bsale el código (SKU) de la variante es OPCIONAL
   (docs.bsale.dev/variantes), así que:
     · Sin SKU: si ya tiene variante anotada, nada. Si en Bsale hay un producto
       con el MISMO nombre (exacto, sin tildes ni mayúsculas; el filtro `name`
       de Bsale es parcial), se enlaza a él. Si no, se crea producto y
       variante sin código, con sus precios.
     · Con SKU y una variante ya anotada (fue transitorio): se le pone el SKU a
       ESA variante (PUT /variants/{id}.json) y se relee para confirmar; no se
       crea otro producto. Si Bsale no lo toma, se avisa para hacerlo a mano.
   Los pendientes (sin variante anotada) se envían en lote desde Productos. */

const LISTAS: { lista: number; nombre: string; campo: string }[] = [
  { lista: 2, nombre: 'WEB-PARTICULAR', campo: 'lista1' },
  { lista: 3, nombre: 'PRECIO MP', campo: 'lista2' },
];
const TIPO_SIN_TIPO = 1;

export type ResultadoBsale = {
  estado: 'creado' | 'ya_existia' | 'enlazado' | 'sku_asignado' | 'sin_sku' | 'apagada' | 'error';
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
    if (!this.activa) return { estado: 'apagada', mensaje: 'El envío de productos a Bsale está apagado en el servidor.' };
    const ahora = new Date().toISOString();
    const varianteAnotada = Number(producto?.bsale_variant_id) || null;
    let productoBsaleId: number | null = null;
    try {
      if (sku) {
        const existente = await this.facturacion.apiGet(`/variants.json?code=${encodeURIComponent(sku)}&expand=[product]`);
        const v = existente?.items?.[0];
        if (v) {
          const res: ResultadoBsale = { estado: 'ya_existia', variante_id: Number(v.id) || null, producto_id: Number(v.product?.id) || null, nombre_bsale: String(v.product?.name || '').trim() };
          if (varianteAnotada && varianteAnotada !== res.variante_id) {
            res.avisos = [`Este producto estaba enlazado a la variante ${varianteAnotada} (sin SKU) y el SKU ${sku} ya existe en la variante ${res.variante_id}: quedó enlazado a esta; revisa la otra en Bsale.`];
          }
          await this.anotar(id, { bsale_variant_id: res.variante_id, bsale_product_id: res.producto_id, bsale_sync_at: ahora, bsale_sync_error: null });
          return res;
        }
        // Fue transitorio y ya está en Bsale sin código: se le pone el SKU a esa variante.
        if (varianteAnotada) return await this.ponerSku(producto, varianteAnotada, sku, ahora);
      } else {
        if (varianteAnotada) {
          return { estado: 'ya_existia', variante_id: varianteAnotada, producto_id: Number(producto?.bsale_product_id) || null, mensaje: 'Ya está en Bsale (sin SKU).' };
        }
        const igual = await this.buscarPorNombre(producto?.nombre);
        if (igual) {
          await this.anotar(id, { bsale_variant_id: igual.variante_id, bsale_product_id: igual.producto_id, bsale_sync_at: ahora, bsale_sync_error: null });
          this.logger.log(`Producto #${id} sin SKU enlazado al producto ${igual.producto_id} de Bsale (mismo nombre)${opts.motivo ? ` · ${opts.motivo}` : ''}`);
          return { estado: 'enlazado', ...igual };
        }
      }

      const tipo = await this.tipoPara(producto.categoria);
      const nombre = String(producto.nombre || '').trim().slice(0, 150) || sku || `Producto ${id}`;
      const descripcion = [producto.marca, producto.formato].map((x) => String(x || '').trim()).filter(Boolean).join(' · ').slice(0, 200);
      const prod = await this.facturacion.apiPost('/products.json', {
        name: nombre, description: descripcion, classification: 0, ledgerAccount: '', costCenter: '',
        allowDecimal: 0, stockControl: 1, printDetailPack: 0, productTypeId: tipo.id,
      });
      productoBsaleId = Number(prod?.id) || null;
      if (!productoBsaleId) throw new Error('Bsale no devolvió el id del producto creado.');

      const variante = await this.facturacion.apiPost('/variants.json', {
        productId: productoBsaleId, description: String(producto.formato || '').trim().slice(0, 80),
        unlimitedStock: 0, allowNegativeStock: 1, ...(sku ? { code: sku } : {}),
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
      this.logger.log(`Producto ${sku || `#${id} (sin SKU)`} creado en Bsale (producto ${productoBsaleId}, variante ${varianteId}, tipo ${tipo.nombre}${precios.length ? `, precios en ${precios.map((p) => p.nombre).join(' y ')}` : ''})${opts.motivo ? ` · ${opts.motivo}` : ''}`);
      return { estado: 'creado', variante_id: varianteId, producto_id: productoBsaleId, tipo_producto: tipo.nombre, precios, avisos };
    } catch (e: any) {
      const detalle = String(e?.message || e).slice(0, 300);
      const mensaje = productoBsaleId ? `${detalle} (el producto ${productoBsaleId} quedó creado en Bsale sin variante: revísalo allá)` : detalle;
      await this.anotar(id, { bsale_sync_error: mensaje.slice(0, 500), bsale_sync_at: ahora });
      this.logger.warn(`Producto ${sku || `#${id} (sin SKU)`} no se pudo enviar a Bsale: ${mensaje}`);
      return { estado: 'error', mensaje };
    }
  }

  /* Producto de Bsale con el mismo nombre (exacto, sin tildes ni mayúsculas).
     El filtro `name` de Bsale busca por parte del nombre: se compara acá. */
  private async buscarPorNombre(nombreSistema: any): Promise<{ variante_id: number; producto_id: number; nombre_bsale: string } | null> {
    const nombre = String(nombreSistema || '').trim();
    if (nombre.length < 4) return null;
    const r = await this.facturacion.apiGet(`/products.json?name=${encodeURIComponent(nombre.slice(0, 150))}&limit=25&state=0`);
    const igual = (r?.items || []).find((p: any) => sinAcentos(p?.name) === sinAcentos(nombre));
    if (!igual?.id) return null;
    const vars = await this.facturacion.apiGet(`/variants.json?productid=${Number(igual.id)}&state=0`);
    const v = (vars?.items || [])[0];
    if (!v?.id) return null;
    return { variante_id: Number(v.id), producto_id: Number(igual.id), nombre_bsale: String(igual.name || '').trim() };
  }

  /* La variante se creó sin código (era transitorio): se le pone el SKU y se
     relee para confirmar que Bsale lo tomó. */
  private async ponerSku(producto: Record<string, any>, varianteId: number, sku: string, ahora: string): Promise<ResultadoBsale> {
    const id = Number(producto?.id) || null;
    const actual = await this.facturacion.apiGet(`/variants/${varianteId}.json?expand=[product]`);
    if (!actual?.id) {
      // La variante ya no está: se olvida y se crea de nuevo con el SKU.
      return this.sincronizar({ ...producto, bsale_variant_id: null, bsale_product_id: null }, { motivo: `la variante ${varianteId} ya no existe en Bsale` });
    }
    const productId = Number(actual?.product?.id || producto?.bsale_product_id) || null;
    await this.facturacion.apiEnviar('PUT', `/variants/${varianteId}.json`, { id: varianteId, productId, description: actual.description ?? '', code: sku });
    const releida = await this.facturacion.apiGet(`/variants/${varianteId}.json`);
    if (normSku(releida?.code) === sku) {
      await this.anotar(id, { bsale_variant_id: varianteId, bsale_product_id: productId, bsale_sync_at: ahora, bsale_sync_error: null });
      this.logger.log(`SKU ${sku} puesto a la variante ${varianteId} de Bsale (producto #${id}, antes transitorio)`);
      return { estado: 'sku_asignado', variante_id: varianteId, producto_id: productId, mensaje: `Se le puso el SKU ${sku} a la variante que ya estaba en Bsale.` };
    }
    const mensaje = `La variante ${varianteId} está en Bsale sin SKU y Bsale no tomó el código ${sku}: ponlo a mano en Bsale.`;
    await this.anotar(id, { bsale_sync_error: mensaje, bsale_sync_at: ahora });
    return { estado: 'error', mensaje, variante_id: varianteId, producto_id: productId };
  }

  /* ── Pendientes: productos que aún no están en Bsale (2026-10-07) ──
     Sin variante anotada y no inactivos. Primero los sin SKU (transitorios),
     después los con SKU (que en general ya están allá: solo se anota su id).
     Se envían de a uno, en segundo plano; el estado se consulta aparte. */
  private lote: { corriendo: boolean; total: number; hechos: number; resumen: Record<string, number>; inicio: string; fin: string | null; ultimo_error: string | null; usuario: string | null } | null = null;

  async listarPendientes(): Promise<any[]> {
    const db = this.supabase.getClient();
    const out: any[] = [];
    for (let desde = 0; desde < 50000; desde += 1000) {
      const { data, error } = await db
        .from('productos')
        .select('id, sku, nombre, marca, formato, categoria, estado, lista1, lista2, bsale_variant_id, bsale_product_id, bsale_sync_error')
        .is('bsale_variant_id', null)
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) throw new Error(/bsale_/.test(error.message) ? 'Falta aplicar la migración 20261006_productos_bsale.' : error.message);
      out.push(...(data || []).filter((p: any) => String(p.estado || '') !== 'Inactivo'));
      if (!data || data.length < 1000) break;
    }
    return out.sort((a, b) => Number(!!normSku(a.sku)) - Number(!!normSku(b.sku)) || a.id - b.id);
  }

  async enviarPendientes(opts: { simular?: boolean; usuario?: string | null; tope?: number; soloSinSku?: boolean } = {}) {
    if (this.lote?.corriendo) return { ya_corriendo: true, estado: this.lote };
    const todos = await this.listarPendientes();
    const sinSku = todos.filter((p) => !normSku(p.sku)).length;
    // «Solo sin SKU»: los transitorios; los con SKU en general ya están en Bsale y solo se enlazan.
    const pendientes = opts.soloSinSku ? todos.filter((p) => !normSku(p.sku)) : todos;
    const resumenPrevio = { total: pendientes.length, sin_sku: sinSku, con_sku: todos.length - sinSku, solo_sin_sku: !!opts.soloSinSku, con_error_previo: pendientes.filter((p) => p.bsale_sync_error).length };
    if (opts.simular || !pendientes.length) {
      return { simulacion: !!opts.simular, activa: this.activa, ...resumenPrevio, muestra: pendientes.slice(0, 8).map((p) => ({ id: p.id, sku: p.sku || null, nombre: p.nombre, estado: p.estado })) };
    }
    if (!this.activa) return { activa: false, ...resumenPrevio, mensaje: 'El envío de productos a Bsale está apagado en el servidor.' };
    const tope = Math.max(1, Math.min(Number(opts.tope) || pendientes.length, 5000));
    const lista = pendientes.slice(0, tope);
    this.lote = { corriendo: true, total: lista.length, hechos: 0, resumen: { creados: 0, enlazados: 0, ya_existian: 0, sku_asignados: 0, errores: 0, omitidos: 0 }, inicio: new Date().toISOString(), fin: null, ultimo_error: null, usuario: opts.usuario || null };
    const lote = this.lote;
    void (async () => {
      for (const p of lista) {
        try {
          const r = await this.sincronizar(p, { motivo: 'envío de pendientes' });
          const k = r.estado === 'creado' ? 'creados' : r.estado === 'enlazado' ? 'enlazados' : r.estado === 'ya_existia' ? 'ya_existian' : r.estado === 'sku_asignado' ? 'sku_asignados' : r.estado === 'error' ? 'errores' : 'omitidos';
          lote.resumen[k]++;
          if (r.estado === 'error') lote.ultimo_error = `#${p.id} ${String(p.nombre || '').slice(0, 40)}: ${String(r.mensaje || '').slice(0, 160)}`;
        } catch (e: any) {
          lote.resumen.errores++;
          lote.ultimo_error = `#${p.id}: ${String(e?.message || e).slice(0, 160)}`;
        }
        lote.hechos++;
      }
      lote.corriendo = false;
      lote.fin = new Date().toISOString();
      this.logger.log(`Pendientes a Bsale: ${JSON.stringify(lote.resumen)} (${lote.total} productos, por ${lote.usuario})`);
    })();
    return { iniciado: true, ...resumenPrevio, estado: this.lote };
  }

  estadoPendientes() {
    return { estado: this.lote, activa: this.activa };
  }

  /* Varios productos, uno tras otro (la API de Bsale corta las llamadas
     simultáneas). Para las cargas masivas, en segundo plano. */
  async sincronizarVarios(productos: Record<string, any>[], opts: { motivo?: string; tope?: number } = {}) {
    const tope = Math.max(1, Math.min(Number(opts.tope) || 300, 1000));
    const resumen = { total: 0, creados: 0, ya_existian: 0, errores: 0, omitidos: 0 };
    for (const p of productos.slice(0, tope)) {
      resumen.total++;
      const r = await this.sincronizar(p, opts);
      if (r.estado === 'creado' || r.estado === 'sku_asignado') resumen.creados++;
      else if (r.estado === 'ya_existia' || r.estado === 'enlazado') resumen.ya_existian++;
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
