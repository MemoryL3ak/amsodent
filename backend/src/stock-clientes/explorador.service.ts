import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ── Explorador de precios dentales del portal de clientes (2026-09-04) ──
   Estilo Knasta/SoloTodo: el cliente busca una palabra clave y el backend
   consulta EN VIVO las tiendas dentales chilenas con API pública de búsqueda
   (Shopify: /search/suggest.json · WooCommerce: Store API /wc/store/v1 ·
   Odoo: microdatos schema.org de /shop),
   normaliza los resultados y guarda una captura diaria por producto en
   `explorador_precios` para construir el histórico (mínimo registrado y
   variación contra la captura anterior).

   Cortesía con las tiendas: 1 petición por tienda por búsqueda, timeout de
   8 s, User-Agent identificable y caché en memoria de 10 minutos por
   consulta (búsquedas repetidas no vuelven a golpear los sitios). */

type Tienda = { id: string; nombre: string; tipo: 'shopify' | 'woo' | 'odoo' | 'amsodent'; base: string; region?: string | null };
// Región sin tildes ni mayúsculas, para comparar lo que escribe cada tabla ("Metropolitana de Santiago" = "metropolitana de santiago").
const normRegion = (v: any) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^region\s+/, '').replace(/\s+/g, ' ').trim();

// Fallback si la tabla explorador_tiendas aún no existe (migración pendiente)
// o quedó vacía. Desde el 2026-09-10 la lista viva se administra en el
// mantenedor de la plataforma (tabla explorador_tiendas).
const TIENDAS_FALLBACK: Tienda[] = [
  // La tienda propia va SIEMPRE primera en los resultados (ver orden en buscar()).
  { id: 'amsodent', nombre: 'Amsodent', tipo: 'amsodent', base: 'https://amsodentmedical.cl' },
  { id: 'orbisdental', nombre: 'Orbis Dental', tipo: 'shopify', base: 'https://www.orbisdental.cl' },
  { id: 'gexachile', nombre: 'Gexa Chile', tipo: 'shopify', base: 'https://gexachile.cl' },
  { id: 'spdental', nombre: 'SP Dental', tipo: 'shopify', base: 'https://spdental.shop' },
  { id: 'clandent', nombre: 'Clandent', tipo: 'woo', base: 'https://clandent.cl' },
  { id: 'dentica', nombre: 'Dentica', tipo: 'woo', base: 'https://dentica.cl' },
  { id: 'jdent', nombre: 'J-Dent', tipo: 'woo', base: 'https://www.j-dent.cl' },
  { id: 'techdent', nombre: 'Techdent', tipo: 'woo', base: 'https://techdent.cl' },
  { id: 'denteeth', nombre: 'Denteeth', tipo: 'woo', base: 'https://denteeth.cl' },
];

// Seguimos identificándonos (nombre + URL de contacto), pero con la forma de
// un navegador: los firewalls tipo SiteGround rechazan con 403 cualquier UA
// que empiece con "Mozilla/5.0 (compatible; …)" que no esté en su lista
// blanca, y eso dejaba fuera tiendas perfectamente consultables.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 AmsodentPortal/1.0 (+https://amsodent.cl)';
// 12 s: con 8 s quedaban fuera tiendas lentas pero sanas. Las tiendas se
// consultan en paralelo, así que esto no multiplica el tiempo de búsqueda.
const TIPOS_VALIDOS: readonly string[] = ['shopify', 'woo', 'odoo', 'amsodent'];
const TIPOS = '"shopify", "woo", "odoo" o "amsodent"';
const TIMEOUT_MS = 12000;
const MAX_POR_TIENDA = 8;
const CACHE_MS = 10 * 60 * 1000;

type Hallazgo = {
  tienda: string;
  tienda_nombre: string;
  nombre: string;
  url: string;
  precio: number;
  precio_normal: number | null; // precio sin oferta si la tienda lo informa
  oferta: boolean;
  imagen: string | null;
  disponible: boolean;
  // SKU del producto cuando el hallazgo es de la tienda de Amsodent. Sale de
  // la propia web (que lo publica); solo si no viene se calza por nombre.
  sku?: string | null;
  /* Producto con variantes (forma, tamaño, color…): cada variante tiene su
     propio SKU y precio, así que hay que saber cuál quiere el cliente. Solo
     se llena para la tienda de Amsodent. */
  variantes?: Array<{ id: number | string; sku: string | null; etiqueta: string; precio: number }>;
  // (2026-10-09) Encontrado por la ficha del catálogo (descripción, presentación…), no por el nombre.
  por_ficha?: boolean;
  // Datos de la web que solo usa este servicio para resolver las variantes.
  web_id?: number;
  variable?: boolean;
  historico?: {
    capturas: number;
    precio_min: number;
    precio_max: number;
    anterior: { precio: number; fecha: string } | null;
    variacion: number | null; // precio actual − captura anterior
  } | null;
};

/* ── Web propia de Amsodent (2026-10-06) ────────────────────────────────────
   El sitio amsodentmedical.cl dejó de ser WordPress/WooCommerce: es una tienda
   propia en Next.js (App Router) y su /wp-json ya no existe (404), así que la
   tienda de Amsodent quedó fuera del explorador. No tiene una API pública de
   búsqueda, pero sus páginas traen los datos completos que usa la propia web:
   · /catalogo?q=… → la grilla (nombre, precio, precio normal, stock, si tiene
     variantes) y un ItemList schema.org con el orden de los resultados.
   · /producto/<slug> → las variantes con su SKU real, precio y stock.
   Next manda esos datos en trozos `self.__next_f.push([1,"…"])`: cada trozo es
   un string JSON y, unidos, forman el "flight" donde están los objetos. */
function flightDeNext(html: string): string {
  const partes: string[] = [];
  const rx = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html))) {
    try { partes.push(JSON.parse(m[1])); } catch { /* trozo ilegible: se ignora */ }
  }
  return partes.join('');
}

