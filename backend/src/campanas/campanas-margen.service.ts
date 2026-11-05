import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Campañas de margen por marca y categoría (2026-10-01)
   ----------------------------------------------------------------------------
   Las campañas que ya existían fijan un precio producto por producto. Para
   mover una marca o una categoría entera había que cargar cientos de SKUs a
   mano, y volver a hacerlo cada vez que cambiaba un costo.

   Una campaña de margen guarda solo la REGLA: "a los productos de estas marcas
   y/o categorías, en esta lista de precios, véndelos con este descuento, entre
   estas fechas". El precio no se guarda: se calcula al cotizar desde el precio
   de lista vigente del producto (desde 2026-10-07 el % es un descuento sobre
   el precio de lista), así que el catálogo no se reescribe, y al terminar la
   vigencia vuelve solo el precio de lista. El cálculo vive en el frontend
   (src/lib/campanasMargen.js) porque es donde está el producto al momento de
   cotizar; acá solo se guardan y validan las reglas.

   (2026-11-05) Un solo módulo de campañas (pedido de Ariel):
   · «Eliminar módulo Campañas (queda solamente Campañas de margen)»: las
     campañas por producto con precio fijo (product_campaigns) ya no existen.
   · «La campaña de portal Amsodent y portal cliente se deben gestionar desde
     el único módulo»: cada campaña tiene un CANAL — `plataforma` (cotizar en
     la plataforma), `portal` (la pestaña «Ofertas» del portal del cliente) o
     `ambos`. Las «Ofertas del Portal» dejaron de ser un módulo aparte: el
     portal lee de aquí (OfertasPortalService).
   · «Fecha de vigencia y límite de productos… puede finalizar antes de la
     fecha si los productos llegan a la capacidad máxima declarada… cada venta
     realizada va sumando este contador»: `limite_unidades` es el cupo total
     de la campaña. Las unidades vendidas se CUENTAN (no se guardan): son las
     de las líneas de cotizaciones ADJUDICADAS que se vendieron con la campaña
     (items_licitacion.campana_margen_id). Al llegar al cupo la campaña queda
     «agotada» y deja de aplicar, aunque su fecha no haya vencido; si una
     venta se revierte, el contador baja solo.
   Columnas nuevas: migración 20261105_campanas_unificadas.
============================================================================ */

const MIGRACION = 'Falta aplicar la migración 20261001_lote_octubre.sql en Supabase.';
const MIGRACION_SKUS = 'Falta aplicar la migración 20261003_campanas_margen_skus.sql en Supabase (campañas por SKU).';
// (2026-10-14) Productos desmarcados sin su columna: se guarda igual y se avisa.
const AVISO_EXCLUIDOS = 'Falta aplicar la migración 20261014_campanas_margen_excluidos.sql en Supabase: la campaña quedó SIN productos desmarcados (aplica a todos los que alcanza).';
const MIGRACION_UNIFICADAS = 'Falta aplicar la migración 20261105_campanas_unificadas.sql en Supabase: sin ella una campaña no puede ser del portal del cliente ni tener cupo de unidades.';
const MAX_SKUS = 2000;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const CANALES = ['plataforma', 'portal', 'ambos'] as const;
export type CanalCampana = (typeof CANALES)[number];

/** Fecha de hoy en Chile (YYYY-MM-DD): la vigencia se decide con el día local. */
export function hoyEnChile(ahora = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
  return p; // en-CA ya entrega YYYY-MM-DD
}

// SKUs: sin espacios y en mayúsculas, como están en el catálogo.
function listaSkus(v: any): string[] {
  const lista = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/);
  return [...new Set<string>(lista.map((x: any) => String(x ?? '').trim().toUpperCase()).filter(Boolean))].slice(0, MAX_SKUS);
}

function listaLimpia(v: any): string[] {
  return [
    ...new Set<string>(
      (Array.isArray(v) ? v : [])
        .map((x: any) => String(x ?? '').trim())
        .filter(Boolean),
    ),
  ];
}

/* Canal de una campaña: las anteriores a la migración no traen la columna y
   son de la plataforma. */
