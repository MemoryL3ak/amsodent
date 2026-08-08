import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as net from 'net';
import * as dns from 'dns';
import * as nodemailer from 'nodemailer';
import { SupabaseService } from '../supabase/supabase.service';

export interface MonitorEntry {
  nivel?: 'info' | 'warn' | 'error';
  origen?: 'backend' | 'frontend' | 'movil';
  tipo?: 'http' | 'excepcion' | 'correo' | 'frontend' | 'sistema';
  metodo?: string;
  ruta?: string;
  status?: number;
  duracion_ms?: number;
  mensaje?: string;
  stack?: string;
  trace_id?: string;
  usuario_id?: string;
  usuario_email?: string;
  ip?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
}

const FLUSH_INTERVALO_MS = 3_000;
const FLUSH_MAX_PENDIENTES = 25;
// Tope duro del buffer: si Supabase está caído no acumulamos sin límite.
const BUFFER_MAX = 500;
const PURGA_INTERVALO_MS = 6 * 60 * 60 * 1000; // cada 6 horas
const ALERTAS_INTERVALO_MS = 60 * 1000;
const ALERTA_VENTANA_MIN = 5;
const ALERTA_COOLDOWN_MS = 30 * 60 * 1000; // no repetir la misma alerta en 30 min
const SALUD_INTERVALO_MS = 5 * 60 * 1000;

// Versión desplegada: Railway inyecta el SHA del commit; en local queda 'dev'.
export const APP_VERSION =
  (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) ||
  process.env.APP_VERSION ||
  'dev';

export interface EstadoServicio {
  servicio: string;
  ok: boolean | null; // null = aún no chequeado
  ms: number | null;
  error?: string;
  desde?: string; // desde cuándo está en el estado actual
}

