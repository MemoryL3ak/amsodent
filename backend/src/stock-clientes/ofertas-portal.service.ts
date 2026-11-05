import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CampanasMargenService } from '../campanas/campanas-margen.service';
import { firmarImagenesProductos } from './imagenes-productos';

/* ============================================================================
   Ofertas del portal del cliente (2026-10-02)
   ----------------------------------------------------------------------------
   Lo que el cliente ve en la pestaña «Ofertas» de su portal: productos con el
   precio normal tachado y el de oferta.

   (2026-11-05) Las ofertas ya no tienen su propio módulo ni su propia tabla
   (pedido de Ariel: "la campaña de portal Amsodent y portal cliente se deben
   gestionar desde el único módulo campaña de margen"). Una oferta del portal
   es ahora una CAMPAÑA DE MARGEN cuyo canal es `portal` o `ambos`
   (CampanasMargenService.vigentes('portal')): mismas reglas de alcance
   (marcas, categorías, SKUs y desmarcados), misma vigencia y mismo cupo de
   unidades — una campaña agotada deja de salir en el portal. La tabla
   `portal_ofertas` quedó como historia (la migración 20261105 copia sus
   ofertas a campañas).

   El precio de oferta NO se guarda: se calcula acá cada vez, desde el precio
   vigente del producto para el cliente del portal (lista 2 y, si no tiene,
   lista 1: el mismo que muestra el Showroom y con el que nace la cotización
   de un pedido del portal). Y se calcula SIEMPRE en el servidor: cuando el
   pedido llega, cada línea que dice venir de una oferta se vuelve a validar y
   a preciar acá. Lo que manda el navegador no se usa — si no, bastaría editar
   el carrito para inventarse un descuento.

   Si dos campañas alcanzan al mismo producto, gana la de mayor descuento: es
   lo que el cliente esperaría.
============================================================================ */

export interface Oferta {
  id: number;
  nombre: string;
  descripcion: string | null;
  descuento_pct: number;
  desde: string;
  hasta: string;
  marcas: string[];
  categorias: string[];
  skus: string[];
  skus_excluidos: string[];
  /* Resumen del alcance para mostrarlo: por producto, categoría, marca, varios
     criterios a la vez o todo el catálogo. */
  alcance: 'producto' | 'categoria' | 'marca' | 'mixto' | 'catalogo';
}

const norm = (v: any) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const normSku = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const lista = (v: any): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);

/** Precio del cliente del portal: lista 2 y, si no tiene, lista 1 (como el Showroom). */
export function precioClientePortal(prod: any): number {
  return Number(prod?.lista2) || Number(prod?.lista1) || 0;
}

export function precioConDescuento(precio: number, pct: number): number {
  return Math.round(Number(precio || 0) * (1 - Number(pct || 0) / 100));
}

/* ¿La oferta alcanza al producto? La misma regla que las campañas de margen al
   cotizar (src/lib/campanasMargen.js → campanaAlcanza): el producto necesita
   SKU; marcas, categorías y SKUs vacíos significan «todos»; con más de un
   filtro debe cumplirlos todos; y lo desmarcado queda fuera. Sin tildes ni
   mayúsculas: el catálogo tiene la misma marca escrita de varias formas. */
export function ofertaAlcanza(prod: any, oferta: Pick<Oferta, 'marcas' | 'categorias' | 'skus' | 'skus_excluidos'>): boolean {
  const sku = normSku(prod?.sku);
  if (!sku) return false;
  const skus = lista(oferta?.skus);
  if (skus.length && !skus.some((s) => normSku(s) === sku)) return false;
  if (lista(oferta?.skus_excluidos).some((s) => normSku(s) === sku)) return false;
  const marcas = lista(oferta?.marcas);
  if (marcas.length && !marcas.some((m) => norm(m) === norm(prod?.marca))) return false;
  const categorias = lista(oferta?.categorias);
  if (categorias.length && !categorias.some((c) => norm(c) === norm(prod?.categoria))) return false;
  return true;
}

/** La oferta de mayor descuento que alcanza al producto, o null. */
export function mejorOferta<T extends Pick<Oferta, 'marcas' | 'categorias' | 'skus' | 'skus_excluidos' | 'descuento_pct'>>(
  prod: any,
  ofertas: T[],
): T | null {
  let mejor: T | null = null;
  for (const o of ofertas || []) {
    if (!ofertaAlcanza(prod, o)) continue;
    if (!mejor || Number(o.descuento_pct) > Number(mejor.descuento_pct)) mejor = o;
  }
  return mejor;
}

