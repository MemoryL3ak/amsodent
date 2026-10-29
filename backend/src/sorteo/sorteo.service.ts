import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

// Sorteos (2026-10-29): varios sorteos a la vez, cada uno con su QR y su
// formulario público /sorteo/<slug>. El formulario pide nombre, correo,
// si es estudiante de la universidad y en qué año va; el panel admin lista
// los participantes y elige al ganador al azar.

type RateEntry = { count: number; windowStart: number };

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_HITS = 8;

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');

const MSG_MIGRACION =
  'Falta aplicar la migración 20261029_sorteos_campanas.sql en Supabase (sorteos múltiples).';

// Espejo de ANIOS en src/pages/SorteoRegistro.jsx.
export const ANIOS = ['1° año', '2° año', '3° año', '4° año', '5° año', '6° año', 'Otro'];

const COLOR_DEFAULT = '#28aeb1';
const ACENTO_DEFAULT = '#f59e0b';

function sanitizeText(input: unknown, max = 255): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function colorValido(input: unknown, porDefecto: string): string {
  const c = sanitizeText(input, 9).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : porDefecto;
}

// "Sorteo Día del Odontólogo 2026" → "sorteo-dia-del-odontologo-2026"
export function slugify(texto: string): string {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function faltaMigracion(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  );
}

@Injectable()
export class SorteoService {
  private readonly rateMap = new Map<string, RateEntry>();

  constructor(private supabase: SupabaseService) {}

  private lanzar(error: any): never {
    if (faltaMigracion(error)) throw new BadRequestException(MSG_MIGRACION);
    throw new BadRequestException(error?.message || 'Error en la base de datos.');
  }

  private checkRateLimit(ip: string) {
    if (!ip) return;
    const now = Date.now();
    const entry = this.rateMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      this.rateMap.set(ip, { count: 1, windowStart: now });
      return;
    }
    if (entry.count >= RATE_MAX_HITS) {
      throw new HttpException(
        'Demasiados intentos desde esta red. Intenta nuevamente más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count += 1;
  }

  urlPublica(slug: string): string {
    return `${APP_URL}/sorteo/${encodeURIComponent(slug)}`;
  }

  private conUrl<T extends { slug: string }>(s: T) {
    return { ...s, url: this.urlPublica(s.slug) };
  }

  // ───────────────────────── PÚBLICO ─────────────────────────

  private readonly CAMPOS_PUBLICOS =
    'id, slug, titulo, subtitulo, premio, universidad, color, color_acento, activo';

  async publico(slug: string) {
    const limpio = sanitizeText(slug, 80).toLowerCase();
    if (!limpio) throw new NotFoundException('Sorteo no encontrado.');
    const { data, error } = await this.supabase
      .getClient()
      .from('sorteos')
      .select(this.CAMPOS_PUBLICOS)
      .eq('slug', limpio)
      .maybeSingle();
    if (error) this.lanzar(error);
    if (!data) throw new NotFoundException('Este sorteo no existe o el enlace está mal escrito.');
    return this.conUrl(data as any);
  }

  // El sorteo abierto más reciente: destino de /sorteo (sin slug) y de los QR antiguos.
  async publicoActivo() {
    const { data, error } = await this.supabase
      .getClient()
      .from('sorteos')
      .select(this.CAMPOS_PUBLICOS)
      .eq('activo', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.lanzar(error);
    if (!data) throw new NotFoundException('No hay ningún sorteo abierto en este momento.');
    return this.conUrl(data as any);
  }

  async registrar(body: Record<string, any>, ip: string, userAgent: string) {
    this.checkRateLimit(ip);

    const slug = sanitizeText(body?.slug, 80).toLowerCase();
    const nombre = sanitizeText(body?.nombre, 120);
    const email = sanitizeText(body?.email, 180).toLowerCase();
    const esEstudiante =
      body?.es_estudiante === true ? true : body?.es_estudiante === false ? false : null;
    const anioRaw = sanitizeText(body?.anio, 40);
    const anio = ANIOS.includes(anioRaw) ? anioRaw : '';
    const aceptaUsoDatos = body?.acepta_uso_datos === true;
    const aceptaComunicaciones = body?.acepta_comunicaciones === true;

    const faltantes: string[] = [];
    if (!slug) faltantes.push('sorteo');
    if (!nombre) faltantes.push('nombre');
    if (!email) faltantes.push('correo electrónico');
    if (esEstudiante === null) faltantes.push('si eres estudiante');
    if (esEstudiante === true && !anio) faltantes.push('en qué año vas');
    if (!aceptaUsoDatos) faltantes.push('autorización de uso de datos');
    if (faltantes.length > 0) {
      throw new BadRequestException(`Faltan o son inválidos: ${faltantes.join(', ')}.`);
    }
    if (!isValidEmail(email)) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }

    const client = this.supabase.getClient();
    const { data: sorteo, error: errSorteo } = await client
      .from('sorteos')
      .select('id, activo')
      .eq('slug', slug)
      .maybeSingle();
    if (errSorteo) this.lanzar(errSorteo);
    if (!sorteo) throw new NotFoundException('Este sorteo no existe o el enlace está mal escrito.');
    if (!sorteo.activo) {
      throw new BadRequestException('Las inscripciones de este sorteo ya cerraron.');
    }

    const { data, error } = await client
      .from('sorteo_participantes')
      .insert([
        {
          sorteo_id: sorteo.id,
          nombre,
          email,
          es_estudiante: esEstudiante,
          anio: esEstudiante ? anio : null,
          acepta_uso_datos: true,
          acepta_comunicaciones: aceptaComunicaciones,
          ip_origen: ip || null,
          user_agent: userAgent ? userAgent.slice(0, 400) : null,
        },
      ])
      .select('id, nombre')
      .single();

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate key') || msg.includes('unique') || (error as any).code === '23505') {
        throw new ConflictException(
          'Ya te encuentras registrado con este correo. ¡Ya estás participando!',
        );
      }
      this.lanzar(error);
    }

