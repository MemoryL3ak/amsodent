import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ── Explorador de precios dentales del portal de clientes (2026-09-04) ──
   Estilo Knasta/SoloTodo: el cliente busca una palabra clave y el backend
   consulta EN VIVO las tiendas dentales chilenas con API pública de búsqueda
   (Shopify: /search/suggest.json · WooCommerce: Store API /wc/store/v1),
   normaliza los resultados y guarda una captura diaria por producto en
   `explorador_precios` para construir el histórico (mínimo registrado y
   variación contra la captura anterior).

   Cortesía con las tiendas: 1 petición por tienda por búsqueda, timeout de
   8 s, User-Agent identificable y caché en memoria de 10 minutos por
   consulta (búsquedas repetidas no vuelven a golpear los sitios). */

const TIENDAS: Array<{ id: string; nombre: string; tipo: 'shopify' | 'woo'; base: string }> = [
  { id: 'orbisdental', nombre: 'Orbis Dental', tipo: 'shopify', base: 'https://www.orbisdental.cl' },
  { id: 'gexachile', nombre: 'Gexa Chile', tipo: 'shopify', base: 'https://gexachile.cl' },
  { id: 'spdental', nombre: 'SP Dental', tipo: 'shopify', base: 'https://spdental.shop' },
  { id: 'clandent', nombre: 'Clandent', tipo: 'woo', base: 'https://clandent.cl' },
  { id: 'jdent', nombre: 'J-Dent', tipo: 'woo', base: 'https://www.j-dent.cl' },
  { id: 'techdent', nombre: 'Techdent', tipo: 'woo', base: 'https://techdent.cl' },
  { id: 'denteeth', nombre: 'Denteeth', tipo: 'woo', base: 'https://denteeth.cl' },
];

const UA =
  'Mozilla/5.0 (compatible; AmsodentPortal/1.0; +https://amsodent.cl) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const TIMEOUT_MS = 8000;
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
  historico?: {
    capturas: number;
    precio_min: number;
    precio_max: number;
    anterior: { precio: number; fecha: string } | null;
    variacion: number | null; // precio actual − captura anterior
  } | null;
};

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

  constructor(private supabase: SupabaseService) {}

  async buscar(qRaw: string) {
    const q = String(qRaw || '').trim().slice(0, 60);
    if (q.length < 3) throw new BadRequestException('Escribe al menos 3 letras para buscar.');

    const key = q.toLowerCase();
    const enCache = this.cache.get(key);
    if (enCache && Date.now() - enCache.ts < CACHE_MS) return enCache.data;

    const porTienda = await Promise.all(
      TIENDAS.map((t) =>
        this.buscarEnTienda(t, q).catch((e) => {
          this.logger.warn(`Explorador: ${t.id} falló para "${q}": ${String(e?.message || e).slice(0, 120)}`);
          return { items: [] as Hallazgo[], error: true };
        }),
      ),
    );

    const items = porTienda.flatMap((r) => r.items);
    const tiendasCaidas = TIENDAS.filter((_, i) => (porTienda[i] as any).error).map((t) => t.nombre);

    await this.adjuntarHistoricoYGuardar(q, items);
    items.sort((a, b) => a.precio - b.precio);

    const data = {
      consulta: q,
      total: items.length,
      tiendas_consultadas: TIENDAS.map((t) => t.nombre),
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

  private async fetchJson(url: string): Promise<any> {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  private async buscarEnTienda(t: (typeof TIENDAS)[number], q: string): Promise<{ items: Hallazgo[] }> {
    const enc = encodeURIComponent(q);
    if (t.tipo === 'shopify') {
      const json = await this.fetchJson(
        `${t.base}/search/suggest.json?q=${enc}&resources%5Btype%5D=product&resources%5Blimit%5D=${MAX_POR_TIENDA}`,
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
    // WooCommerce Store API (pública, sin credenciales).
    const json = await this.fetchJson(`${t.base}/wp-json/wc/store/v1/products?search=${enc}&per_page=${MAX_POR_TIENDA}`);
    const productos: any[] = Array.isArray(json) ? json : [];
    return {
      items: productos
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
          };
        })
        .filter(Boolean) as Hallazgo[],
    };
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
      const { data: previas, error } = await client
        .from('explorador_precios')
        .select('url, precio, capturado_at')
        .in('url', urls)
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
        const prev = porUrl.get(it.url) || [];
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
