import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ProductosService } from '../productos/productos.service';

/* ── Crear productos desde el Explorador de Precios (2026-10-07) ─────────────
   Pedido de Ariel: "crear un botón de creación de productos en el explorador
   de precios (solamente el explorador de Amsodent, el del portal cliente
   queda igual). Quedarían como producto transitorio porque no tendrán toda
   la información necesaria. Además se debe identificar cuando uno ya se
   encuentre creado porque será el mismo link de referencia".
   · Se crea en `productos` con estado «Transitorio», sin SKU, con nombre,
     categoría y formato (las únicas columnas obligatorias), marca, costo y
     listas si se indican, la imagen de la tienda (se descarga y se sube al
     bucket product-images, como hace la ficha) y el link del resultado en
     `link_referencia`. Pasa por ProductosService.create: el mismo freno de
     duplicados por nombre + marca + formato y la misma marca canónica.
   · "Ya creado" = algún producto tiene ese link en link_referencia. Los
     vendedores pegan links con ?srsltid=… (Google), con o sin www y con la
     barra final: se comparan normalizados (host sin www + ruta, sin query). */

export const CATEGORIAS_PRODUCTO = [
  'Prevención e Higiene', 'Consumibles', 'Blanqueamiento', 'Operatoria', 'Endodoncia', 'Periodoncia', 'Cirugía', 'Ortodoncia',
  'Equipos y Otros', 'Esterilización', 'Fresas y Pulido', 'Instrumental', 'Radiología', 'Impresión', 'Laboratorio', 'Insumos Médicos', 'Desinfección',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 AmsodentPortal/1.0 (+https://amsodent.cl)';
const IMAGEN_MAX = 5 * 1024 * 1024;
const EXT_IMAGEN: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** host sin www + ruta, sin protocolo, query, ancla ni barra final; en minúsculas. */
export function normalizarLink(url: any): string {
  const crudo = String(url ?? '').trim();
  if (!crudo) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(crudo) ? crudo : `https://${crudo}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const ruta = decodeURIComponent(u.pathname).replace(/\/+$/, '').toLowerCase();
    return `${host}${ruta}`;
  } catch {
    return crudo.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0].replace(/\/+$/, '');
  }
}

type Creado = { id: number; nombre: string; estado: string | null; sku: string | null };

const texto = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const monto = (v: any): number | null => {
  if (v == null || String(v).trim() === '') return null;
  const n = Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

@Injectable()
export class ExploradorProductosService {
  private readonly logger = new Logger(ExploradorProductosService.name);
  private cache: { ts: number; porLink: Map<string, Creado> } | null = null;

  constructor(
    private supabase: SupabaseService,
    private productos: ProductosService,
  ) {}

  /* Productos con link de referencia, por link normalizado (caché de 1 minuto;
     se borra al crear uno). Son ~900: se leen de a 1000. */
  private async porLink(): Promise<Map<string, Creado>> {
    if (this.cache && Date.now() - this.cache.ts < 60 * 1000) return this.cache.porLink;
    const db = this.supabase.getClient();
    const porLink = new Map<string, Creado>();
    for (let desde = 0; desde < 50000; desde += 1000) {
      const { data, error } = await db
        .from('productos')
        .select('id, nombre, estado, sku, link_referencia')
        .not('link_referencia', 'is', null)
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) { this.logger.warn(`No se pudieron leer los links de referencia: ${error.message}`); break; }
      for (const p of data || []) {
        const k = normalizarLink((p as any).link_referencia);
        // Si dos productos comparten link, manda el primero creado.
        if (k && !porLink.has(k)) porLink.set(k, { id: Number((p as any).id), nombre: (p as any).nombre, estado: (p as any).estado ?? null, sku: (p as any).sku ?? null });
      }
      if (!data || data.length < 1000) break;
    }
    this.cache = { ts: Date.now(), porLink };
    return porLink;
  }

  /* Marca en el resultado del explorador los que ya están creados. No toca el
     objeto original: el explorador lo guarda en su caché. */
  async anotar(resultado: any) {
    const items: any[] = Array.isArray(resultado?.items) ? resultado.items : [];
    if (!items.length) return resultado;
    const porLink = await this.porLink();
    return {
      ...resultado,
      items: items.map((it) => {
        const p = porLink.get(normalizarLink(it?.url));
        return p ? { ...it, producto_creado: p } : it;
      }),
    };
  }

  /* Baja la imagen de la tienda y la sube al bucket de productos. Si falla,
     el producto se crea igual, sin imagen, con un aviso. */
  private async subirImagen(url: string): Promise<{ path: string | null; aviso: string | null }> {
    if (!/^https?:\/\//i.test(url || '')) return { path: null, aviso: null };
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { path: null, aviso: `La imagen de la tienda no se pudo descargar (HTTP ${r.status}): súbela desde Productos.` };
      const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const ext = EXT_IMAGEN[tipo];
      if (!ext) return { path: null, aviso: 'La tienda no entregó una imagen JPG, PNG, WEBP o GIF: súbela desde Productos.' };
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length || buffer.length > IMAGEN_MAX) return { path: null, aviso: 'La imagen de la tienda pesa más de 5 MB: súbela desde Productos.' };
      const subida = await this.productos.uploadImage({ originalname: `explorador.${ext}`, buffer, mimetype: tipo } as any, '');
      return { path: subida.path, aviso: null };
    } catch (e: any) {
      return { path: null, aviso: `La imagen de la tienda no se pudo descargar (${e?.name === 'TimeoutError' ? 'tardó demasiado' : e?.message || e}): súbela desde Productos.` };
    }
  }

  async crear(usuario: { email?: string | null }, body: any) {
    const simular = body?.simular === true;
    const url = String(body?.url || '').trim();
    const problemas: { codigo: string; mensaje: string }[] = [];
    if (!/^https?:\/\/[^\s]+$/i.test(url)) problemas.push({ codigo: 'url', mensaje: 'Falta el link del producto en la tienda.' });
    const nombre = texto(body?.nombre, 200);
    if (nombre.length < 3) problemas.push({ codigo: 'nombre', mensaje: 'Escribe el nombre del producto.' });
    const categoria = texto(body?.categoria, 60);
    if (!CATEGORIAS_PRODUCTO.includes(categoria)) problemas.push({ codigo: 'categoria', mensaje: 'Elige la categoría.' });
    const formato = texto(body?.formato, 80);
    if (!formato) problemas.push({ codigo: 'formato', mensaje: 'Indica el formato (unidad, caja, frasco…).' });
    const marca = texto(body?.marca, 80) || null;
    const costo = monto(body?.costo);
    const lista1 = monto(body?.lista1);
    const lista2 = monto(body?.lista2);
    for (const [k, v, etiqueta] of [['costo', costo, 'El costo'], ['lista1', lista1, 'La lista 1'], ['lista2', lista2, 'La lista 2']] as const) {
      if (Number.isNaN(v)) problemas.push({ codigo: k, mensaje: `${etiqueta} debe ser un monto en pesos.` });
    }

    // ¿Ya existe un producto con este link?
    const existente = url ? (await this.porLink()).get(normalizarLink(url)) || null : null;
    if (existente) {
      return { ya_existe: true, producto: existente, problemas: [{ codigo: 'ya_existe', mensaje: `Ya está creado: «${existente.nombre}» (${existente.sku ? `SKU ${existente.sku}` : 'sin SKU'}, ${existente.estado || 'sin estado'}).` }] };
    }

    const fila: Record<string, any> = {
      sku: null, estado: 'Transitorio', nombre, marca, categoria, formato, link_referencia: url,
      ...(costo != null && !Number.isNaN(costo) ? { costo } : {}),
      ...(lista1 != null && !Number.isNaN(lista1) ? { lista1 } : {}),
      ...(lista2 != null && !Number.isNaN(lista2) ? { lista2 } : {}),
      creado_por: usuario?.email || null,
    };
    const avisos: string[] = [];
    if (!(lista1 && lista1 > 0) || !(lista2 && lista2 > 0)) avisos.push('Sin precio de lista: complétalo en Productos antes de cotizarlo.');
    if (!(costo && costo > 0)) avisos.push('Sin costo: el margen de la cotización no se podrá calcular hasta completarlo.');
    if (problemas.length) return { simulacion: simular, bloqueada: true, problemas, avisos };
    if (simular) return { simulacion: true, problemas, avisos, producto: fila, imagen: body?.imagen || null };

    let creado: any;
    try {
      creado = await this.productos.create({ ...fila, ...(body?.permitir_duplicado === true ? { permitir_duplicado: true } : {}) });
    } catch (e: any) {
      const msg = String(e?.response?.message || e?.message || e);
      if (/^DUPLICADO/.test(msg)) return { duplicado: true, problemas: [{ codigo: 'duplicado', mensaje: msg.replace(/^DUPLICADO:\s*/, '') }], avisos };
      throw new BadRequestException(msg);
    }
    this.cache = null;
    // La imagen va después de crear: si el freno de duplicados lo detiene, no queda una imagen huérfana en el bucket.
    const img = await this.subirImagen(String(body?.imagen || ''));
    if (img.aviso) avisos.push(img.aviso);
    if (img.path && creado?.id) {
      const { error } = await this.supabase.getClient().from('productos').update({ imagen_url: img.path }).eq('id', Number(creado.id));
      if (error) avisos.push(`El producto quedó creado, pero sin imagen (${error.message}): súbela desde Productos.`);
    }
    this.logger.log(`Explorador: producto transitorio #${creado?.id} «${nombre}» desde ${url} por ${usuario?.email}`);
    return { creado: true, producto: { id: Number(creado?.id), nombre: creado?.nombre ?? nombre, estado: creado?.estado ?? 'Transitorio', sku: null }, avisos };
  }
}