/* Campaña de margen → oferta del portal. */
export function ofertaDeCampana(c: any): Oferta {
  const marcas = lista(c?.marcas);
  const categorias = lista(c?.categorias);
  const skus = lista(c?.skus);
  const criterios = [skus.length > 0, categorias.length > 0, marcas.length > 0].filter(Boolean).length;
  return {
    id: Number(c.id),
    nombre: String(c.nombre || ''),
    descripcion: c.descripcion ?? null,
    descuento_pct: Number(c.margen_pct) || 0,
    desde: String(c.desde || '').slice(0, 10),
    hasta: String(c.hasta || '').slice(0, 10),
    marcas,
    categorias,
    skus,
    skus_excluidos: lista(c?.skus_excluidos),
    alcance: criterios === 0 ? 'catalogo' : criterios > 1 ? 'mixto' : skus.length ? 'producto' : categorias.length ? 'categoria' : 'marca',
  };
}

@Injectable()
export class OfertasPortalService {
  constructor(
    private supabase: SupabaseService,
    private campanas: CampanasMargenService,
  ) {}

  private get client() {
    return this.supabase.getClient();
  }

  // ── Catálogo ────────────────────────────────────────────────────────────

  /* Productos que pueden entrar a una oferta: activos, con SKU (es lo que
     identifica la línea en el pedido) y con precio. En memoria un minuto: la
     vitrina y la validación del pedido piden lo mismo. */
  private catalogo: { ts: number; filas: any[] } | null = null;

  private async productos(): Promise<any[]> {
    if (this.catalogo && Date.now() - this.catalogo.ts < 60_000) return this.catalogo.filas;
    const filas: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await this.client
        .from('productos')
        .select('id, sku, nombre, marca, categoria, formato, imagen_url, costo, lista1, lista2, stock, estado')
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      filas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const utiles = filas.filter(
      (p) =>
        String(p.estado || '').toLowerCase() !== 'inactivo' &&
        String(p.sku || '').trim() &&
        String(p.nombre || '').trim() &&
        precioClientePortal(p) > 0,
    );
    this.catalogo = { ts: Date.now(), filas: utiles };
    return utiles;
  }

  // ── Reglas ──────────────────────────────────────────────────────────────

  /* Las que rigen hoy en el portal: campañas de margen activas, en su
     vigencia, con cupo disponible y de canal `portal` o `ambos`. Solo las que
     de verdad descuentan. Si algo falla responde vacío: sin ofertas, no sin
     portal. */
  async vigentes(): Promise<Oferta[]> {
    try {
      const campanas = await this.campanas.vigentes('portal');
      return campanas.map(ofertaDeCampana).filter((o) => o.descuento_pct > 0);
    } catch {
      return [];
    }
  }

  // ── Vitrina del portal ──────────────────────────────────────────────────

  /* Lo que ve el cliente: las ofertas vigentes y los productos en oferta, cada
     producto una sola vez (con su mejor descuento). */
  async vitrina() {
    const ofertas = await this.vigentes();
    if (!ofertas.length) return { ofertas: [], items: [], total: 0 };
    const productos = await this.productos();

    const filas: any[] = [];
    const porOferta = new Map<number, number>();
    for (const p of productos) {
      const o = mejorOferta(p, ofertas);
      if (!o) continue;
      const normal = precioClientePortal(p);
      const precio = precioConDescuento(normal, o.descuento_pct);
      if (!(precio > 0) || precio >= normal) continue;
      porOferta.set(o.id, (porOferta.get(o.id) || 0) + 1);
      filas.push({
        id: p.id,
        sku: String(p.sku).trim(),
        nombre: p.nombre,
        marca: p.marca || null,
        categoria: p.categoria || null,
        formato: p.formato || null,
        imagen: p.imagen_url || null,
        precio_normal: normal,
        precio_oferta: precio,
        ahorro: normal - precio,
        descuento_pct: Number(o.descuento_pct),
        oferta_id: o.id,
        oferta_nombre: o.nombre,
        hasta: String(o.hasta).slice(0, 10),
        stock: Number(p.stock) || 0,
      });
    }

    const urls = await firmarImagenesProductos(this.client, filas.map((f) => f.imagen));
    for (const f of filas) f.imagen = f.imagen ? urls.get(String(f.imagen).trim()) || null : null;

    // Primero lo que más descuento tiene; a igual descuento, por nombre.
    filas.sort((a, b) => b.descuento_pct - a.descuento_pct || String(a.nombre).localeCompare(String(b.nombre), 'es'));

    return {
      ofertas: ofertas
        .filter((o) => porOferta.get(o.id))
        .map((o) => ({
          id: o.id,
          nombre: o.nombre,
          descripcion: o.descripcion,
          alcance: o.alcance,
          descuento_pct: Number(o.descuento_pct),
          hasta: String(o.hasta).slice(0, 10),
          productos: porOferta.get(o.id) || 0,
        })),
      items: filas,
      total: filas.length,
    };
  }

