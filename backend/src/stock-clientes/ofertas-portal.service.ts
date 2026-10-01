import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { hoyEnChile } from '../campanas/campanas-margen.service';
import { firmarImagenesProductos } from './imagenes-productos';

/* ============================================================================
   Ofertas especiales del portal del cliente (2026-10-02)
   ----------------------------------------------------------------------------
   Una oferta es una regla: "a estos productos / estas categorías / estas
   marcas, un X % de descuento sobre el precio del cliente, entre estas
   fechas". Se configura en la plataforma (/ofertas-portal) y el cliente la ve
   en la pestaña «Ofertas» de su portal, con el precio normal tachado y el de
   oferta.

   El precio de oferta NO se guarda: se calcula acá cada vez, desde el precio
   vigente del producto (lista 2, el mismo que muestra el Showroom y con el que
   nace la cotización de un pedido del portal). Y se calcula SIEMPRE en el
   servidor: cuando el pedido llega, cada línea que dice venir de una oferta se
   vuelve a validar y a preciar acá. Lo que manda el navegador no se usa — si
   no, bastaría editar el carrito para inventarse un descuento.

   Si dos ofertas alcanzan al mismo producto, gana la de mayor descuento: es lo
   que el cliente esperaría y evita tener que ordenar las ofertas entre sí.
============================================================================ */

const MIGRACION = 'Falta aplicar la migración 20261002_portal_ofertas.sql en Supabase.';
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ALCANCES = ['producto', 'categoria', 'marca'];
// Bajo este margen (sobre la venta) una cotización queda "Pendiente Aprobación".
const MARGEN_APROBACION = 20;

export interface Oferta {
  id: number;
  nombre: string;
  descripcion: string | null;
  alcance: 'producto' | 'categoria' | 'marca';
  valores: string[];
  descuento_pct: number;
  desde: string;
  hasta: string;
  activa: boolean;
  created_at?: string;
}

const norm = (v: any) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** Precio del cliente del portal: lista 2 y, si no tiene, lista 1 (como el Showroom). */
export function precioClientePortal(prod: any): number {
  return Number(prod?.lista2) || Number(prod?.lista1) || 0;
}

export function precioConDescuento(precio: number, pct: number): number {
  return Math.round(Number(precio || 0) * (1 - Number(pct || 0) / 100));
}

/* ¿La oferta alcanza al producto? Por SKU, categoría o marca según su alcance.
   Sin tildes ni mayúsculas: el catálogo tiene la misma marca escrita de varias
   formas. Una oferta sin valores no alcanza a nada (no existe "todo el
   catálogo en oferta" por descuido). */
export function ofertaAlcanza(prod: any, oferta: Pick<Oferta, 'alcance' | 'valores'>): boolean {
  const valores = (Array.isArray(oferta?.valores) ? oferta.valores : []).map(norm).filter(Boolean);
  if (!valores.length) return false;
  if (oferta.alcance === 'producto') return !!norm(prod?.sku) && valores.includes(norm(prod.sku));
  if (oferta.alcance === 'categoria') return !!norm(prod?.categoria) && valores.includes(norm(prod.categoria));
  if (oferta.alcance === 'marca') return !!norm(prod?.marca) && valores.includes(norm(prod.marca));
  return false;
}