    return { id: data?.id, nombre: data?.nombre, ok: true };
  }

  // ───────────────────────── ADMIN: sorteos ─────────────────────────

  async listarSorteos() {
    const client = this.supabase.getClient();
    const { data: sorteos, error } = await client
      .from('sorteos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) this.lanzar(error);

    const { data: parts, error: errParts } = await client
      .from('sorteo_participantes')
      .select('sorteo_id, ganador, created_at');
    if (errParts) this.lanzar(errParts);

    const hoy = new Date().toISOString().slice(0, 10);
    const resumen = new Map<number, { participantes: number; ganadores: number; hoy: number }>();
    for (const p of parts || []) {
      const key = Number(p.sorteo_id);
      const r = resumen.get(key) || { participantes: 0, ganadores: 0, hoy: 0 };
      r.participantes += 1;
      if (p.ganador) r.ganadores += 1;
      if (String(p.created_at || '').slice(0, 10) === hoy) r.hoy += 1;
      resumen.set(key, r);
    }

    return (sorteos || []).map((s: any) => ({
      ...this.conUrl(s),
      ...(resumen.get(Number(s.id)) || { participantes: 0, ganadores: 0, hoy: 0 }),
    }));
  }

  private async slugLibre(base: string): Promise<string> {
    const client = this.supabase.getClient();
    const raiz = slugify(base) || 'sorteo';
    const { data, error } = await client
      .from('sorteos')
      .select('slug')
      .like('slug', `${raiz}%`);
    if (error) this.lanzar(error);
    const usados = new Set((data || []).map((r: any) => String(r.slug)));
    if (!usados.has(raiz)) return raiz;
    for (let i = 2; i < 1000; i++) {
      const cand = `${raiz}-${i}`;
      if (!usados.has(cand)) return cand;
    }
    return `${raiz}-${Date.now()}`;
  }

  private camposSorteo(body: Record<string, any>) {
    return {
      titulo: sanitizeText(body?.titulo, 120),
      subtitulo: sanitizeText(body?.subtitulo, 240) || null,
      premio: sanitizeText(body?.premio, 200) || null,
      universidad: sanitizeText(body?.universidad, 160) || null,
      color: colorValido(body?.color, COLOR_DEFAULT),
      color_acento: colorValido(body?.color_acento, ACENTO_DEFAULT),
    };
  }

  async crearSorteo(body: Record<string, any>, userId?: string) {
    const campos = this.camposSorteo(body);
    if (!campos.titulo) throw new BadRequestException('El sorteo necesita un título.');
    const slug = await this.slugLibre(sanitizeText(body?.slug, 80) || campos.titulo);

    const { data, error } = await this.supabase
      .getClient()
      .from('sorteos')
      .insert([{ ...campos, slug, activo: body?.activo === false ? false : true, created_by: userId || null }])
      .select('*')
      .single();
    if (error) this.lanzar(error);
    return { ...this.conUrl(data as any), participantes: 0, ganadores: 0, hoy: 0 };
  }

  // El slug NO se edita: los QR impresos apuntan a él.
  async actualizarSorteo(id: number, body: Record<string, any>) {
    const campos = this.camposSorteo(body);
    if (!campos.titulo) throw new BadRequestException('El sorteo necesita un título.');
    const cambios: Record<string, any> = { ...campos, updated_at: new Date().toISOString() };
    if (typeof body?.activo === 'boolean') cambios.activo = body.activo;

    const { data, error } = await this.supabase
      .getClient()
      .from('sorteos')
      .update(cambios)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) this.lanzar(error);
    if (!data) throw new NotFoundException('Sorteo no encontrado.');
    return this.conUrl(data as any);
  }

  // Borra el sorteo y, en cascada, sus participantes.
  async eliminarSorteo(id: number) {
    const { error } = await this.supabase.getClient().from('sorteos').delete().eq('id', id);
    if (error) this.lanzar(error);
    return { deleted: true };
  }

  // ───────────────────────── ADMIN: participantes ─────────────────────────

  async listarParticipantes(sorteoId?: number | null) {
    let query = this.supabase
      .getClient()
      .from('sorteo_participantes')
      .select('*')
      .order('created_at', { ascending: false });
    if (sorteoId) query = query.eq('sorteo_id', sorteoId);
    const { data, error } = await query;
    if (error) this.lanzar(error);
    return data;
  }

  async sortearGanador(sorteoId: number) {
    if (!sorteoId) throw new BadRequestException('Indica de qué sorteo elegir el ganador.');
    const client = this.supabase.getClient();

    // Solo entre quienes aceptaron el uso de datos y aún no han ganado.
    const { data: elegibles, error: errElig } = await client
      .from('sorteo_participantes')
      .select('id')
      .eq('sorteo_id', sorteoId)
      .eq('acepta_uso_datos', true)
      .eq('ganador', false);
    if (errElig) this.lanzar(errElig);
    if (!elegibles || elegibles.length === 0) {
      throw new NotFoundException('No hay participantes elegibles para sortear.');
    }

    // randomInt usa el generador criptográfico del sistema: un sorteo de verdad.
    const elegido = elegibles[randomInt(elegibles.length)];

    const { data, error } = await client
      .from('sorteo_participantes')
      .update({ ganador: true, fecha_ganador: new Date().toISOString() })
      .eq('id', elegido.id)
      .select('*')
      .single();
    if (error) this.lanzar(error);
    return data;
  }

  async resetGanadores(sorteoId: number) {
    if (!sorteoId) throw new BadRequestException('Indica el sorteo.');
    const { error } = await this.supabase
      .getClient()
      .from('sorteo_participantes')
      .update({ ganador: false, fecha_ganador: null })
      .eq('sorteo_id', sorteoId)
      .eq('ganador', true);
    if (error) this.lanzar(error);
    return { ok: true };
  }

  async eliminarParticipante(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('sorteo_participantes')
      .delete()
      .eq('id', id);
    if (error) this.lanzar(error);
    return { deleted: true };
  }
}
