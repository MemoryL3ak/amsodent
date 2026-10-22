import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Cola de trabajos de Mercado Público (2026-10-21)
   ----------------------------------------------------------------------------
   Capa fina sobre la tabla `mp_cola` y sus funciones SQL (migración
   20261021_mp_cola). Las pantallas y los crons ENCOLAN; el robot
   (MpRobotService, solo en APP_ROL=worker o todo) TOMA y TERMINA.

   Tipos de trabajo y su clave (única mientras el trabajo esté vivo):
     ficha        clave = id de la cotización interna → consulta la ficha del
                  proceso en Mercado Público y la guarda en mp_resultados.
     estado       clave = id de la cotización → compara su estado con el que
                  publica Mercado Público (diagnóstico; aplicar es aparte).
     postulacion  clave = id de la postulación (licitaciones_disponibles) →
                  confirma si nuestro RUT figura entre los oferentes.
     exploracion  clave = 'unica' → corre la búsqueda del explorador con todo
                  el catálogo de palabras clave y guarda mp_exploracion.
     analisis_global  clave = 'unica' → análisis global de productos
                  adjudicados en todo Mercado Público (mp_analisis_productos).
============================================================================ */

export type TipoTrabajo = 'ficha' | 'estado' | 'postulacion' | 'exploracion' | 'analisis_global';

export interface TrabajoNuevo {
  tipo: TipoTrabajo;
  clave: string | number;
  payload?: Record<string, any>;
  prioridad?: number;
  /** Cuántas veces se intenta antes de quedar con error (default 6). */
  max_intentos?: number;
}

export interface Trabajo {
  id: number;
  tipo: TipoTrabajo;
  clave: string;
  payload: any;
  lote: string | null;
  estado: string;
  prioridad: number;
  intentos: number;
  max_intentos: number;
  proximo_intento_at: string;
  ultimo_error: string | null;
  resultado: any;
  solicitado_por: string | null;
  created_at: string;
}

const FALTA_MIGRACION = 'Falta aplicar la migración 20261021_mp_cola.sql en Supabase.';

@Injectable()
export class MpColaService {
  private readonly log = new Logger('MpCola');

  constructor(private readonly supabase: SupabaseService) {}

  private traducir(error: any): never {
    const msg = String(error?.message || error);
    throw new BadRequestException(/does not exist|schema cache|function .* not/i.test(msg) ? FALTA_MIGRACION : msg);
  }

  /** Encola varios trabajos bajo un mismo lote. Devuelve el lote y cuántos entraron
   *  (los que ya estaban pendientes o en curso se omiten: la clave es única). */
  async encolar(items: TrabajoNuevo[], opts: { lote?: string; solicitadoPor?: string | null } = {}) {
    const lote = opts.lote || randomUUID();
    if (!items.length) return { lote, encolados: 0, omitidos: 0 };
    const client = this.supabase.getClient();
    let encolados = 0;
    // De a 500 para que el JSON del RPC no crezca sin control.
    for (let i = 0; i < items.length; i += 500) {
      const tanda = items.slice(i, i + 500).map((t) => ({
        tipo: t.tipo,
        clave: String(t.clave),
        payload: t.payload || {},
        lote,
        prioridad: t.prioridad ?? 5,
        max_intentos: t.max_intentos ?? 6,
        solicitado_por: opts.solicitadoPor || null,
      }));
      const { data, error } = await client.rpc('mp_cola_encolar', { p_items: tanda });
      if (error) this.traducir(error);
      encolados += Number(data) || 0;
    }
    return { lote, encolados, omitidos: items.length - encolados };
  }

  /** Toma hasta `n` trabajos pendientes (los marca en_curso). Solo el robot. */
  async tomar(n: number, tipos?: TipoTrabajo[]): Promise<Trabajo[]> {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('mp_cola_tomar', { p_n: n, p_tipos: tipos?.length ? tipos : null });
    if (error) this.traducir(error);
    return (data || []) as Trabajo[];
  }