export function canalDe(campana: any): CanalCampana {
  const c = String(campana?.canal || '').trim().toLowerCase();
  return (CANALES as readonly string[]).includes(c) ? (c as CanalCampana) : 'plataforma';
}

/* ¿La campaña rige en ese canal? */
export function rigeEnCanal(campana: any, canal: 'plataforma' | 'portal'): boolean {
  const c = canalDe(campana);
  return c === 'ambos' || c === canal;
}

/* Cupo de la campaña: null = sin límite. */
export function cupoDe(campana: any): number | null {
  const n = Number(campana?.limite_unidades);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/* ¿Se agotó el cupo? (con cupo y las unidades vendidas lo alcanzaron) */
export function agotada(campana: any, vendidas: number): boolean {
  const cupo = cupoDe(campana);
  return cupo !== null && Number(vendidas || 0) >= cupo;
}

@Injectable()
export class CampanasMargenService {
  private readonly logger = new Logger(CampanasMargenService.name);

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    const msg = String(error?.message || '');
    return /campanas_margen/i.test(msg) && /(schema cache|does not exist|not find)/i.test(msg);
  }

  /* ── Contador de ventas ───────────────────────────────────────────────────
     Unidades vendidas por campaña = cantidad de las líneas que se vendieron
     con ella (items_licitacion.campana_margen_id) en cotizaciones que están
     Adjudicadas. Sin la migración (columna ausente) nadie ha vendido «por
     campaña»: todo en 0. */
  async unidadesVendidas(ids: number[]): Promise<Map<number, number>> {
    const vendidas = new Map<number, number>();
    const lista = [...new Set(ids.map(Number).filter((n) => n > 0))];
    if (!lista.length) return vendidas;
    const lineas: any[] = [];
    for (let desde = 0; desde < 50_000; desde += 1000) {
      const { data, error } = await this.db
        .from('items_licitacion')
        .select('id, licitacion_id, cantidad, campana_margen_id')
        .in('campana_margen_id', lista)
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) {
        if (!/campana_margen_id|42703|schema cache/i.test(`${error.code} ${error.message}`)) this.logger.warn(`Unidades vendidas por campaña: ${error.message}`);
        return vendidas;
      }
      lineas.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    if (!lineas.length) return vendidas;
    const licIds = [...new Set(lineas.map((l) => Number(l.licitacion_id)).filter(Boolean))];
    const adjudicadas = new Set<number>();
    for (let i = 0; i < licIds.length; i += 300) {
      const { data, error } = await this.db.from('licitaciones').select('id, estado').in('id', licIds.slice(i, i + 300));
      if (error) {
        this.logger.warn(`Unidades vendidas por campaña (cotizaciones): ${error.message}`);
        return new Map();
      }
      for (const l of (data || []) as any[]) {
        if (String(l?.estado || '').toLowerCase().includes('adjudicada')) adjudicadas.add(Number(l.id));
      }
    }
    for (const l of lineas) {
      if (!adjudicadas.has(Number(l.licitacion_id))) continue;
      const id = Number(l.campana_margen_id);
      vendidas.set(id, (vendidas.get(id) || 0) + (Number(l.cantidad) || 0));
    }
    return vendidas;
  }

  private conCupo(campana: any, vendidas: Map<number, number>) {
    const cupo = cupoDe(campana);
    const v = vendidas.get(Number(campana.id)) || 0;
    return {
      ...campana,
      canal: canalDe(campana),
      limite_unidades: cupo,
      unidades_vendidas: v,
      unidades_disponibles: cupo === null ? null : Math.max(0, cupo - v),
      agotada: agotada(campana, v),
    };
  }

  /** Todas las campañas, de la más nueva a la más antigua, con su canal y su cupo. */
  async listar() {
    const { data, error } = await this.db
      .from('campanas_margen')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      if (this.sinTabla(error)) return [];
      throw new BadRequestException(error.message);
    }
    const filas = (data || []) as any[];
    const vendidas = await this.unidadesVendidas(filas.map((c) => c.id));
    return filas.map((c) => this.conCupo(c, vendidas));
  }

  /* Las que mandan HOY en un canal: activas, dentro de su vigencia y con cupo
     disponible. Es lo que consultan las pantallas de cotización (canal
     `plataforma`) y la vitrina del portal (canal `portal`); por eso un
     problema acá responde vacío en vez de romper la cotización (queda el
     precio de lista). De la más nueva a la más antigua. */
  async vigentes(canal: 'plataforma' | 'portal' = 'plataforma') {
    const hoy = hoyEnChile();
    const { data, error } = await this.db
      .from('campanas_margen')
      .select('*')
      .eq('activa', true)
      .lte('desde', hoy)
      .gte('hasta', hoy)
      .order('created_at', { ascending: false });
    if (error) return [];
    const filas = ((data || []) as any[]).filter((c) => rigeEnCanal(c, canal));
    if (!filas.length) return [];
    // Solo se cuentan las ventas de las que tienen cupo: las demás no se agotan.
    const vendidas = await this.unidadesVendidas(filas.filter((c) => cupoDe(c) !== null).map((c) => c.id));
    return filas
      .map((c) => this.conCupo(c, vendidas))
      .filter((c) => !c.agotada)
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        descripcion: c.descripcion ?? null,
        canal: c.canal,
        lista_precios: c.lista_precios,
        marcas: Array.isArray(c.marcas) ? c.marcas : [],
        categorias: Array.isArray(c.categorias) ? c.categorias : [],
        skus: Array.isArray(c.skus) ? c.skus : [],
        skus_excluidos: Array.isArray(c.skus_excluidos) ? c.skus_excluidos : [],
        margen_pct: c.margen_pct,
        desde: c.desde,
        hasta: c.hasta,
        created_at: c.created_at,
        limite_unidades: c.limite_unidades,
        unidades_vendidas: c.unidades_vendidas,
        unidades_disponibles: c.unidades_disponibles,
      }));
  }

  private datos(body: any) {
    const nombre = String(body?.nombre || '').trim().slice(0, 120);
    if (!nombre) throw new BadRequestException('La campaña necesita un nombre.');

    const canal = String(body?.canal || 'plataforma').trim().toLowerCase();
    if (!(CANALES as readonly string[]).includes(canal)) {
      throw new BadRequestException('Elige dónde aplica la campaña: plataforma, portal del cliente o ambos.');
    }

    // En el portal el descuento va sobre el precio del cliente del portal
    // (lista 2), no sobre una lista elegida: la campaña solo-portal queda en 2.
    const lista = canal === 'portal' ? 2 : Number(body?.lista_precios);
    if (![1, 2, 3].includes(lista)) throw new BadRequestException('Elige la lista de precios (1, 2 o 3).');

    const margen = Number(body?.margen_pct);
    if (!Number.isFinite(margen) || margen < 0 || margen >= 95) {
      // (2026-10-07) El % es un descuento sobre el precio de lista (columna margen_pct).
      throw new BadRequestException('El descuento debe estar entre 0 y 94,99 %.');
    }
    if (canal !== 'plataforma' && !(margen > 0)) {
      throw new BadRequestException('Una campaña del portal del cliente necesita un descuento mayor que 0 %.');
    }

    const desde = String(body?.desde || '').slice(0, 10);
    const hasta = String(body?.hasta || '').slice(0, 10);
    if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta)) {
      throw new BadRequestException('Indica las fechas de inicio y término.');
    }
    if (hasta < desde) throw new BadRequestException('La fecha de término no puede ser anterior al inicio.');

    // Cupo: vacío = sin límite. Si viene, es un entero de 1 o más unidades.
    const crudo = body?.limite_unidades;
    let limite: number | null = null;
    if (crudo !== undefined && crudo !== null && String(crudo).trim() !== '') {
      const n = Number(String(crudo).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 1 || n > 100_000_000 || Math.floor(n) !== n) {
        throw new BadRequestException('El límite de unidades debe ser un número entero de 1 o más (déjalo vacío para no limitar).');
      }
      limite = n;
    }

    return {
      nombre,
      descripcion: String(body?.descripcion || '').trim().slice(0, 400) || null,
      lista_precios: lista,
      marcas: listaLimpia(body?.marcas),
      categorias: listaLimpia(body?.categorias),
      skus: listaSkus(body?.skus),
      // (2026-10-14) Productos desmarcados en la vista previa: no reciben el descuento.
      skus_excluidos: listaSkus(body?.skus_excluidos),
      margen_pct: Math.round(margen * 100) / 100,
      desde,
      hasta,
      activa: body?.activa !== false,
      canal,
      limite_unidades: limite,
    };
  }

  /* (2026-10-14) Sin la migración de desmarcados, la campaña se guarda igual
     sin esa lista (aplica a todos los que alcanza) y se avisa. */
  private sinExcluidos(error: any): boolean {
    const msg = String(error?.message || '');
    return /skus_excluidos/i.test(msg) && /(schema cache|column|not find)/i.test(msg);
  }

  /* (2026-11-05) Sin la migración de campañas unificadas no existen `canal` ni
     `limite_unidades`. */
  private sinUnificadas(error: any): boolean {
    const msg = String(error?.message || '');
    return /(canal|limite_unidades)/i.test(msg) && /(schema cache|column|not find)/i.test(msg);
  }

  private error(error: any): never {
    // El mensaje de Supabase nombra la tabla también cuando lo que falta es
    // una columna: las columnas se revisan antes que la tabla entera.
    if (this.sinUnificadas(error)) throw new BadRequestException(MIGRACION_UNIFICADAS);
    if (/skus/i.test(String(error?.message || '')) && /(schema cache|column|not find)/i.test(String(error?.message || ''))) {
      throw new BadRequestException(MIGRACION_SKUS);
    }
    if (this.sinTabla(error)) throw new BadRequestException(MIGRACION);
    throw new BadRequestException(String(error?.message || 'No se pudo guardar la campaña.'));
  }

  /* Escribe la campaña tolerando las migraciones pendientes: sin la de
     desmarcados se guarda sin esa lista (y se avisa); sin la de campañas
     unificadas solo se puede guardar una campaña de la plataforma sin cupo
     (lo que ya existía). */
  private async escribir(datos: Record<string, any>, ejecutar: (fila: Record<string, any>) => any) {
    let fila = { ...datos };
    let aviso: string | null = null;
    let { data, error } = await ejecutar(fila);
    for (let intento = 0; error && intento < 2; intento++) {
      if (this.sinUnificadas(error)) {
        if (datos.canal !== 'plataforma' || datos.limite_unidades !== null) throw new BadRequestException(MIGRACION_UNIFICADAS);
        const { canal: _c, limite_unidades: _l, ...resto } = fila;
        fila = resto;
      } else if (this.sinExcluidos(error)) {
        const { skus_excluidos: _e, ...resto } = fila;
        fila = resto;
        aviso = AVISO_EXCLUIDOS;
      } else break;
      ({ data, error } = await ejecutar(fila));
    }
    if (error) this.error(error);
    if (data && aviso) data.aviso = aviso;
    return data;
  }

  async crear(body: any, creadorEmail?: string | null) {
    const datos = this.datos(body);
    return this.escribir({ ...datos, creado_por: creadorEmail || null }, (fila) =>
      this.db.from('campanas_margen').insert(fila).select().single(),
    );
  }

  async actualizar(id: number, body: any) {
    const datos = this.datos(body);
    const data = await this.escribir({ ...datos, updated_at: new Date().toISOString() }, (fila) =>
      this.db.from('campanas_margen').update(fila).eq('id', id).select().maybeSingle(),
    );
    if (!data) throw new NotFoundException('Campaña no encontrada.');
    return data;
  }

  /** Pausar o reanudar sin tocar el resto de la regla. */
  async activar(id: number, activa: boolean) {
    const { data, error } = await this.db
      .from('campanas_margen')
      .update({ activa, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Campaña no encontrada.');
    return data;
  }

  async eliminar(id: number) {
    const { error } = await this.db.from('campanas_margen').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }
}
