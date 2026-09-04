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
  // Avance de la corrida en curso, para la barra de progreso del módulo
  // Inventario (la corrida completa toma varios minutos por el volumen de
  // páginas de Bsale). null = no hay sincronización corriendo.
  private progreso: { fase: 'catalogo' | 'stocks' | 'aplicando'; hechas: number; total: number; actualizados: number } | null = null;

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
      progreso: this.progreso,
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

  /* GET a la API de Bsale con el token. Errores con cuerpo legible.
     Reintenta 429 (rate limit) y 5xx con espera creciente, porque la corrida
     hace miles de llamadas y un tropiezo puntual no debe botarla entera. */
  private async apiGet(path: string, reintentos = 4): Promise<any> {
    for (let intento = 0; ; intento++) {
      const res = await fetchConTimeout(`${this.base}/v1${path}`, {
        headers: { access_token: this.token, Accept: 'application/json' },
      });
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && intento < reintentos) {
        // 429 = rate limit (visto en la primera corrida real): respetar
        // Retry-After si viene, si no backoff exponencial 2s/4s/8s/16s.
        const retryAfterS = Number(res.headers.get('retry-after')) || 0;
        const espera = Math.max(retryAfterS * 1000, 2000 * 2 ** intento);
        await new Promise((r) => setTimeout(r, Math.min(espera, 60000)));
        continue;
      }
      const cuerpo = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`Bsale ${res.status} en ${path}: ${cuerpo || res.statusText}`);
    }
  }

  /* Baja un recurso paginado completo (items de todas las páginas).
     La primera página entrega `count`; el resto se pide en tandas. */
  private async paginado(
    recurso: string,
    extraQs = '',
    onAvance?: (paginasHechas: number, paginasTotal: number) => void,
  ): Promise<any[]> {
    const qs = (offset: number) => `${recurso}?limit=${LIMITE_PAGINA}&offset=${offset}${extraQs}`;
    const primera = await this.apiGet(qs(0));
    const items: any[] = [...(primera?.items || [])];
    const total = Number(primera?.count || items.length);
    const paginasTotal = Math.max(1, Math.ceil(total / LIMITE_PAGINA));
    let paginasHechas = 1;
    onAvance?.(paginasHechas, paginasTotal);
    const offsets: number[] = [];
    for (let off = LIMITE_PAGINA; off < total; off += LIMITE_PAGINA) offsets.push(off);
    for (let i = 0; i < offsets.length; i += CONCURRENCIA) {
      const tanda = offsets.slice(i, i + CONCURRENCIA);
      const paginas = await Promise.all(tanda.map((off) => this.apiGet(qs(off))));
      for (const p of paginas) items.push(...(p?.items || []));
      paginasHechas += tanda.length;
      onAvance?.(paginasHechas, paginasTotal);
    }
    return items;
  }

  /* Venta total emitida en Bsale en un rango de fechas (comparativo del
     Panel de Indicadores): NETO de facturas (SII 33/34) + boletas (39/41)
     menos notas de crédito (61). Fechas YYYY-MM-DD; los documentos anulados
     (state=1) no cuentan. */
  async ventas(desde: string, hasta: string) {
    if (!this.token) return { disponible: false, motivo: 'Falta BSALE_ACCESS_TOKEN en el backend.' };
    const d1 = Date.parse(`${desde}T00:00:00Z`) / 1000;
    const d2 = Date.parse(`${hasta}T23:59:59Z`) / 1000;
    if (!Number.isFinite(d1) || !Number.isFinite(d2) || d2 < d1) {
      throw new BadRequestException('Rango de fechas inválido (se espera YYYY-MM-DD).');
    }
    const rango = `emissiondaterange=[${Math.floor(d1)},${Math.floor(d2)}]`;
    const sumar = async (codes: number[]) => {
      let neto = 0;
      let docs = 0;
      for (const code of codes) {
        const filas = await this.paginado('/documents.json', `&codesii=${code}&${rango}`);
        for (const f of filas) {
          if (Number(f?.state) === 1) continue; // anulado
          neto += Number(f?.netAmount || 0);
          docs += 1;
        }
      }
      return { neto, docs };
    };
    const ventas = await sumar([33, 34, 39, 41]); // facturas afectas/exentas + boletas
    const nc = await sumar([61]); // notas de crédito
    return {
      disponible: true,
      desde,
      hasta,
      ventas_neto: Math.round(ventas.neto),
      notas_credito_neto: Math.round(nc.neto),
      neto: Math.round(ventas.neto - nc.neto),
      documentos: ventas.docs,
      notas_credito: nc.docs,
    };
  }

  /* Guía de despacho electrónica emitida en Bsale, buscada por NÚMERO
     (codeSii 52): ítems despachados y referencias del documento — para que
     Trazabilidad muestre QUÉ productos salieron con cada guía y cruce la
     referencia contra la OC de la cotización (pedido 2026-09-04). */
  async guiaDespacho(numero: string) {
    if (!this.token) return { disponible: false, motivo: 'Falta BSALE_ACCESS_TOKEN en el backend.' };
    const num = String(numero || '').replace(/\D/g, '');
    if (!num) throw new BadRequestException('Número de guía inválido.');
    const r = await this.apiGet(`/documents.json?codesii=52&number=${num}&expand=[details,references]&limit=10`);
    const candidatos: any[] = r?.items || [];
    const doc = candidatos.find((d: any) => Number(d?.state) !== 1) || candidatos[0];
    if (!doc) return { disponible: true, encontrado: false, numero: num };
    const detalles: any[] = doc?.details?.items || doc?.details || [];
    const referencias: any[] = doc?.references?.items || doc?.references || [];
    return {
      disponible: true,
      encontrado: true,
      numero: doc?.number ?? num,
      emitida: doc?.emissionDate ? new Date(Number(doc.emissionDate) * 1000).toISOString().slice(0, 10) : null,
      neto: Number(doc?.netAmount || 0),
      total: Number(doc?.totalAmount || 0),
      anulada: Number(doc?.state) === 1,
      url_pdf: doc?.urlPdf || doc?.urlPublicView || null,
      items: (Array.isArray(detalles) ? detalles : []).map((d: any) => ({
        sku: String(d?.variant?.code || '').trim(),
        producto: String(d?.variant?.description || '').trim(),
        cantidad: Number(d?.quantity || 0),
        precio_neto: Number(d?.netUnitValue || 0),
        total_neto: Number(d?.netAmount ?? (Number(d?.quantity || 0) * Number(d?.netUnitValue || 0))) || 0,
      })),
      referencias: (Array.isArray(referencias) ? referencias : []).map((x: any) => ({
        numero: String(x?.number ?? '').trim(),
        razon: String(x?.reason ?? '').trim(),
        fecha: x?.referenceDate != null ? String(x.referenceDate) : null,
      })),
    };
  }

  /* Arranque no bloqueante de la sincronización: valida, dispara en segundo
     plano y responde al tiro. El avance se sigue por GET /bsale/estado
     (campo `progreso`) — así el navegador no queda colgado de un request de
     varios minutos (que un proxy puede cortar) y la corrida sobrevive aunque
     el usuario cierre la pestaña. */
  iniciar(opts?: { usuario?: string }) {
    if (!this.token) {
      throw new BadRequestException(
        'Falta configurar BSALE_ACCESS_TOKEN en el backend. El token se genera en Bsale: Configuración → Integraciones → API.',
      );
    }
    if (this.sincronizando) {
      throw new BadRequestException('Ya hay una sincronización con Bsale en curso.');
    }
    void this.sincronizar(opts).catch(() => undefined); // el error ya queda en el log y en bsale_estado no se pisa nada
    return { iniciado: true };
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
    this.progreso = { fase: 'catalogo', hechas: 0, total: 0, actualizados: 0 };
    const inicio = Date.now();
    try {
      const client = this.supabase.getClient();

      // 1. Variantes: el SKU interno vive en `code`.
      const variantes = await this.paginado('/variants.json', '', (h, t) => {
        this.progreso = { fase: 'catalogo', hechas: h, total: t, actualizados: 0 };
      });
      const skuPorVariante = new Map<number, string>();
      const descPorSku = new Map<string, string>();
      for (const v of variantes) {
        const sku = normSku(v?.code);
        const id = Number(v?.id);
        if (!id || !sku) continue;
        skuPorVariante.set(id, sku);
        if (!descPorSku.has(sku)) descPorSku.set(sku, String(v?.description || '').trim());
      }

      // 2. Catálogo interno primero, para consultarle a Bsale solo lo que existe acá.
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

      // 3. Variantes que interesan: bajar /stocks.json completo (cientos de
      //    miles de filas) toma HORAS porque la paginación por offset de
      //    Bsale se degrada con la profundidad (~7 s por página al fondo).
      //    En cambio, el stock de una variante puntual responde en <1 s, así
      //    que se consulta SOLO las variantes cuyo `code` calza con un SKU
      //    interno.
      const skusBsale = new Set<string>(skuPorVariante.values());
      const skusInternosSet = new Set<string>();
      for (const p of productos || []) {
        const sku = normSku(p?.sku);
        if (sku) skusInternosSet.add(sku);
      }
      const variantesMatcheadas: Array<{ vid: number; sku: string }> = [];
      for (const [vid, sku] of skuPorVariante) {
        if (skusInternosSet.has(sku)) variantesMatcheadas.push({ vid, sku });
      }

      // 4. Stock disponible por SKU (sumando sucursales, y variantes que
      //    comparten code). Prefijado en 0 para todo SKU matcheado: existir
      //    en Bsale sin stock también es match (stock real = 0).
      //    DOS estrategias, según lo que salga más barato en llamadas:
      //    - Cuenta chica (pocas sucursales, ej. Amsodent: ~4.600 filas =
      //      ~93 páginas): paginar /stocks.json completo. Ir por variante acá
      //      serían ~4.700 llamadas y REVIENTA el rate limit de Bsale (429,
      //      visto en la primera corrida real).
      //    - Cuenta gigante (el paginado completo se va a horas por el offset
      //      profundo): consultar solo las variantes matcheadas.
      const stockPorSku = new Map<string, number>();
      for (const { sku } of variantesMatcheadas) if (!stockPorSku.has(sku)) stockPorSku.set(sku, 0);
      const primeraStocks = await this.apiGet(`/stocks.json?limit=${LIMITE_PAGINA}&offset=0`);
      const paginasStock = Math.max(1, Math.ceil(Number(primeraStocks?.count || 0) / LIMITE_PAGINA));

      if (paginasStock <= Math.max(50, variantesMatcheadas.length / 2)) {
        this.progreso = { fase: 'stocks', hechas: 0, total: paginasStock, actualizados: 0 };
        const filas = await this.paginado('/stocks.json', '', (h, t) => {
          this.progreso = { fase: 'stocks', hechas: h, total: t, actualizados: 0 };
        });
        for (const s of filas) {
          const vid = Number(s?.variant?.id);
          const sku = vid ? skuPorVariante.get(vid) : undefined;
          if (!sku || !stockPorSku.has(sku)) continue;
          const disp = Number(s?.quantityAvailable);
          if (Number.isFinite(disp)) stockPorSku.set(sku, (stockPorSku.get(sku) || 0) + disp);
        }
      } else {
        this.progreso = { fase: 'stocks', hechas: 0, total: variantesMatcheadas.length, actualizados: 0 };
        const CONC_STOCK = 4; // suave con el rate limit
        for (let i = 0; i < variantesMatcheadas.length; i += CONC_STOCK) {
          const tanda = variantesMatcheadas.slice(i, i + CONC_STOCK);
          await Promise.all(tanda.map(async ({ vid, sku }) => {
            const r = await this.apiGet(`/stocks.json?variantid=${vid}&limit=${LIMITE_PAGINA}`);
            for (const s of r?.items || []) {
              const disp = Number(s?.quantityAvailable);
              if (Number.isFinite(disp)) stockPorSku.set(sku, (stockPorSku.get(sku) || 0) + disp);
            }
          }));
          this.progreso = {
            fase: 'stocks',
            hechas: Math.min(i + CONC_STOCK, variantesMatcheadas.length),
            total: variantesMatcheadas.length,
            actualizados: 0,
          };
        }
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
      for (const sku of skusBsale) {
        if (skusInternos.has(sku)) continue;
        if (skusBsaleSinProducto.length < MAX_DETALLE) {
          skusBsaleSinProducto.push({ sku, descripcion: descPorSku.get(sku) || '' });
        }
      }
      let totalSkusBsaleSinProducto = 0;
      for (const sku of skusBsale) if (!skusInternos.has(sku)) totalSkusBsaleSinProducto += 1;
      let totalProductosSinBsale = 0;
      for (const p of productos || []) {
        const sku = normSku(p?.sku);
        if (sku && !stockPorSku.has(sku)) totalProductosSinBsale += 1;
      }

      // 6. Aplicar: productos.stock + movimiento 'ajuste' por cada cambio.
      let actualizados = 0;
      const errores: string[] = [];
      const TANDA = 8;
      this.progreso = { fase: 'aplicando', hechas: 0, total: cambios.length, actualizados: 0 };
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
        this.progreso = {
          fase: 'aplicando',
          hechas: Math.min(i + TANDA, cambios.length),
          total: cambios.length,
          actualizados,
        };
      }

      const resumen = {
        corrido_at: new Date().toISOString(),
        duracion_s: Math.round((Date.now() - inicio) / 1000),
        variantes_bsale: variantes.length,
        variantes_con_sku: skuPorVariante.size,
        skus_bsale: skusBsale.size,
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
      this.progreso = null;
    }
  }
}