  // ── SKU de las líneas de Gestión de Stock ───────────────────────────────

  /* Las líneas que salen del inventario que el cliente declara traen el código
     que ÉL le puso al producto, que puede ser el SKU de Amsodent o un código
     propio. Solo se conserva como SKU cuando existe en nuestro catálogo Y el
     nombre corresponde; si no, se descarta — un código ajeno que coincidiera
     por casualidad con un SKU nuestro haría que la cotización naciera con
     otro producto. Las líneas que vienen de una tienda (explorador, showroom,
     ofertas) no se tocan: su SKU ya es el nuestro. */
  async depurarSkusDeInventario<T extends Record<string, any>>(items: T[]): Promise<T[]> {
    const esDeInventario = (it: any) => it?.sku && !it?.tienda && !it?.url;
    if (!items.some(esDeInventario)) return items;
    let productos: any[] = [];
    try {
      productos = await this.productos();
    } catch {
      /* sin catálogo no se puede confirmar ninguno: se descartan */
    }
    const porSku = new Map(productos.map((p) => [norm(p.sku), p]));
    const limpio = (v: any) => norm(v).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return items.map((it) => {
      if (!esDeInventario(it)) return it;
      const prod = porSku.get(norm(it.sku));
      const a = limpio(it.nombre);
      const b = limpio(prod?.nombre);
      const corresponde =
        !!prod && !!a && !!b && (a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))));
      if (corresponde) return { ...it, sku: String(prod.sku).trim() };
      const { sku: _ajeno, ...sinSku } = it as any;
      return sinSku as T;
    });
  }

  // ── Validación del pedido ───────────────────────────────────────────────

  /* Recibe las líneas de un pedido del portal y vuelve a preciar las que dicen
     venir de una oferta (`oferta_id` + `sku`):
       · si hay una oferta vigente que alcanza a ese producto, la línea queda
         con el precio de oferta calculado ACÁ y la marca `oferta` (su `id` es
         el de la campaña: con él la venta suma al cupo cuando la cotización
         del pedido se adjudica);
       · si no (venció, se pausó, se agotó, el producto ya no está), pierde la
         marca y queda con el precio normal del producto.
     En ningún caso se usa el precio que mandó el navegador. Best-effort: si el
     catálogo no se puede leer, las líneas quedan sin oferta. */
  async aplicarAItems<T extends Record<string, any>>(items: T[]): Promise<T[]> {
    if (!items.some((it) => it?.oferta_id)) return items;
    let ofertas: Oferta[] = [];
    let productos: any[] = [];
    try {
      [ofertas, productos] = await Promise.all([this.vigentes(), this.productos()]);
    } catch {
      /* sin catálogo: se cae al camino sin oferta */
    }
    const porSku = new Map(productos.map((p) => [norm(p.sku), p]));
    return items.map((it) => {
      if (!it?.oferta_id) return it;
      const { oferta_id: _descartado, ...resto } = it as any;
      const prod = porSku.get(norm(it.sku));
      if (!prod) {
        // No se reconoce el producto: sin precio que se pueda sostener.
        const { precio_referencia: _p, ...sinPrecio } = resto;
        return sinPrecio as T;
      }
      const normal = precioClientePortal(prod);
      const o = mejorOferta(prod, ofertas);
      if (!o) return { ...resto, precio_referencia: normal } as T;
      return {
        ...resto,
        precio_referencia: precioConDescuento(normal, o.descuento_pct),
        precio_normal: normal,
        oferta: { id: o.id, nombre: o.nombre, descuento_pct: Number(o.descuento_pct) },
      } as T;
    });
  }
}