/* El objeto JSON más chico que encierra la posición `pos` del texto. */
function objetoQueContiene(texto: string, pos: number): any | null {
  let prof = 0;
  let i = pos;
  for (; i >= 0; i--) {
    const c = texto[i];
    if (c === '}') prof++;
    else if (c === '{') {
      if (prof === 0) break;
      prof--;
    }
  }
  if (i < 0) return null;
  let enStr = false;
  let esc = false;
  prof = 0;
  for (let j = i; j < texto.length; j++) {
    const c = texto[j];
    if (enStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') enStr = false;
      continue;
    }
    if (c === '"') enStr = true;
    else if (c === '{') prof++;
    else if (c === '}') {
      prof--;
      if (prof === 0) {
        try { return JSON.parse(texto.slice(i, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/* Todos los objetos del flight que contienen la clave `clave` (por ejemplo
   "hasVariants" marca a cada producto de la grilla). */
function objetosConClave(texto: string, clave: string): any[] {
  const out: any[] = [];
  const marca = `"${clave}":`;
  let i = texto.indexOf(marca);
  while (i >= 0) {
    const o = objetoQueContiene(texto, i);
    if (o) out.push(o);
    i = texto.indexOf(marca, i + marca.length);
  }
  return out;
}

// Los nombres de Woo llegan con entidades HTML ("&#8211;", "&amp;").
function limpiarNombre(s: any): string {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class ExploradorService {
  private readonly logger = new Logger(ExploradorService.name);
  private cache = new Map<string, { ts: number; data: any }>();
  // Tiendas activas (mantenedor): caché de 5 min para no leer la tabla en
  // cada búsqueda; se invalida al guardar/eliminar desde el mantenedor.
  private tiendasCache: { ts: number; tiendas: Tienda[] } | null = null;

  constructor(private supabase: SupabaseService) {}

  /* (2026-10-01) El explorador vive en dos lugares con publicos distintos: el
     del cliente, en su portal, y el interno de la plataforma. No siempre
     conviene mostrarle al cliente las mismas tiendas que miramos nosotros, asi
     que cada tienda declara su ambito. 'ambos' es el valor por omision y
     mantiene el comportamiento de antes. */
  /* (2026-10-09) `region`: solo las tiendas sin región (venden a todo Chile)
     y las de esa región. Sin región, todas. */
  private async tiendasActivas(ambito: 'cliente' | 'plataforma' = 'cliente', region?: string | null): Promise<Tienda[]> {
    const todas = await this.tiendasActivasTodas(ambito);
    const r = normRegion(region);
    return r ? todas.filter((t) => !t.region || normRegion(t.region) === r) : todas;
  }

  private async tiendasActivasTodas(ambito: 'cliente' | 'plataforma' = 'cliente'): Promise<Tienda[]> {
    const cache = this.tiendasCache as any;
    if (cache && cache.ambito === ambito && Date.now() - cache.ts < 5 * 60 * 1000) {
      return cache.tiendas;
    }
    try {
      const { data, error } = await this.supabase
        .getClient()
        .from('explorador_tiendas')
        .select('*')
        .eq('activa', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      const tiendas: Tienda[] = (data || [])
        // Sin la columna (migracion pendiente) `ambito` llega undefined y la
        // tienda entra en los dos exploradores, como hasta ahora.
        .filter((t: any) => {
          const a = String(t?.ambito || 'ambos');
          return a === 'ambos' || a === ambito;
        })
        .filter((t: any) => t?.id && t?.base_url && TIPOS_VALIDOS.includes(t?.tipo))
        .map((t: any) => ({
          id: String(t.id),
          nombre: String(t.nombre || t.id),
          tipo: t.tipo,
          base: String(t.base_url).replace(/\/+$/, ''),
          region: String(t.region || '').trim() || null,
        }));
      if (tiendas.length) {
        this.tiendasCache = { ts: Date.now(), tiendas, ambito } as any;
        return tiendas;
      }
    } catch (e: any) {
      this.logger.warn(`Explorador: tabla de tiendas no disponible (${String(e?.message || e).slice(0, 100)}); uso el fallback.`);
    }
    return TIENDAS_FALLBACK;
  }

  // Tiendas cuya Store API quedó comprobadamente rota en esta sesión: se
  // consultan directo por el respaldo, sin gastar la petición que va a fallar.
  private storeApiRota = new Set<string>();

  invalidarTiendas() {
    this.tiendasCache = null;
    this.cache.clear();
    this.storeApiRota.clear();
  }

  async buscar(qRaw: string, ambito: 'cliente' | 'plataforma' = 'cliente', region?: string | null) {
    const q = String(qRaw || '').trim().slice(0, 60);
    if (q.length < 3) throw new BadRequestException('Escribe al menos 3 letras para buscar.');

    const key = `${ambito}|${normRegion(region)}|${q.toLowerCase()}`;
    const enCache = this.cache.get(key);
    if (enCache && Date.now() - enCache.ts < CACHE_MS) return enCache.data;

    const tiendas = await this.tiendasActivas(ambito, region);
    const porTienda = await Promise.all(
      tiendas.map((t) =>
        this.buscarEnTienda(t, q).catch((e) => {
          this.logger.warn(`Explorador: ${t.id} falló para "${q}": ${String(e?.message || e).slice(0, 120)}`);
          return { items: [] as Hallazgo[], error: true };
        }),
      ),
    );

    const items = porTienda.flatMap((r) => r.items);
    const tiendasCaidas = tiendas.filter((_, i) => (porTienda[i] as any).error).map((t) => t.nombre);

    await this.adjuntarHistoricoYGuardar(q, items);
    await this.adjuntarVariantesAmsodent(items, tiendas);
    await this.adjuntarSkuAmsodent(items);
    // Amsodent siempre encabeza; dentro de cada grupo, del más barato al más caro.
    items.sort((a, b) => {
      const propiaA = a.tienda === 'amsodent' ? 0 : 1;
      const propiaB = b.tienda === 'amsodent' ? 0 : 1;
      if (propiaA !== propiaB) return propiaA - propiaB;
      return a.precio - b.precio;
    });

    const data = {
      consulta: q,
      region: normRegion(region) ? String(region) : null,
      total: items.length,
      tiendas_consultadas: tiendas.map((t) => t.nombre),
      tiendas_sin_respuesta: tiendasCaidas,
      items,
    };
    this.cache.set(key, { ts: Date.now(), data });
    // La caché no debe crecer sin límite en un proceso de larga vida.
    if (this.cache.size > 200) {
      const masVieja = [...this.cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (masVieja) this.cache.delete(masVieja[0]);
    }
    return data;
  }

  /* (2026-10-09) Región del cliente del portal, para elegir sus tiendas. */
  async regionDeCliente(rut: string): Promise<string | null> {
    const limpio = String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (!limpio) return null;
    try {
      const cuerpo = limpio.slice(0, -1);
      const dv = limpio.slice(-1);
      const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const { data } = await this.supabase.getClient().from('clientes').select('region').in('rut', [`${conPuntos}-${dv}`, `${cuerpo}-${dv}`, limpio, String(rut)]).limit(1);
      return String((data as any)?.[0]?.region || '').trim() || null;
    } catch {
      return null;
    }
  }

  /* (2026-10-09) Lo que la ficha del producto en su tienda dice de él: nombre,
     marca, SKU, descripción e imagen. Para precargar «Crear producto» con el
     máximo de campos (pedido de Ariel). Cada tipo de tienda lo publica de una
     forma; lo que no se encuentra queda vacío y se completa a mano. */
  async detalleProducto(urlRaw: string, tiendaId?: string | null) {
    const url = String(urlRaw || '').trim().split('#')[0];
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new BadRequestException('Falta el link del producto.');
    const tiendas = await this.tiendasActivasTodas('plataforma');
    const t = tiendas.find((x) => x.id === String(tiendaId || '')) || tiendas.find((x) => url.startsWith(x.base)) || null;
    const tipo = t?.tipo || (/\/products\//.test(url) ? 'shopify' : /\/producto\//.test(url) && /amsodent/i.test(url) ? 'amsodent' : 'woo');
    const out: { nombre: string | null; marca: string | null; sku: string | null; descripcion: string | null; imagen: string | null; tipo: string } = { nombre: null, marca: null, sku: null, descripcion: null, imagen: null, tipo };
    const limpiar = (html: any) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 2000) || null;
    try {
      if (tipo === 'shopify') {
        const j = await this.fetchJson(`${url.split('?')[0].replace(/\/$/, '')}.js`);
        out.nombre = limpiarNombre(j?.title || '') || null;
        out.marca = String(j?.vendor || '').trim() || null;
        out.sku = String(j?.variants?.[0]?.sku || '').trim() || null;
        out.descripcion = limpiar(j?.description);
        out.imagen = j?.featured_image || j?.images?.[0] || null;
      } else if (tipo === 'woo') {
        const base = t?.base || url.replace(/^(https?:\/\/[^/]+).*$/, '$1');
        const slug = url.split('?')[0].replace(/\/$/, '').split('/').pop() || '';
        const arr = await this.fetchJson(`${base}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`);
        const p = Array.isArray(arr) ? arr[0] : null;
        if (p) {
          out.nombre = limpiarNombre(p.name || '') || null;
          out.sku = String(p.sku || '').trim() || null;
          out.descripcion = limpiar([p.short_description, p.description].filter(Boolean).join('\n'));
          out.imagen = p?.images?.[0]?.src || null;
          const marca = (p.attributes || []).find((a: any) => /marca|brand/i.test(String(a?.name || '')));
          out.marca = String(marca?.terms?.[0]?.name || p?.brands?.[0]?.name || '').trim() || null;
        }
      } else if (tipo === 'amsodent') {
        const html = await this.fetchTexto(url);
        const flight = flightDeNext(html);
        const i = flight.indexOf('"variantes":[');
        const datos: any = i >= 0 ? objetoQueContiene(flight, i) : null;
        out.nombre = limpiarNombre(datos?.nombre || datos?.name || '') || null;
        out.marca = String(datos?.marca || datos?.brand || '').trim() || null;
        out.sku = String(datos?.sku || datos?.variantes?.[0]?.sku || '').trim() || null;
        out.descripcion = limpiar(datos?.descripcion || datos?.description || datos?.descripcionCorta || '');
        const m = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
        if (!out.descripcion && m) out.descripcion = limpiar(m[1]);
      } else {
        const html = await this.fetchTexto(url);
        const m = html.match(/<meta[^>]+(?:name|property)="(?:description|og:description)"[^>]+content="([^"]*)"/i);
        out.descripcion = m ? limpiar(m[1]) : null;
        const marca = html.match(/itemprop="brand"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{2,60})</i);
        out.marca = marca ? marca[1].trim() : null;
        const t2 = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i);
        out.nombre = t2 ? limpiarNombre(t2[1]) : null;
      }
    } catch (e: any) {
      this.logger.warn(`Explorador: sin detalle para ${url}: ${String(e?.message || e).slice(0, 120)}`);
    }
    return out;
  }

  private async fetchJson(url: string): Promise<any> {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ── Mantenedor de tiendas (admin, 2026-09-10) ────────────────────── */
  async listarTiendas() {
    const { data, error } = await this.supabase
      .getClient()
      .from('explorador_tiendas')
      .select('*')
      .order('orden', { ascending: true });
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260910_explorador_tiendas.sql en Supabase.'
          : error.message,
      );
    }
    return data || [];
  }

  async guardarTienda(body: {
    id?: string;
    nombre?: string;
    tipo?: string;
    base_url?: string;
    activa?: boolean;
    orden?: number | string;
    nota?: string;
    ambito?: string;
  }) {
    const nombre = String(body?.nombre || '').trim().slice(0, 80);
    if (!nombre) throw new BadRequestException('Falta el nombre de la tienda.');
    const tipo = String(body?.tipo || '').trim().toLowerCase();
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new BadRequestException(
        `El tipo debe ser ${TIPOS}` + ' (solo se soportan tiendas con esas vitrinas públicas consultables).',
      );
    }
    let base = String(body?.base_url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(base)) {
      throw new BadRequestException('La URL base debe ser https:// y un dominio válido (ej: https://gexachile.cl).');
    }
    // id: slug estable; si no viene, se deriva del nombre.
    const id = String(body?.id || nombre)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 40);
    if (!id) throw new BadRequestException('No se pudo derivar un identificador para la tienda.');

    const activa = body?.activa !== false;
    if (id === 'amsodent' && !activa) {
      throw new BadRequestException('La tienda Amsodent no se puede desactivar: siempre encabeza el explorador.');
    }
    const orden = Number.isFinite(Number(body?.orden)) ? Number(body?.orden) : 100;
    const nota = String(body?.nota ?? '').trim().slice(0, 400) || null;

    const AMBITOS = ['ambos', 'cliente', 'plataforma'];
    const ambito = AMBITOS.includes(String(body?.ambito || '')) ? String(body.ambito) : 'ambos';
    // (2026-10-09) Región a la que vende la tienda; vacío = todo Chile.
    const region = String((body as any)?.region ?? '').trim().slice(0, 60) || null;

    const fila: Record<string, any> = {
      id, nombre, tipo, base_url: base, activa, orden,
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await this.supabase
      .getClient()
      .from('explorador_tiendas')
      .upsert([{ ...fila, nota, ambito, region }], { onConflict: 'id' })
      .select()
      .single();
    // `nota` llegó con la migración 20260916, `ambito` con la 20261001 y
    // `region` con la 20261009; si alguna no está aplicada, se guarda igual el
    // resto en vez de fallar.
    if (error && /region/i.test(error.message) && /column|schema cache/i.test(error.message)) {
      ({ data, error } = await this.supabase
        .getClient()
        .from('explorador_tiendas')
        .upsert([{ ...fila, nota, ambito }], { onConflict: 'id' })
        .select()
        .single());
    }
    if (error && /nota|ambito/i.test(error.message) && /column|schema cache/i.test(error.message)) {
      ({ data, error } = await this.supabase
        .getClient()
        .from('explorador_tiendas')
        .upsert([fila], { onConflict: 'id' })
        .select()
        .single());
    }
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260910_explorador_tiendas.sql en Supabase.'
          : error.message,
      );
    }
    this.invalidarTiendas();
    return data;
  }

  async eliminarTienda(id: string) {
    const idN = String(id || '').trim().toLowerCase();
    if (idN === 'amsodent') {
      throw new BadRequestException('La tienda Amsodent no se puede eliminar.');
    }
    const { error } = await this.supabase
      .getClient()
      .from('explorador_tiendas')
      .delete()
      .eq('id', idN);
    if (error) throw new BadRequestException(error.message);
    this.invalidarTiendas();
    return { deleted: true };
  }

  // Prueba en vivo una tienda (o una configuración aún no guardada): corre la
  // búsqueda real contra su API y devuelve cuántos resultados entrega. Sirve
  // para validar una página nueva antes de activarla — si el sitio no es
  // Shopify ni WooCommerce con Store API pública, la prueba lo dirá.
  async probarTienda(body: { tipo?: string; base_url?: string; q?: string }) {
    const tipo = String(body?.tipo || '').trim().toLowerCase();
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new BadRequestException(`El tipo debe ser ${TIPOS}.`);
    }
    const base = String(body?.base_url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(base)) throw new BadRequestException('La URL base debe partir con https://');
    const q = String(body?.q || 'resina').trim().slice(0, 40) || 'resina';
    const t: Tienda = { id: 'prueba', nombre: 'Prueba', tipo: tipo as Tienda['tipo'], base };
    try {
      const r = await this.buscarEnTienda(t, q);
      return {
        ok: true,
        consulta: q,
        resultados: r.items.length,
        ejemplo: r.items[0] ? { nombre: r.items[0].nombre, precio: r.items[0].precio, url: r.items[0].url } : null,
      };
    } catch (e: any) {
      return {
        ok: false,
        consulta: q,
        resultados: 0,
        error: String(e?.message || e).slice(0, 160),
      };
    }
  }

  private async buscarEnTienda(t: Tienda, q: string): Promise<{ items: Hallazgo[] }> {
    const enc = encodeURIComponent(q);
    // La tienda propia va por su lector aunque la fila aún diga "woo" (migración 20261007 pendiente).
    if (t.tipo === 'amsodent' || t.id === 'amsodent') return this.buscarEnWebAmsodent(t, enc);
    if (t.tipo === 'shopify') {
      const json = await this.fetchJson(
        `${t.base}/search/suggest.json?q=${enc}&resources%5Btype%5D=product&resources%5Blimit%5D=${MAX_POR_TIENDA}&resources%5Boptions%5D%5Bfields%5D=title,body,product_type,tag,vendor,variants.sku,variants.title`,
      );
      const productos: any[] = json?.resources?.results?.products || [];
      return {
        items: productos
          .map((p): Hallazgo | null => {
            const precio = Math.round(Number(String(p?.price ?? '').replace(/[^\d.]/g, '')) || 0);
            if (!precio || !p?.url) return null;
            return {
              tienda: t.id,
              tienda_nombre: t.nombre,
              nombre: limpiarNombre(p.title),
              // Sin los parámetros de tracking (_pos, _psq…): la URL limpia es
              // la llave estable del histórico.
              url: `${t.base}${String(p.url).split('?')[0]}`,
              precio,
              precio_normal: null,
              oferta: false,
              imagen: p?.featured_image?.url || p?.image || null,
              disponible: p?.available !== false,
            };
          })
          .filter(Boolean) as Hallazgo[],
      };
    }
    if (t.tipo === 'odoo') return this.buscarEnOdoo(t, enc);

    /* WooCommerce Store API (pública, sin credenciales). Hay tiendas donde
       /products está roto por un conflicto de plugins aunque el resto de la
       Store API funcione, y falla de dos formas según la consulta: a veces
       devuelve el cuerpo vacío (revienta al parsear) y a veces un `[]` que no
       se distingue de "no hay coincidencias". Por eso el respaldo se intenta
       en los dos casos: al fallar Y al venir sin resultados.
       Para no gastar una petición de más en cada búsqueda, la primera vez que
       el respaldo rescata una tienda se anota, y desde ahí se va directo. */
    if (!this.storeApiRota.has(t.id)) {
      let json: any;
      let reventó = false;
      try {
        json = await this.fetchJson(`${t.base}/wp-json/wc/store/v1/products?search=${enc}&per_page=${MAX_POR_TIENDA}`);
      } catch (e: any) {
        // Si la tienda no alcanzó a responder, reintentar solo duplica la
        // espera: el respaldo es para sitios que contestan rápido pero mal.
        if (/abort|timeout/i.test(String(e?.name || '') + String(e?.message || ''))) throw e;
        reventó = true;
      }
      const items = this.mapearWooStore(t, Array.isArray(json) ? json : []);
      if (items.length) return { items };
      // Sin resultados: puede ser que la tienda no tenga el producto o que su
      // Store API esté rota. Lo resuelve el respaldo, que sabe distinguirlo.
      const respaldo = await this.buscarEnWooWp(t, enc);
      /* La marca es permanente, así que solo se pone ante una falla dura de la
         Store API. Un `[]` no basta: los dos buscadores no encuentran lo mismo,
         y una tienda sana que hoy devuelve vacío para una consulta quedaría
         atada para siempre al respaldo, que no informa stock ni ofertas. */
      if (reventó && respaldo.items.length) {
        this.logger.warn(`Explorador: ${t.id} tiene la Store API rota; uso wp/v2/product de aquí en adelante.`);
        this.storeApiRota.add(t.id);
      }
      return respaldo;
    }
    return this.buscarEnWooWp(t, enc);
  }

  private mapearWooStore(t: Tienda, productos: any[]): Hallazgo[] {
    return productos
      .map((p): Hallazgo | null => {
        const pr = p?.prices || {};
        const div = Math.pow(10, Number(pr.currency_minor_unit || 0));
        const precio = Math.round(Number(pr.price || 0) / div);
        if (!precio || !p?.permalink) return null;
        const normal = Math.round(Number(pr.regular_price || 0) / div) || null;
        return {
          tienda: t.id,
          tienda_nombre: t.nombre,
          nombre: limpiarNombre(p.name),
          url: String(p.permalink).split('?')[0],
          precio,
          precio_normal: normal && normal > precio ? normal : null,
          oferta: !!p?.on_sale && !!normal && normal > precio,
          imagen: p?.images?.[0]?.thumbnail || p?.images?.[0]?.src || null,
          disponible: p?.is_in_stock !== false,
          // (2026-10-02) El SKU viene en la respuesta de la tienda. Se estaba
          // ignorando y se intentaba adivinar por el nombre, que casi nunca
          // calza: los pedidos llegaban sin SKU.
          sku: String(p?.sku || '').trim() || null,
          web_id: Number(p?.id) || undefined,
          variable: p?.type === 'variable',
        };
      })
      .filter(Boolean) as Hallazgo[];
  }

  /* Variantes de los productos de la tienda de Amsodent. Un producto
     "variable" (ej. un kit que viene en forma de disco o de llama) tiene un
     código de familia que no se vende; el SKU real es el de cada variante. Se
     piden a la tienda —una consulta por producto, en paralelo— y se guardan
     en memoria, porque cambian poco y la búsqueda del portal es frecuente. */
  private variantesCache = new Map<number, { ts: number; lista: NonNullable<Hallazgo['variantes']> }>();

  private async adjuntarVariantesAmsodent(items: Hallazgo[], tiendas: Tienda[]) {
    const base = tiendas.find((t) => t.id === 'amsodent')?.base;
    const variables = items.filter((i) => i.tienda === 'amsodent' && i.variable && i.web_id);
    if (!base || !variables.length) return;
    await Promise.all(
      variables.map(async (it) => {
        const id = Number(it.web_id);
        let guardadas = this.variantesCache.get(id);
        if (!guardadas || Date.now() - guardadas.ts > 6 * 3600 * 1000) {
          try {
            const json = await this.fetchJson(`${base}/wp-json/wc/store/v1/products?type=variation&parent=${id}&per_page=50`);
            const lista = (Array.isArray(json) ? json : [])
              .map((v: any) => {
                const pr = v?.prices || {};
                const div = Math.pow(10, Number(pr.currency_minor_unit || 0));
                return {
                  id: Number(v?.id),
                  sku: String(v?.sku || '').trim() || null,
                  etiqueta: limpiarNombre(v?.variation || '') || `Variante ${v?.id}`,
                  precio: Math.round(Number(pr.price || 0) / div) || it.precio,
                };
              })
              .filter((v: any) => Number.isFinite(v.id))
              .sort((a: any, b: any) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'es'));
            guardadas = { ts: Date.now(), lista };
            this.variantesCache.set(id, guardadas);
          } catch (e: any) {
            this.logger.warn(`Explorador: sin variantes para ${it.url}: ${String(e?.message || e).slice(0, 100)}`);
            return;
          }
        }
        if (guardadas.lista.length === 1) {
          // Una sola variante: no hay nada que elegir, ese es el producto.
          it.sku = guardadas.lista[0].sku;
        } else if (guardadas.lista.length > 1) {
          it.variantes = guardadas.lista;
          // El código de la familia no identifica nada vendible.
          it.sku = null;
        }
      }),
    );
  }

  private async fetchTexto(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  /* Odoo eCommerce no publica una API de búsqueda abierta, pero su vitrina
     /shop marca cada producto con microdatos schema.org (itemtype Product +
     itemprop price / priceCurrency). Eso es un contrato estandarizado — es lo
     mismo que lee Google Shopping —, así que leerlo es bastante más estable
     que colgarse de las clases CSS del tema de turno.
     `ppg` acota la página al número de productos que necesitamos, para no
     descargar la grilla completa. */
  private async buscarEnOdoo(t: Tienda, enc: string): Promise<{ items: Hallazgo[] }> {
    const html = await this.fetchTexto(`${t.base}/shop?search=${enc}&ppg=${MAX_POR_TIENDA}`);
    // Cada bloque va desde un itemtype Product hasta el siguiente.
    const bloques = html.split(/itemtype="https?:\/\/schema\.org\/Product"/i).slice(1);
    const absoluta = (ruta: string) => (/^https?:\/\//i.test(ruta) ? ruta : `${t.base}${ruta}`);
    return {
      items: bloques
        .map((bruto): Hallazgo | null => {
          // Un techo por bloque evita que una tarjeta mal cerrada se coma las
          // siguientes y mezcle el precio de un producto con el nombre de otro.
          const b = bruto.slice(0, 6000);
          const precio = Math.round(Number((b.match(/itemprop="price"[^>]*>\s*([\d.]+)/i) || [])[1]) || 0);
          const href = (b.match(/href="(\/shop\/[^"#]+)"/i) || [])[1];
          if (!precio || !href) return null;
          // Odoo repite el nombre del producto en el alt de la imagen.
          const nombre = limpiarNombre((b.match(/<img[^>]+alt="([^"]{3,})"/i) || [])[1]);
          if (!nombre) return null;
          const img = (b.match(/src="(\/web\/image\/product\.template\/[^"]+)"/i) || [])[1];
          return {
            tienda: t.id,
            tienda_nombre: t.nombre,
            nombre,
            url: absoluta(href.split('?')[0]),
            precio,
            // La vitrina de Odoo no distingue precio normal de precio rebajado
            // salvo que la tienda active las etiquetas de oferta; sin ese dato
            // se informa solo el precio vigente en vez de inventar un descuento.
            precio_normal: null,
            oferta: false,
            imagen: img ? absoluta(img) : null,
            disponible: true, // la grilla no informa stock; se asume disponible
          };
        })
        .filter(Boolean)
        .slice(0, MAX_POR_TIENDA) as Hallazgo[],
    };
  }

  /* Respaldo para tiendas WooCommerce con la Store API rota: la REST API de
     WordPress expone el tipo `product` y, cuando el sitio tiene instalado
     Doofinder (muy común en el rubro), también los campos df_price /
     df_regular_price / df_sale_price / df_image_link. Se piden solo esos
     campos con `_fields` para no bajar el HTML completo de cada ficha.
     Si la tienda no publica precio por esta vía, los productos se descartan
     y la tienda queda como "sin respuesta" — nunca se muestra sin precio. */
  private async buscarEnWooWp(t: Tienda, enc: string): Promise<{ items: Hallazgo[] }> {
    const campos = 'title,link,status,df_price,df_regular_price,df_sale_price,df_image_link';
    const json = await this.fetchJson(
      `${t.base}/wp-json/wp/v2/product?search=${enc}&per_page=${MAX_POR_TIENDA}&_fields=${campos}`,
    );
    const productos: any[] = Array.isArray(json) ? json : [];
    const num = (v: any): number => Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0);
    return {
      items: productos
        .map((p): Hallazgo | null => {
          const precio = num(p?.df_price);
          if (!precio || !p?.link) return null;
          const normal = num(p?.df_regular_price) || null;
          const enOferta = num(p?.df_sale_price) > 0 && !!normal && normal > precio;
          return {
            tienda: t.id,
            tienda_nombre: t.nombre,
            nombre: limpiarNombre(p?.title?.rendered ?? p?.title),
            url: String(p.link).split('?')[0],
            precio,
            precio_normal: normal && normal > precio ? normal : null,
            oferta: enOferta,
            imagen: p?.df_image_link || null,
            disponible: true, // esta vía no informa stock; se asume disponible
          };
        })
        .filter(Boolean) as Hallazgo[],
    };
  }

  /* La web propia de Amsodent (ver flightDeNext). Una petición a la grilla y
     otra por cada producto mostrado —en paralelo y en caché 6 h— para traer el
     SKU real y las variantes, igual que daba la Store API de WooCommerce. */
  private fichasAmsodent = new Map<string, { ts: number; variantes: Array<{ id: string; sku: string | null; nombre: string; precio: number; disponible: boolean }> }>();

  private async variantesDeFicha(base: string, slug: string) {
    const guardada = this.fichasAmsodent.get(slug);
    if (guardada && Date.now() - guardada.ts < 6 * 3600 * 1000) return guardada.variantes;
    const flight = flightDeNext(await this.fetchTexto(`${base}/producto/${encodeURIComponent(slug)}`));
    const i = flight.indexOf('"variantes":[');
    const datos = i >= 0 ? objetoQueContiene(flight, i) : null;
    const variantes = (Array.isArray(datos?.variantes) ? datos.variantes : [])
      .map((v: any) => ({
        id: String(v?.id || ''),
        sku: String(v?.sku || '').trim() || null,
        nombre: limpiarNombre(v?.nombre || ''),
        precio: Math.round(Number(v?.precio) || 0),
        disponible: Number(v?.disponible) > 0 || v?.permiteEncargo === true,
      }))
      .filter((v: any) => v.id);
    this.fichasAmsodent.set(slug, { ts: Date.now(), variantes });
    if (this.fichasAmsodent.size > 2000) this.fichasAmsodent.clear();
    return variantes;
  }

  /* (2026-10-09) Pedido de Ariel: "ampliar la búsqueda a la descripción,
     descripción corta, etc.". La web busca por nombre; acá se suma lo que
     calza por la ficha de nuestro catálogo (descripción, presentación,
     composición, uso): con su SKU se le pide a la web ese producto. */
  private async buscarEnWebAmsodent(t: Tienda, enc: string): Promise<{ items: Hallazgo[] }> {
    const principal = await this.catalogoAmsodent(t, enc);
    const q = decodeURIComponent(enc);
    const skus = await this.skusPorFicha(q, principal.items.map((i) => i.sku).filter(Boolean) as string[]);
    if (!skus.length || principal.items.length >= MAX_POR_TIENDA) return { items: principal.items };
    const extra = await Promise.all(skus.map((sku) => this.catalogoAmsodent(t, encodeURIComponent(sku)).catch(() => ({ items: [] as Hallazgo[] }))));
    const vistos = new Set(principal.items.map((i) => i.url));
    const items = [...principal.items];
    for (const r of extra) for (const it of r.items) if (!vistos.has(it.url) && items.length < MAX_POR_TIENDA) { vistos.add(it.url); items.push({ ...it, por_ficha: true }); }
    return { items };
  }

  /* SKUs del catálogo cuya ficha (no el nombre) menciona lo buscado. */
  private async skusPorFicha(q: string, yaEncontrados: string[]): Promise<string[]> {
    const texto = q.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (texto.length < 3) return [];
    try {
      const patron = `%${texto}%`;
      const { data, error } = await this.supabase
        .getClient()
        .from('productos')
        .select('sku, nombre')
        .not('sku', 'is', null)
        .neq('estado', 'Inactivo')
        .or(`descripcion.ilike.${patron},presentacion.ilike.${patron},composicion.ilike.${patron},uso_indicaciones.ilike.${patron},datos_clave.ilike.${patron}`)
        .limit(12);
      if (error) return [];
      const ya = new Set(yaEncontrados.map((s) => String(s).toUpperCase()));
      const n = ExploradorService.normNombre(texto);
      return (data || [])
        .map((p: any) => String(p.sku || '').trim().toUpperCase())
        .filter((sku: string, i: number, arr: string[]) => sku && !ya.has(sku) && arr.indexOf(sku) === i)
        .filter((sku: string) => !ExploradorService.normNombre((data || []).find((p: any) => String(p.sku || '').trim().toUpperCase() === sku)?.nombre).includes(n))
        .slice(0, 4);
    } catch {
      return [];
    }
  }

  private async catalogoAmsodent(t: Tienda, enc: string): Promise<{ items: Hallazgo[] }> {
    const html = await this.fetchTexto(`${t.base}/catalogo?q=${enc}`);
    const flight = flightDeNext(html);
    // Productos de la grilla: los objetos con nombre, precio y la marca de variantes.
    const porSlug = new Map<string, any>();
    for (const o of objetosConClave(flight, 'hasVariants')) {
      if (o?.id && o?.name && Number(o?.price) > 0 && !porSlug.has(String(o.id))) porSlug.set(String(o.id), o);
    }
    // El orden de los resultados lo da el ItemList schema.org de la página.
    const orden: string[] = [];
    for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        const ld = JSON.parse(m[1]);
        if (ld?.['@type'] !== 'ItemList') continue;
        for (const e of ld.itemListElement || []) {
          const slug = String(e?.url || '').split('/producto/')[1]?.split(/[?#/]/)[0];
          if (slug) orden.push(decodeURIComponent(slug));
        }
      } catch { /* bloque ilegible */ }
    }
    const slugs = (orden.length ? orden.filter((x) => porSlug.has(x)) : [...porSlug.keys()]).slice(0, MAX_POR_TIENDA);
    const abs = (u: any) => (!u ? null : /^https?:/i.test(String(u)) ? String(u) : `${t.base}${String(u).startsWith('/') ? '' : '/'}${u}`);
    const items: Hallazgo[] = slugs.map((slug) => {
      const p = porSlug.get(slug);
      const precio = Math.round(Number(p.price) || 0);
      const normal = Math.round(Number(p.compareAtPrice) || 0);
      return {
        tienda: t.id,
        tienda_nombre: t.nombre,
        nombre: limpiarNombre(p.name),
        url: `${t.base}/producto/${slug}`,
        precio,
        precio_normal: normal > precio ? normal : null,
        oferta: normal > precio,
        imagen: abs(p.image),
        disponible: p.inStock !== false || p.backorderAvailable === true,
        sku: null,
        variable: p.hasVariants === true,
      };
    });
    // SKU real y variantes, desde la ficha de cada producto.
    await Promise.all(
      items.map(async (it, n) => {
        try {
          const vs = await this.variantesDeFicha(t.base, slugs[n]);
          if (vs.length === 1) {
            it.sku = vs[0].sku;
          } else if (vs.length > 1) {
            it.sku = null; // el producto es una familia: lo vendible es cada variante
            it.variantes = vs
              .map((v) => ({ id: v.id, sku: v.sku, etiqueta: `${v.nombre || v.sku || 'Variante'}${v.disponible ? '' : ' (sin stock)'}`, precio: v.precio || it.precio }))
              .sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'es'));
          }
        } catch (e: any) {
          this.logger.warn(`Explorador: sin ficha para ${it.url}: ${String(e?.message || e).slice(0, 100)}`);
        }
      }),
    );
    return { items };
  }

  /* SKU para los hallazgos de la tienda de Amsodent que llegan SIN él. Lo
     normal es que la tienda lo publique (ver mapearWooStore); esto queda para
     la vía de respaldo (wp/v2/product), que no lo trae. Ahí se calza por
     nombre normalizado contra `productos`: primero por igualdad y, si no, por
     contención de uno en el otro. El índice del catálogo se arma una vez y se
     guarda en memoria, porque son miles de filas y la búsqueda es frecuente. */
  private catalogo: { ts: number; porNombre: Map<string, string>; lista: Array<{ n: string; sku: string }> } | null = null;

  private static normNombre(s: unknown) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async indiceCatalogo() {
    if (this.catalogo && Date.now() - this.catalogo.ts < CACHE_MS) return this.catalogo;
    const { data, error } = await this.supabase.getClient()
      .from('productos')
      .select('sku, nombre')
      .not('sku', 'is', null)
      .range(0, 20000);
    if (error) {
      this.logger.warn(`Explorador: no se pudo leer el catálogo para el SKU: ${error.message}`);
      return null;
    }
    const porNombre = new Map<string, string>();
    const lista: Array<{ n: string; sku: string }> = [];
    for (const p of data || []) {
      const n = ExploradorService.normNombre((p as any).nombre);
      const sku = String((p as any).sku || '').trim();
      if (!n || !sku) continue;
      if (!porNombre.has(n)) porNombre.set(n, sku);
      lista.push({ n, sku });
    }
    this.catalogo = { ts: Date.now(), porNombre, lista };
    return this.catalogo;
  }

  private async adjuntarSkuAmsodent(items: Hallazgo[]) {
    // Los que ya traen el SKU de la web, o tienen variantes por elegir, no se tocan.
    const nuestros = items.filter((i) => i.tienda === 'amsodent' && !i.sku && !i.variantes?.length);
    if (!nuestros.length) return;
    const idx = await this.indiceCatalogo();
    if (!idx) return;
    for (const it of nuestros) {
      const n = ExploradorService.normNombre(it.nombre);
      if (!n) continue;
      let sku = idx.porNombre.get(n) || null;
      if (!sku) {
        // Contención: la tienda suele agregarle formato o presentación al
        // nombre. Se exige un mínimo de largo para no calzar por casualidad.
        const candidato = idx.lista.find((c) => c.n.length >= 8 && (n.includes(c.n) || c.n.includes(n)));
        sku = candidato?.sku || null;
      }
      it.sku = sku;
    }
  }

  /* Histórico estilo Knasta: para cada URL encontrada se leen las capturas
     previas (mínimo/máximo registrado y la más reciente) y luego se guarda la
     captura de hoy — como máximo una por producto por día. Todo best-effort:
     si la tabla no existe aún (migración pendiente), la búsqueda igual
     responde, solo que sin histórico. */
  private async adjuntarHistoricoYGuardar(q: string, items: Hallazgo[]) {
    if (!items.length) return;
    try {
      const client = this.supabase.getClient();
      const urls = [...new Set(items.map((i) => i.url))];
      // Web de Amsodent (2026-10-06): las capturas viejas quedaron con la URL de
      // WooCommerce (/product/<slug>/); se buscan también para no perder el histórico.
      const legado = (u: string) => {
        const m = u.match(/^(https:\/\/amsodentmedical\.cl)\/producto\/([^/?#]+)$/);
        return m ? `${m[1]}/product/${m[2]}/` : null;
      };
      const consulta = [...new Set([...urls, ...(urls.map(legado).filter(Boolean) as string[])])];
      const { data: previas, error } = await client
        .from('explorador_precios')
        .select('url, precio, capturado_at')
        .in('url', consulta)
        .order('capturado_at', { ascending: true })
        .limit(5000);
      if (error) throw new Error(error.message);

      const porUrl = new Map<string, Array<{ precio: number; capturado_at: string }>>();
      (previas || []).forEach((r: any) => {
        const arr = porUrl.get(r.url) || [];
        arr.push({ precio: Number(r.precio), capturado_at: r.capturado_at });
        porUrl.set(r.url, arr);
      });

      const hoy = new Date().toISOString().slice(0, 10);
      const nuevas: any[] = [];
      for (const it of items) {
        const viejo = legado(it.url);
        const prev = [...(porUrl.get(it.url) || []), ...((viejo && porUrl.get(viejo)) || [])].sort((a, b) =>
          String(a.capturado_at).localeCompare(String(b.capturado_at)),
        );
        if (prev.length) {
          const precios = prev.map((p) => p.precio);
          const ultima = prev[prev.length - 1];
          it.historico = {
            capturas: prev.length,
            precio_min: Math.min(...precios, it.precio),
            precio_max: Math.max(...precios, it.precio),
            anterior: { precio: ultima.precio, fecha: String(ultima.capturado_at).slice(0, 10) },
            variacion: it.precio - ultima.precio,
          };
        } else {
          it.historico = null;
        }
        const yaHoy = prev.some((p) => String(p.capturado_at).slice(0, 10) === hoy);
        if (!yaHoy) {
          nuevas.push({
            consulta: q.toLowerCase(),
            tienda: it.tienda,
            nombre: it.nombre.slice(0, 300),
            url: it.url,
            precio: it.precio,
            precio_normal: it.precio_normal,
          });
        }
      }
      if (nuevas.length) {
        const { error: errIns } = await client.from('explorador_precios').insert(nuevas);
        if (errIns) throw new Error(errIns.message);
      }
    } catch (e: any) {
      this.logger.warn(`Explorador: histórico no disponible: ${String(e?.message || e).slice(0, 140)}`);
      items.forEach((i) => { if (i.historico === undefined) i.historico = null; });
    }
  }
}