// Registro central de eventos técnicos (requests, errores, correos), con
// agrupación de errores en "issues", alertas proactivas y health checks.
// Los inserts van a un buffer y se vuelcan a Supabase en lotes: el monitoreo
// NUNCA agrega latencia ni puede tumbar una request.
@Injectable()
export class MonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name);
  private buffer: MonitorEntry[] = [];
  private timers: NodeJS.Timeout[] = [];
  private volcando = false;
  private iniciadoEn = Date.now();

  // Alertas: última vez que se disparó cada tipo (cooldown).
  private ultimaAlerta = new Map<string, number>();

  // Health checks: estado vigente de cada servicio.
  private salud = new Map<string, EstadoServicio>();

  constructor(private supabase: SupabaseService) {
    this.programar(() => void this.flush(), FLUSH_INTERVALO_MS);
    this.programar(() => void this.purgar(), PURGA_INTERVALO_MS);
    this.programar(() => void this.evaluarAlertas(), ALERTAS_INTERVALO_MS);
    this.programar(() => void this.chequearSalud(), SALUD_INTERVALO_MS);
    void this.purgar();
    // Primer health check a los 10 s del arranque (deja levantar todo antes).
    const t = setTimeout(() => void this.chequearSalud(), 10_000);
    t.unref?.();
    this.timers.push(t);
  }

  private programar(fn: () => void, ms: number) {
    const t = setInterval(fn, ms);
    t.unref?.();
    this.timers.push(t);
  }

  onModuleInit() {
    this.registrar({
      nivel: 'info',
      tipo: 'sistema',
      mensaje: `Backend iniciado · versión ${APP_VERSION}`,
      metadata: { version: APP_VERSION, node: process.version },
    });
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearInterval(t));
    void this.flush();
  }

  // ── Registro ─────────────────────────────────────────────────────────

  /** Encola un evento. Nunca lanza: el monitoreo no debe romper nada. */
  registrar(entry: MonitorEntry) {
    try {
      if (this.buffer.length >= BUFFER_MAX) this.buffer.shift();
      this.buffer.push({
        nivel: entry.nivel || 'info',
        origen: entry.origen || 'backend',
        tipo: entry.tipo || 'http',
        ...entry,
        // Campos de texto libres recortados: un stack o body gigante no debe
        // inflar la tabla.
        mensaje: this.recortar(entry.mensaje, 2_000),
        stack: this.recortar(entry.stack, 8_000),
        ruta: this.recortar(entry.ruta, 500),
        user_agent: this.recortar(entry.user_agent, 300),
      });
      if (this.buffer.length >= FLUSH_MAX_PENDIENTES) void this.flush();
      // Todo error genera/actualiza su issue agrupado.
      if ((entry.nivel || 'info') === 'error') void this.upsertIssue(entry);
    } catch {
      /* nunca propagar */
    }
  }

  private recortar(v: string | undefined, max: number): string | undefined {
    if (v == null) return undefined;
    const s = String(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  }

  private async flush() {
    if (this.volcando || this.buffer.length === 0) return;
    this.volcando = true;
    const lote = this.buffer.splice(0, this.buffer.length);
    try {
      const { error } = await this.supabase
        .getClient()
        .from('monitor_logs')
        .insert(lote);
      if (error) {
        // No re-encolamos: preferimos perder logs a acumular memoria.
        this.logger.warn(`No se pudo volcar ${lote.length} logs: ${error.message}`);
      }
    } catch (e: any) {
      this.logger.warn(`Flush de monitor falló: ${e?.message || e}`);
    } finally {
      this.volcando = false;
    }
  }

  /** Borra logs más antiguos que MONITOR_RETENCION_DIAS (default 30). */
  private async purgar() {
    try {
      const dias = Number(process.env.MONITOR_RETENCION_DIAS || 30);
      const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
      await this.supabase
        .getClient()
        .from('monitor_logs')
        .delete()
        .lt('created_at', limite);
    } catch {
      /* silencioso */
    }
  }

  // ── Issues: agrupación de errores por huella ─────────────────────────

  /** Normaliza el mensaje para que el mismo bug con distintos IDs agrupe. */
  private huella(entry: MonitorEntry): { fingerprint: string; titulo: string } {
    const linea = String(entry.mensaje || entry.stack || 'Error desconocido')
      .split('\n')[0]
      .slice(0, 300);
    const norm = linea
      .toLowerCase()
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '*')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
    const base = `${entry.tipo || ''}|${entry.ruta || ''}|${norm}`;
    return {
      fingerprint: crypto.createHash('sha1').update(base).digest('hex'),
      titulo: linea,
    };
  }

  private async upsertIssue(entry: MonitorEntry) {
    try {
      const { fingerprint, titulo } = this.huella(entry);
      await this.supabase.getClient().rpc('monitor_issue_upsert', {
        p_fingerprint: fingerprint,
        p_titulo: titulo,
        p_tipo: entry.tipo || null,
        p_ruta: entry.ruta || null,
        p_stack: this.recortar(entry.stack, 8_000) || null,
        p_trace_id: entry.trace_id || null,
        p_usuario: entry.usuario_email || null,
      });
    } catch {
      /* la tabla puede no existir aún; silencioso */
    }
  }

  async listarIssues(estado?: string) {
    let q = this.supabase
      .getClient()
      .from('monitor_issues')
      .select('*')
      .order('ultima_vez', { ascending: false })
      .limit(200);
    if (estado && ['activo', 'resuelto', 'ignorado'].includes(estado)) {
      q = q.eq('estado', estado);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async cambiarEstadoIssue(id: number, estado: string) {
    if (!['activo', 'resuelto', 'ignorado'].includes(estado)) {
      throw new Error('Estado no válido.');
    }
    const { error } = await this.supabase
      .getClient()
      .from('monitor_issues')
      .update({ estado })
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // ── Alertas proactivas ───────────────────────────────────────────────

  /** Cada minuto: umbral de errores y de latencia en la ventana móvil. */
  private async evaluarAlertas() {
    try {
      const client = this.supabase.getClient();
      const desde = new Date(Date.now() - ALERTA_VENTANA_MIN * 60 * 1000).toISOString();

      const maxErrores = Number(process.env.MONITOR_ALERTA_ERRORES || 5);
      const { count: errores } = await client
        .from('monitor_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', desde)
        .eq('nivel', 'error')
        .neq('tipo', 'sistema');
      if ((errores || 0) >= maxErrores) {
        await this.alertar(
          'errores',
          `${errores} errores en los últimos ${ALERTA_VENTANA_MIN} minutos (umbral: ${maxErrores}). Revisa la pestaña Problemas del monitoreo.`,
        );
      }

      const maxP95 = Number(process.env.MONITOR_ALERTA_P95_MS || 3000);
      const { data: dur } = await client
        .from('monitor_logs')
        .select('duracion_ms')
        .gte('created_at', desde)
        .eq('tipo', 'http')
        .not('duracion_ms', 'is', null)
        .limit(500);
      const tiempos = (dur || [])
        .map((d) => Number(d.duracion_ms))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (tiempos.length >= 20) {
        const p95 = tiempos[Math.floor(tiempos.length * 0.95)];
        if (p95 >= maxP95) {
          await this.alertar(
            'latencia',
            `Latencia p95 de ${Math.round(p95)} ms en los últimos ${ALERTA_VENTANA_MIN} minutos (umbral: ${maxP95} ms, ${tiempos.length} requests).`,
          );
        }
      }
    } catch {
      /* silencioso */
    }
  }

  /** Dispara una alerta (log + notificación interna + correo), con cooldown. */
  private async alertar(clave: string, mensaje: string) {
    const ultima = this.ultimaAlerta.get(clave) || 0;
    if (Date.now() - ultima < ALERTA_COOLDOWN_MS) return;
    this.ultimaAlerta.set(clave, Date.now());

    this.logger.warn(`ALERTA [${clave}]: ${mensaje}`);
    this.registrar({
      nivel: 'error',
      tipo: 'sistema',
      mensaje: `🚨 ALERTA: ${mensaje}`,
      metadata: { alerta: clave },
    });

    const destinatarios = await this.destinatariosAlerta();
    if (!destinatarios.length) return;

    // Notificación interna (campana del sistema, ya tiene realtime).
    try {
      await this.supabase.getClient().from('notificaciones').insert(
        destinatarios.map((email) => ({
          user_email: email,
          tipo: 'monitor_alerta',
          mensaje: `🚨 ${mensaje}`,
          link: '/monitoreo-sistema',
          metadata: { alerta: clave },
        })),
      );
    } catch {
      /* silencioso */
    }

    // Correo. Transporter propio y mínimo (no usamos MailingsService para no
    // crear dependencia circular monitor ↔ mailings).
    try {
      await this.enviarCorreoAlerta(
        destinatarios,
        `🚨 Alerta AMSODENT: ${clave}`,
        `<p><b>${mensaje}</b></p><p>Panel: <a href="${process.env.MONITOR_PANEL_URL || 'https://amsodent.vercel.app/monitoreo-sistema'}">Monitoreo del Sistema</a></p><p style="color:#888;font-size:12px">Versión ${APP_VERSION} · esta alerta no se repetirá por ${ALERTA_COOLDOWN_MS / 60000} min.</p>`,
      );
    } catch (e: any) {
      this.logger.warn(`No se pudo enviar correo de alerta: ${e?.message || e}`);
    }
  }

  /**
   * Destinatarios de las alertas: SOLO los de MONITOR_ALERTA_CORREO
   * (coma-separado). Sin esa variable no se avisa a nadie.
   *
   * Deliberadamente no hay fallback a los admins: las alertas son técnicas
   * (latencia, tasa de errores) y no le sirven a quien no opera el sistema.
   * Además dev y producción comparten la base de Supabase, así que un backend
   * levantado en local terminaba escribiendo en la campana y en el correo de
   * los admins de producción.
   */
  private async destinatariosAlerta(): Promise<string[]> {
    return String(process.env.MONITOR_ALERTA_CORREO || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }

  private async enviarCorreoAlerta(para: string[], asunto: string, html: string) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return;
    const port = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user, pass },
      family: 4,
      lookup: (hostname: string, _o: any, cb: any) => {
        dns.resolve4(hostname, (err, addrs) =>
          err ? cb(err) : cb(null, addrs[0], 4),
        );
      },
      connectionTimeout: 20_000,
    } as any);
    await transporter.sendMail({
      from: `"Monitoreo AMSODENT" <${user}>`,
      to: para.join(', '),
      subject: asunto,
      html,
    });
  }

  // ── Health checks ────────────────────────────────────────────────────

  private async chequearSalud() {
    const checks: Array<{ servicio: string; fn: () => Promise<number> }> = [
      {
        servicio: 'supabase',
        fn: async () => {
          const t0 = Date.now();
          const { error } = await this.supabase
            .getClient()
            .from('profiles')
            .select('id', { count: 'exact', head: true });
          if (error) throw new Error(error.message);
          return Date.now() - t0;
        },
      },
      {
        servicio: 'smtp',
        fn: () =>
          this.tcpCheck(
            process.env.SMTP_HOST || 'smtp.gmail.com',
            Number(process.env.SMTP_PORT || 465),
          ),
      },
    ];
    if (process.env.MP_API_TICKET || process.env.MERCADO_PUBLICO_TICKET) {
      checks.push({
        servicio: 'mercado_publico',
        fn: () => this.tcpCheck('api.mercadopublico.cl', 443),
      });
    }

    for (const c of checks) {
      let ok = true;
      let ms: number | null = null;
      let error: string | undefined;
      try {
        ms = await c.fn();
      } catch (e: any) {
        ok = false;
        error = String(e?.message || e).slice(0, 300);
      }
      const previo = this.salud.get(c.servicio);
      const cambio = previo?.ok != null && previo.ok !== ok;
      this.salud.set(c.servicio, {
        servicio: c.servicio,
        ok,
        ms,
        error,
        desde: cambio || !previo?.desde ? new Date().toISOString() : previo.desde,
      });
      if (cambio && !ok) {
        await this.alertar(
          `salud:${c.servicio}`,
          `El servicio "${c.servicio}" no responde: ${error || 'sin detalle'}.`,
        );
      } else if (cambio && ok) {
        this.registrar({
          nivel: 'info',
          tipo: 'sistema',
          mensaje: `✅ El servicio "${c.servicio}" se recuperó (${ms} ms).`,
          metadata: { servicio: c.servicio },
        });
      }
    }
  }

  private tcpCheck(host: string, port: number, timeoutMs = 6000): Promise<number> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const sock = net.connect({ host, port, family: 4 });
      const fin = (err?: Error) => {
        sock.destroy();
        if (err) reject(err);
        else resolve(Date.now() - t0);
      };
      sock.setTimeout(timeoutMs, () => fin(new Error(`timeout ${timeoutMs} ms (${host}:${port})`)));
      sock.once('connect', () => fin());
      sock.once('error', (e) => fin(e));
    });
  }

  /** Estado para el semáforo del panel. */
  async estadoSalud() {
    if (this.salud.size === 0) await this.chequearSalud();
    const mem = process.memoryUsage();
    return {
      version: APP_VERSION,
      uptime_seg: Math.round((Date.now() - this.iniciadoEn) / 1000),
      memoria_mb: Math.round(mem.rss / 1024 / 1024),
      node: process.version,
      servicios: Array.from(this.salud.values()),
    };
  }

  // ── Consultas para el panel ──────────────────────────────────────────

  async listar(filtros: {
    nivel?: string;
    origen?: string;
    tipo?: string;
    buscar?: string;
    limite?: number;
  }) {
    let q = this.supabase
      .getClient()
      .from('monitor_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(filtros.limite) || 200, 1000));

    if (filtros.nivel) q = q.eq('nivel', filtros.nivel);
    if (filtros.origen) q = q.eq('origen', filtros.origen);
    if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
    if (filtros.buscar?.trim()) {
      const b = filtros.buscar.trim().replace(/[%,()]/g, ' ');
      q = q.or(`ruta.ilike.%${b}%,mensaje.ilike.%${b}%,usuario_email.ilike.%${b}%,trace_id.ilike.%${b}%`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  /** Series de tráfico agregadas en SQL (fn monitor_trafico). */
  async trafico(horas: number) {
    // bucket elegido para que el gráfico tenga ~48-72 columnas
    const config: Record<number, number> = { 1: 60, 6: 300, 24: 1800, 168: 7200 };
    const h = config[horas] ? horas : 24;
    const desde = new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase.getClient().rpc('monitor_trafico', {
      p_desde: desde,
      p_bucket_seg: config[h],
    });
    if (error) throw new Error(error.message);
    return { horas: h, bucket_seg: config[h], desde, ...(data || {}) };
  }

  /** KPIs de las últimas 24 horas para las tarjetas del panel. */
  async stats() {
    const client = this.supabase.getClient();
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const contar = async (aplicar: (q: any) => any) => {
      const { count } = await aplicar(
        client
          .from('monitor_logs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', desde),
      );
      return count || 0;
    };

    const [total, errores, warnings, correos, correosError, frontend, issuesActivos] =
      await Promise.all([
        contar((q) => q),
        contar((q) => q.eq('nivel', 'error')),
        contar((q) => q.eq('nivel', 'warn')),
        contar((q) => q.eq('tipo', 'correo')),
        contar((q) => q.eq('tipo', 'correo').eq('nivel', 'error')),
        contar((q) => q.eq('tipo', 'frontend')),
        (async () => {
          try {
            const { count } = await client
              .from('monitor_issues')
              .select('id', { count: 'exact', head: true })
              .eq('estado', 'activo');
            return count || 0;
          } catch {
            return 0;
          }
        })(),
      ]);

    // Latencia promedio sobre las últimas 300 requests HTTP con duración.
    const { data: dur } = await client
      .from('monitor_logs')
      .select('duracion_ms')
      .eq('tipo', 'http')
      .not('duracion_ms', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300);
    const tiempos = (dur || []).map((d) => Number(d.duracion_ms)).filter(Number.isFinite);
    const latenciaProm = tiempos.length
      ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length)
      : null;

    return { total, errores, warnings, correos, correosError, frontend, issuesActivos, latenciaProm };
  }
}

/** Enmascara credenciales y recorta un objeto para guardarlo como contexto. */
export function sanitizarContexto(obj: any, maxLen = 1_500): string | undefined {
  if (obj == null) return undefined;
  try {
    const texto = JSON.stringify(obj, (clave, valor) => {
      if (/pass|clave|token|secret|authorization|apikey|api_key|firma/i.test(clave)) {
        return '[oculto]';
      }
      if (typeof valor === 'string' && valor.length > 300) {
        return valor.slice(0, 300) + '…';
      }
      return valor;
    });
    if (!texto || texto === '{}' || texto === '[]') return undefined;
    return texto.length > maxLen ? texto.slice(0, maxLen) + '…' : texto;
  } catch {
    return undefined;
  }
}
