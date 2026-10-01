import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Campañas de margen por marca y categoría (2026-10-01)
   ----------------------------------------------------------------------------
   Las campañas que ya existían fijan un precio producto por producto. Para
   mover una marca o una categoría entera había que cargar cientos de SKUs a
   mano, y volver a hacerlo cada vez que cambiaba un costo.

   Una campaña de margen guarda solo la REGLA: "a los productos de estas marcas
   y/o categorías, en esta lista de precios, véndelos con este margen, entre
   estas fechas". El precio no se guarda: se calcula al cotizar desde el costo
   vigente del producto,

       precio = costo / (1 − margen)        (margen sobre el precio de venta,
                                             el mismo que mide la cotización)

   así que el catálogo no se reescribe, y al terminar la vigencia vuelve solo
   el precio de lista. El cálculo vive en el frontend (src/lib/campanasMargen.js)
   porque es donde está el producto con su costo al momento de cotizar; acá
   solo se guardan y validan las reglas.
============================================================================ */

const MIGRACION = 'Falta aplicar la migración 20261001_lote_octubre.sql en Supabase.';
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

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

function listaLimpia(v: any): string[] {
  return [
    ...new Set<string>(
      (Array.isArray(v) ? v : [])
        .map((x: any) => String(x ?? '').trim())
        .filter(Boolean),
    ),
  ];
}

@Injectable()
export class CampanasMargenService {
  constructor(private supabase: SupabaseService) {}

  private sinTabla(error: any): boolean {
    const msg = String(error?.message || '');
    return /campanas_margen/i.test(msg) && /(schema cache|does not exist|not find)/i.test(msg);
  }

  /** Todas las campañas, de la más nueva a la más antigua. */
  async listar() {
    const { data, error } = await this.supabase
      .getClient()
      .from('campanas_margen')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      if (this.sinTabla(error)) return [];
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  /* Las que mandan HOY: activas y dentro de su vigencia. Es lo que consultan
     las pantallas de cotización; por eso un problema acá responde vacío en vez
     de romper la cotización (queda el precio de lista). */
  async vigentes() {
    const hoy = hoyEnChile();
    const { data, error } = await this.supabase
      .getClient()
      .from('campanas_margen')
      .select('id, nombre, lista_precios, marcas, categorias, margen_pct, desde, hasta, created_at')
      .eq('activa', true)
      .lte('desde', hoy)
      .gte('hasta', hoy)
      .order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  }

  private datos(body: any) {
    const nombre = String(body?.nombre || '').trim().slice(0, 120);
    if (!nombre) throw new BadRequestException('La campaña necesita un nombre.');

    const lista = Number(body?.lista_precios);
    if (![1, 2, 3].includes(lista)) throw new BadRequestException('Elige la lista de precios (1, 2 o 3).');

    const margen = Number(body?.margen_pct);
    if (!Number.isFinite(margen) || margen < 0 || margen >= 95) {
      throw new BadRequestException('El margen debe estar entre 0 y 94,99 %.');
    }

    const desde = String(body?.desde || '').slice(0, 10);
    const hasta = String(body?.hasta || '').slice(0, 10);
    if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta)) {
      throw new BadRequestException('Indica las fechas de inicio y término.');
    }
    if (hasta < desde) throw new BadRequestException('La fecha de término no puede ser anterior al inicio.');

    return {
      nombre,
      descripcion: String(body?.descripcion || '').trim().slice(0, 400) || null,
      lista_precios: lista,
      marcas: listaLimpia(body?.marcas),
      categorias: listaLimpia(body?.categorias),
      margen_pct: Math.round(margen * 100) / 100,
      desde,
      hasta,
      activa: body?.activa !== false,
    };
  }

  private error(error: any): never {
    if (this.sinTabla(error)) throw new BadRequestException(MIGRACION);
    throw new BadRequestException(String(error?.message || 'No se pudo guardar la campaña.'));
  }

  async crear(body: any, creadorEmail?: string | null) {
    const { data, error } = await this.supabase
      .getClient()
      .from('campanas_margen')
      .insert({ ...this.datos(body), creado_por: creadorEmail || null })
      .select()
      .single();
    if (error) this.error(error);
    return data;
  }

  async actualizar(id: number, body: any) {
    const { data, error } = await this.supabase
      .getClient()
      .from('campanas_margen')
      .update({ ...this.datos(body), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Campaña no encontrada.');
    return data;
  }

  /** Pausar o reanudar sin tocar el resto de la regla. */
  async activar(id: number, activa: boolean) {
    const { data, error } = await this.supabase
      .getClient()
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
    const { error } = await this.supabase.getClient().from('campanas_margen').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }
}