/** La oferta de mayor descuento que alcanza al producto, o null. */
export function mejorOferta<T extends Pick<Oferta, 'alcance' | 'valores' | 'descuento_pct'>>(
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

function estadoDe(o: Oferta, hoy: string): 'vigente' | 'programada' | 'terminada' | 'pausada' {
  if (o.activa === false) return 'pausada';
  if (hoy < String(o.desde).slice(0, 10)) return 'programada';
  if (hoy > String(o.hasta).slice(0, 10)) return 'terminada';
  return 'vigente';
}

@Injectable()
export class OfertasPortalService {
  constructor(private supabase: SupabaseService) {}

  private get client() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    const msg = String(error?.message || '');
    return /portal_ofertas/i.test(msg) && /(schema cache|does not exist|not find)/i.test(msg);
  }

  private error(error: any): never {
    if (this.sinTabla(error)) throw new BadRequestException(MIGRACION);
    throw new BadRequestException(String(error?.message || 'No se pudo guardar la oferta.'));
  }

  // ── Catálogo ────────────────────────────────────────────────────────────

  /* Productos que pueden entrar a una oferta: activos, con SKU (es lo que
     identifica la línea en el pedido) y con precio. En memoria un minuto: la
     vitrina, la simulación y la validación del pedido piden lo mismo. */
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

  private async todas(): Promise<Oferta[]> {
    const { data, error } = await this.client
      .from('portal_ofertas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      if (this.sinTabla(error)) return [];
      throw new BadRequestException(error.message);
    }
    return (data || []) as Oferta[];
  }

  /** Las que rigen hoy. Si algo falla responde vacío: sin ofertas, no sin portal. */
  async vigentes(): Promise<Oferta[]> {
    const hoy = hoyEnChile();
    const { data, error } = await this.client
      .from('portal_ofertas')
      .select('*')
      .eq('activa', true)
      .lte('desde', hoy)
      .gte('hasta', hoy)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data || []) as Oferta[];
  }

  /** Listado para la plataforma: cada oferta con su estado y a cuántos productos alcanza. */
  async listar() {
    const [ofertas, productos] = await Promise.all([this.todas(), this.productos()]);
    const hoy = hoyEnChile();
    return ofertas.map((o) => ({
      ...o,
      estado: estadoDe(o, hoy),
      productos: productos.reduce((acc, p) => acc + (ofertaAlcanza(p, o) ? 1 : 0), 0),
    }));
  }

  private datos(body: any) {
    const nombre = String(body?.nombre || '').trim().slice(0, 120);
    if (!nombre) throw new BadRequestException('La oferta necesita un nombre.');

    const alcance = String(body?.alcance || '').trim();
    if (!ALCANCES.includes(alcance)) {
      throw new BadRequestException('Elige si la oferta es por producto, categoría o marca.');
    }
    const valores = [
      ...new Set<string>(
        (Array.isArray(body?.valores) ? body.valores : [])
          .map((v: any) => String(v ?? '').trim().slice(0, 120))
          .filter(Boolean),
      ),
    ];
    if (!valores.length) {
      const que = alcance === 'producto' ? 'un producto' : alcance === 'categoria' ? 'una categoría' : 'una marca';
      throw new BadRequestException(`Elige al menos ${que} para la oferta.`);
    }

    const pct = Number(body?.descuento_pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      throw new BadRequestException('El descuento debe ser mayor que 0 y menor que 100 %.');
    }

    const desde = String(body?.desde || '').slice(0, 10);
    const hasta = String(body?.hasta || '').slice(0, 10);
    if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta)) {
      throw new BadRequestException('Indica las fechas de inicio y término.');
    }
    if (hasta < desde) throw new BadRequestException('La fecha de término no puede ser anterior al inicio.');

    return {
      nombre,
      descripcion: String(body?.descripcion || '').trim().slice(0, 300) || null,
      alcance,
      valores,
      descuento_pct: Math.round(pct * 100) / 100,
      desde,
      hasta,
      activa: body?.activa !== false,
    };
  }

  async crear(body: any, creadorEmail?: string | null) {
    const { data, error } = await this.client
      .from('portal_ofertas')
      .insert({ ...this.datos(body), creado_por: creadorEmail || null })
      .select()
      .single();
    if (error) this.error(error);
    return data;
  }

  async actualizar(id: number, body: any) {
    const { data, error } = await this.client
      .from('portal_ofertas')
      .update({ ...this.datos(body), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Oferta no encontrada.');
    return data;
  }

  async activar(id: number, activa: boolean) {
    const { data, error } = await this.client
      .from('portal_ofertas')
      .update({ activa, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Oferta no encontrada.');
    return data;
  }

  async eliminar(id: number) {
    const { error } = await this.client.from('portal_ofertas').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ── Simulación (para quien configura la oferta) ─────────────────────────

  /* Qué le hace una regla al catálogo, antes de guardarla: a cuántos productos
     alcanza, cuánto bajan y —lo que importa para no regalar plata— cuántos
     quedan bajo el costo o bajo el margen que obliga a aprobar la cotización. */
  async simular(body: any) {
    const alcance = String(body?.alcance || '').trim();
    const valores = Array.isArray(body?.valores) ? body.valores : [];
    const pct = Number(body?.descuento_pct);
    if (!ALCANCES.includes(alcance) || !valores.length || !Number.isFinite(pct) || pct <= 0 || pct >= 100) {
      return { total: 0, bajo_costo: 0, margen_bajo: 0, ejemplos: [] };
    }
    const regla = { alcance: alcance as Oferta['alcance'], valores };
    const filas = (await this.productos())
      .filter((p) => ofertaAlcanza(p, regla))
      .map((p) => {
        const normal = precioClientePortal(p);
        const oferta = precioConDescuento(normal, pct);
        const costo = Number(p.costo) || 0;
        const margen = costo > 0 && oferta > 0 ? ((oferta - costo) / oferta) * 100 : null;
        return {
          sku: p.sku,
          nombre: p.nombre,
          marca: p.marca || null,
          costo,
          precio_normal: normal,
          precio_oferta: oferta,
          margen_pct: margen === null ? null : Math.round(margen * 10) / 10,
        };
      });
    const bajoCosto = filas.filter((f) => f.costo > 0 && f.precio_oferta < f.costo);
    const margenBajo = filas.filter((f) => f.margen_pct !== null && f.margen_pct < MARGEN_APROBACION);
    // Los ejemplos parten por los que quedan peor parados: es lo que hay que mirar.
    const ejemplos = [...filas]
      .sort((a, b) => (a.margen_pct ?? 999) - (b.margen_pct ?? 999))
      .slice(0, 6);
    return {
      total: filas.length,
      bajo_costo: bajoCosto.length,
      margen_bajo: margenBajo.length,
      ejemplos,
    };
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
         con el precio de oferta calculado ACÁ y la marca `oferta`;
       · si no (venció, se pausó, el producto ya no está), pierde la marca y
         queda con el precio normal del producto.
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