  async terminar(id: number, resultado: any) {
    const { error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .update({ estado: 'hecho', resultado: resultado ?? null, ultimo_error: null, terminado_at: new Date().toISOString() })
      .eq('id', id);
    if (error) this.log.warn(`No se pudo cerrar el trabajo #${id}: ${error.message}`);
  }

  /** Devuelve el trabajo a la cola para más tarde (sin contar como agotado). */
  async reprogramar(id: number, enMs: number, motivo: string, opts: { descontarIntento?: boolean } = {}) {
    const client = this.supabase.getClient();
    const patch: any = {
      estado: 'pendiente',
      proximo_intento_at: new Date(Date.now() + Math.max(0, enMs)).toISOString(),
      ultimo_error: String(motivo || '').slice(0, 300),
    };
    if (opts.descontarIntento) {
      // La cuota agotada no es culpa del trabajo: no le cuenta el intento.
      const { data } = await client.from('mp_cola').select('intentos').eq('id', id).maybeSingle();
      patch.intentos = Math.max(0, Number((data as any)?.intentos || 1) - 1);
    }
    const { error } = await client.from('mp_cola').update(patch).eq('id', id);
    if (error) this.log.warn(`No se pudo reprogramar el trabajo #${id}: ${error.message}`);
  }

  async fallar(id: number, motivo: string) {
    const { error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .update({ estado: 'error', ultimo_error: String(motivo || '').slice(0, 300), terminado_at: new Date().toISOString() })
      .eq('id', id);
    if (error) this.log.warn(`No se pudo marcar con error el trabajo #${id}: ${error.message}`);
  }

  /** Avance de un lote; sin lote, el activo más reciente (opcionalmente de un tipo). */
  async resumen(lote?: string | null, tipo?: TipoTrabajo | string | null) {
    const { data, error } = await this.supabase
      .getClient()
      .rpc('mp_cola_resumen', { p_lote: lote || null, p_tipo: lote ? null : (tipo || null) });
    if (error) this.traducir(error);
    return (data || { lote: null, total: 0 }) as any;
  }

  /** Los trabajos de un lote con su resultado (para las tablas de diagnóstico). */
  async trabajosDeLote(lote: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .select('id, tipo, clave, estado, intentos, ultimo_error, resultado, created_at, terminado_at')
      .eq('lote', lote)
      .order('id', { ascending: true })
      .range(0, 1999);
    if (error) this.traducir(error);
    return data || [];
  }

  /** Cancela lo pendiente de un lote (lo en curso termina solo). */
  async cancelarLote(lote: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .update({ estado: 'cancelado', terminado_at: new Date().toISOString() })
      .eq('lote', lote)
      .eq('estado', 'pendiente')
      .select('id');
    if (error) this.traducir(error);
    return { cancelados: (data || []).length };
  }

  /** Cuántos trabajos vivos hay por tipo (para el panel). */
  async pendientesPorTipo() {
    const { data, error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .select('tipo, estado')
      .in('estado', ['pendiente', 'en_curso'])
      .range(0, 9999);
    if (error) this.traducir(error);
    const porTipo: Record<string, { pendientes: number; en_curso: number }> = {};
    for (const r of (data || []) as any[]) {
      const t = porTipo[r.tipo] || (porTipo[r.tipo] = { pendientes: 0, en_curso: 0 });
      if (r.estado === 'en_curso') t.en_curso += 1; else t.pendientes += 1;
    }
    return porTipo;
  }

  /** Trabajos que quedaron en_curso de un proceso que murió: vuelven a pendiente. */
  async rescatarHuerfanos(masViejosQueMs: number) {
    const corte = new Date(Date.now() - masViejosQueMs).toISOString();
    const { data, error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .update({ estado: 'pendiente', ultimo_error: 'reiniciado: el proceso se cayó a mitad del trabajo' })
      .eq('estado', 'en_curso')
      .lt('iniciado_at', corte)
      .select('id');
    if (error) { this.log.warn(`No se pudieron rescatar trabajos huérfanos: ${error.message}`); return 0; }
    return (data || []).length;
  }

  /** Borra lo terminado hace más de N días. */
  async limpiar(dias = 7) {
    const corte = new Date(Date.now() - dias * 864e5).toISOString();
    const { error } = await this.supabase
      .getClient()
      .from('mp_cola')
      .delete()
      .in('estado', ['hecho', 'error', 'cancelado'])
      .lt('terminado_at', corte);
    if (error) this.log.warn(`No se pudo limpiar la cola: ${error.message}`);
  }

  // ── Estado del robot (tabla mp_robot, fila única) ────────────────────────

  async latido(campos: Record<string, any>) {
    const { error } = await this.supabase
      .getClient()
      .from('mp_robot')
      .upsert([{ id: 1, ...campos, latido_at: new Date().toISOString(), actualizado_at: new Date().toISOString() }]);
    if (error) this.log.warn(`Latido del robot no guardado: ${error.message}`);
  }

  async robot() {
    const { data, error } = await this.supabase.getClient().from('mp_robot').select('*').eq('id', 1).maybeSingle();
    if (error) this.traducir(error);
    const r: any = data || {};
    const latido = r.latido_at ? Date.parse(r.latido_at) : NaN;
    const ahora = Date.now();
    const pausaCuota = r.cuota_agotada_hasta && Date.parse(r.cuota_agotada_hasta) > ahora ? r.cuota_agotada_hasta : null;
    const pausaApi = r.api_caida_hasta && Date.parse(r.api_caida_hasta) > ahora ? r.api_caida_hasta : null;
    return {
      activo: Number.isFinite(latido) && ahora - latido < 90_000,
      latido_at: r.latido_at || null,
      version: r.version || null,
      concurrencia: r.concurrencia ?? null,
      en_vuelo: r.en_vuelo ?? 0,
      cuota_agotada_hasta: pausaCuota,
      api_caida_hasta: pausaApi,
      nota: r.nota || null,
    };
  }
}
