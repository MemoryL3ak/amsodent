import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { GoogleAuthService } from '../google-auth/google-auth.service';
import { PlantillasService, TriggerPlantilla } from '../plantillas/plantillas.service';
import { gmailApiSend, GmailAttachment } from './gmail-api.helper';
import { fetchGmailThread, markGmailMessageAsRead, GmailMessageParsed } from './gmail-read.helper';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailList(input: any): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[,;\s]+/);
  return arr
    .map((e: any) => String(e || '').trim().toLowerCase())
    .filter((e: string) => EMAIL_RX.test(e));
}

@Injectable()
export class ComunicacionesService {
  private readonly logger = new Logger(ComunicacionesService.name);

  constructor(
    private supabase: SupabaseService,
    private googleAuth: GoogleAuthService,
    private plantillas: PlantillasService,
  ) {}

  // ── Listado: historial de correos de una cotización ───────────────────────
  async listar(licitacionId: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('comunicaciones_cotizacion')
      .select(
        'id, enviado_por, google_email, para, cc, bcc, asunto, cuerpo_html, ' +
          'estado, programado_para, enviado_at, gmail_message_id, gmail_thread_id, ' +
          'error_mensaje, metadata, creado_at',
      )
      .eq('licitacion_id', licitacionId)
      .order('creado_at', { ascending: false })
      .limit(200);

    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // ── Respuestas: lee los threads de Gmail para esta cotización ─────────────
  // Devuelve, agrupado por comunicación enviada, los mensajes que NO fueron
  // enviados desde la app (es decir, las respuestas del cliente).
  // Se autentica con la cuenta del vendedor que envió cada correo, así cada
  // uno ve sus propias respuestas.
  async obtenerRespuestas(licitacionId: number): Promise<
    Array<{
      comunicacion_id: number;
      gmail_thread_id: string;
      mensajes: GmailMessageParsed[];
    }>
  > {
    const { data: envios, error } = await this.supabase
      .getClient()
      .from('comunicaciones_cotizacion')
      .select('id, enviado_por, google_email, gmail_thread_id, gmail_message_id')
      .eq('licitacion_id', licitacionId)
      .eq('estado', 'enviado')
      .not('gmail_thread_id', 'is', null)
      .order('creado_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);
    if (!envios || envios.length === 0) return [];

    // Agrupamos por thread_id (puede haber varias comunicaciones que comparten
    // hilo si se respondió desde Gmail). Tomamos la más reciente como referencia.
    const porThread = new Map<string, { comunicacion_id: number; enviado_por: string; google_email: string; gmail_message_id: string }>();
    for (const e of envios) {
      if (!porThread.has(e.gmail_thread_id)) {
        porThread.set(e.gmail_thread_id, {
          comunicacion_id: e.id,
          enviado_por: (e.enviado_por || '').toLowerCase(),
          google_email: e.google_email,
          gmail_message_id: e.gmail_message_id,
        });
      }
    }

    const resultados: Array<{
      comunicacion_id: number;
      gmail_thread_id: string;
      mensajes: GmailMessageParsed[];
    }> = [];

    // Cacheamos access_token por usuario para no pedir uno por thread.
    const tokenPorUser = new Map<string, string>();

    for (const [threadId, info] of porThread.entries()) {
      try {
        let access = tokenPorUser.get(info.enviado_por);
        if (!access) {
          const t = await this.googleAuth.getFreshAccessToken(info.enviado_por);
          access = t.access_token;
          tokenPorUser.set(info.enviado_por, access);
        }
        const mensajes = await fetchGmailThread(access, threadId);
        // Filtramos: dejamos solo los que NO son del vendedor (es decir, las respuestas).
        const respuestasCliente = mensajes.filter(
          (m) => m.fromEmail.toLowerCase() !== (info.google_email || '').toLowerCase(),
        );
        if (respuestasCliente.length > 0) {
          resultados.push({
            comunicacion_id: info.comunicacion_id,
            gmail_thread_id: threadId,
            mensajes: respuestasCliente,
          });
        }
      } catch (e: any) {
        this.logger.warn(`No se pudo leer thread ${threadId} para ${info.enviado_por}: ${e?.message}`);
        // No interrumpimos al usuario: simplemente saltamos este hilo.
      }
    }

    return resultados;
  }

  // Marcar como leído un mensaje específico (respuesta de Gmail).
  async marcarRespuestaLeida(licitacionId: number, comunicacionId: number, gmailMessageId: string) {
    const { data: env } = await this.supabase
      .getClient()
      .from('comunicaciones_cotizacion')
      .select('id, enviado_por')
      .eq('id', comunicacionId)
      .eq('licitacion_id', licitacionId)
      .single();
    if (!env) throw new NotFoundException('Comunicación no encontrada.');
    const { access_token } = await this.googleAuth.getFreshAccessToken((env.enviado_por || '').toLowerCase());
    await markGmailMessageAsRead(access_token, gmailMessageId);
    return { ok: true };
  }

  // ── Envío directo (o encolado si tiene programado_para) ───────────────────
  // El frontend pasa archivos como Express.Multer.File[] (multipart/form-data).
  // El cuerpo viene como campos del FormData.
  async enviar(opts: {
    licitacionId: number;
    enviadoPor: string; // email del usuario logueado (de AuthGuard)
    para: any;
    cc?: any;
    bcc?: any;
    asunto: string;
    cuerpoHtml: string;
    cuerpoTexto?: string;
    programadoPara?: string | null; // ISO timestamp
    files?: Express.Multer.File[];
    plantillaId?: number | null;
    plantillaCodigo?: string | null;
    triggerOrigen?: string;
  }): Promise<{ ok: true; id: number; estado: string }> {
    if (!opts.asunto?.trim()) throw new BadRequestException('Falta el asunto.');
    if (!opts.cuerpoHtml?.trim()) throw new BadRequestException('Falta el cuerpo del correo.');

    const para = normalizeEmailList(opts.para);
    const cc = normalizeEmailList(opts.cc);
    const bcc = normalizeEmailList(opts.bcc);
    if (para.length === 0) {
      throw new BadRequestException('Debes indicar al menos un destinatario válido en "Para".');
    }

    // Verifica que la cotización existe (FK).
    const client = this.supabase.getClient();
    const { data: lic, error: licErr } = await client
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad')
      .eq('id', opts.licitacionId)
      .single();
    if (licErr || !lic) throw new NotFoundException('Cotización no encontrada.');

    // Si viene programadoPara en el futuro → guardamos sin enviar.
    const programado = parseScheduledAt(opts.programadoPara);
    if (programado && programado.getTime() > Date.now() + 30 * 1000) {
      const { data: row, error } = await client
        .from('comunicaciones_cotizacion')
        .insert([
          {
            licitacion_id: opts.licitacionId,
            enviado_por: opts.enviadoPor.toLowerCase(),
            para,
            cc,
            bcc,
            asunto: opts.asunto.trim(),
            cuerpo_html: opts.cuerpoHtml,
            cuerpo_texto: opts.cuerpoTexto || null,
            estado: 'programado',
            programado_para: programado.toISOString(),
            trigger_origen: opts.triggerOrigen || 'manual',
            plantilla_codigo: opts.plantillaCodigo || null,
            metadata: { plantilla_id: opts.plantillaId ?? null },
          },
        ])
        .select()
        .single();
      if (error) throw new BadRequestException(error.message);
      // TODO: en el futuro el cron job va a tomar este registro y enviarlo.
      // Adjuntos programados todavía no soportados (habría que guardarlos en
      // Storage); si vienen archivos, los rechazamos por ahora.
      if ((opts.files?.length || 0) > 0) {
        throw new BadRequestException(
          'Los correos programados todavía no soportan adjuntos. Envía sin adjuntos o envía inmediatamente.',
        );
      }
      return { ok: true, id: row.id, estado: 'programado' };
    }

    // Envío inmediato → obtenemos access_token del usuario, mandamos via Gmail API.
    const { access_token, google_email } = await this.googleAuth.getFreshAccessToken(
      opts.enviadoPor.toLowerCase(),
    );

    const attachments: GmailAttachment[] = (opts.files || []).map((f) => ({
      filename: f.originalname || 'adjunto',
      content: f.buffer,
      contentType: f.mimetype || 'application/octet-stream',
    }));

    let gmailMessageId: string | null = null;
    let gmailThreadId: string | null = null;
    let errorMensaje: string | null = null;
    let estado: 'enviado' | 'fallido' = 'enviado';

    try {
      const result = await gmailApiSend({
        accessToken: access_token,
        fromEmail: google_email,
        to: para,
        cc,
        bcc,
        subject: opts.asunto.trim(),
        html: opts.cuerpoHtml,
        text: opts.cuerpoTexto,
        attachments,
      });
      gmailMessageId = result.id;
      gmailThreadId = result.threadId || null;
    } catch (e: any) {
      estado = 'fallido';
      errorMensaje = (e?.message || 'Error desconocido').slice(0, 1000);
      this.logger.error(`Gmail send falló para ${opts.enviadoPor}: ${errorMensaje}`);
    }

    const { data: row, error } = await client
      .from('comunicaciones_cotizacion')
      .insert([
        {
          licitacion_id: opts.licitacionId,
          enviado_por: opts.enviadoPor.toLowerCase(),
          google_email,
          para,
          cc,
          bcc,
          asunto: opts.asunto.trim(),
          cuerpo_html: opts.cuerpoHtml,
          cuerpo_texto: opts.cuerpoTexto || null,
          estado,
          enviado_at: estado === 'enviado' ? new Date().toISOString() : null,
          gmail_message_id: gmailMessageId,
          gmail_thread_id: gmailThreadId,
          error_mensaje: errorMensaje,
          trigger_origen: opts.triggerOrigen || 'manual',
          plantilla_codigo: opts.plantillaCodigo || null,
          metadata: {
            plantilla_id: opts.plantillaId ?? null,
            adjuntos: attachments.map((a) => ({
              filename: a.filename,
              size: a.content.length,
            })),
          },
        },
      ])
      .select()
      .single();
    if (error) {
      // El correo SÍ se envió (si estado === 'enviado'); fallar acá significa
      // que no quedó registrado. Lo logueamos pero no devolvemos error 5xx para
      // no confundir al usuario.
      this.logger.error(
        `Correo enviado pero no se pudo registrar en BD: ${error.message}`,
      );
      throw new BadRequestException(
        `Correo procesado, pero no se pudo guardar en historial: ${error.message}`,
      );
    }

    if (estado === 'fallido') {
      // Tiramos error visible para que el frontend muestre el toast con el detalle.
      throw new BadRequestException(errorMensaje || 'No se pudo enviar el correo.');
    }

    return { ok: true, id: row.id, estado };
  }

  /**
   * Dispara correos automáticos para una cotización + tipo de trigger.
   * - Busca todas las plantillas activas con ese trigger.
   * - Para cada una intenta enviar usando: remitente = creador de la cotización,
   *   destinatario = email de la entidad/cotización, datos para variables = lic.
   * - Si el creador no tiene Gmail conectado, omite con log (no falla la operación
   *   principal — esto se llama desde flujos de negocio como "subir OC").
   * Devuelve cuántos correos efectivamente se enviaron.
   */
  async dispararPorTrigger(opts: {
    licitacionId: number;
    trigger: TriggerPlantilla;
  }): Promise<{ enviados: number; omitidos: number }> {
    const plantillas = await this.plantillas.findActivasByTrigger(opts.trigger);
    if (plantillas.length === 0) {
      this.logger.log(`No hay plantillas activas para trigger=${opts.trigger}`);
      return { enviados: 0, omitidos: 0 };
    }

    const { data: lic, error: licErr } = await this.supabase
      .getClient()
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, email, total_con_iva, total_sin_iva, creado_por, fecha_hora_cierre, correo_adjudicacion_enviado_at, correo_recordatorio_enviado_at')
      .eq('id', opts.licitacionId)
      .single();
    if (licErr || !lic) {
      this.logger.warn(`dispararPorTrigger: cotización ${opts.licitacionId} no encontrada`);
      return { enviados: 0, omitidos: 0 };
    }

    // Idempotencia por tipo de trigger: si ya se mandó, no repetir.
    if (opts.trigger === 'adjudicacion_oc' && lic.correo_adjudicacion_enviado_at) {
      this.logger.log(`Adjudicación ya notificada para licitación ${opts.licitacionId}, skip`);
      return { enviados: 0, omitidos: 0 };
    }
    if (opts.trigger === 'proximo_vencer' && lic.correo_recordatorio_enviado_at) {
      return { enviados: 0, omitidos: 0 };
    }

    const para = (lic.email || '').trim().toLowerCase();
    if (!para || !EMAIL_RX.test(para)) {
      this.logger.warn(`Cotización ${opts.licitacionId} sin email del cliente válido; trigger=${opts.trigger}`);
      return { enviados: 0, omitidos: plantillas.length };
    }

    const remitente = (lic.creado_por || '').trim().toLowerCase();
    if (!remitente) {
      this.logger.warn(`Cotización ${opts.licitacionId} sin creado_por; trigger=${opts.trigger}`);
      return { enviados: 0, omitidos: plantillas.length };
    }

    const contexto = {
      id_cotizacion: lic.id_licitacion || String(lic.id),
      nombre_entidad: lic.nombre_entidad || '',
      total: formatCLP(Number(lic.total_con_iva) || Number(lic.total_sin_iva) || 0),
      fecha_cierre: lic.fecha_hora_cierre ? new Date(lic.fecha_hora_cierre).toLocaleString('es-CL') : '',
    };

    let enviados = 0;
    let omitidos = 0;
    for (const plantilla of plantillas) {
      try {
        const { asunto, cuerpo_html } = this.plantillas.renderPlantilla(plantilla, contexto);
        await this.enviar({
          licitacionId: opts.licitacionId,
          enviadoPor: remitente,
          para: [para],
          asunto,
          cuerpoHtml: cuerpo_html,
          triggerOrigen: opts.trigger,
          plantillaCodigo: plantilla.codigo,
        });
        enviados += 1;
      } catch (e: any) {
        omitidos += 1;
        this.logger.error(
          `Trigger ${opts.trigger} falló para licitación ${opts.licitacionId} / plantilla ${plantilla.codigo}: ${e?.message}`,
        );
      }
    }

    // Marcar idempotencia si efectivamente se envió al menos uno.
    if (enviados > 0) {
      const ahora = new Date().toISOString();
      if (opts.trigger === 'adjudicacion_oc') {
        await this.supabase
          .getClient()
          .from('licitaciones')
          .update({ correo_adjudicacion_enviado_at: ahora })
          .eq('id', opts.licitacionId);
      } else if (opts.trigger === 'proximo_vencer') {
        await this.supabase
          .getClient()
          .from('licitaciones')
          .update({ correo_recordatorio_enviado_at: ahora })
          .eq('id', opts.licitacionId);
      }
    }

    return { enviados, omitidos };
  }

  /**
   * Procesa correos en estado='programado' cuya programado_para ya pasó.
   * Pensado para ser llamado por un cron job cada minuto.
   * NO maneja adjuntos (que tampoco se soportan al programar).
   */
  async procesarProgramados(): Promise<{ procesados: number; enviados: number; fallidos: number }> {
    const ahora = new Date().toISOString();
    const client = this.supabase.getClient();

    const { data: pendientes, error } = await client
      .from('comunicaciones_cotizacion')
      .select('id, licitacion_id, enviado_por, para, cc, bcc, asunto, cuerpo_html, cuerpo_texto, plantilla_codigo, trigger_origen')
      .eq('estado', 'programado')
      .lte('programado_para', ahora)
      .order('programado_para', { ascending: true })
      .limit(50);
    if (error) {
      this.logger.error(`procesarProgramados: ${error.message}`);
      return { procesados: 0, enviados: 0, fallidos: 0 };
    }
    if (!pendientes || pendientes.length === 0) return { procesados: 0, enviados: 0, fallidos: 0 };

    let enviados = 0;
    let fallidos = 0;
    for (const row of pendientes) {
      try {
        // Bloqueamos primero el registro para evitar doble envío si hay dos crones.
        const { error: lockErr } = await client
          .from('comunicaciones_cotizacion')
          .update({ estado: 'procesando' })
          .eq('id', row.id)
          .eq('estado', 'programado');
        if (lockErr) {
          this.logger.warn(`Lock falló para comunicacion ${row.id}: ${lockErr.message}`);
          continue;
        }

        const { access_token, google_email } = await this.googleAuth.getFreshAccessToken(
          (row.enviado_por || '').toLowerCase(),
        );

        let gmailMessageId: string | null = null;
        let gmailThreadId: string | null = null;
        let errorMensaje: string | null = null;
        let estadoFinal: 'enviado' | 'fallido' = 'enviado';
        try {
          const result = await gmailApiSend({
            accessToken: access_token,
            fromEmail: google_email,
            to: row.para || [],
            cc: row.cc || [],
            bcc: row.bcc || [],
            subject: row.asunto,
            html: row.cuerpo_html,
            text: row.cuerpo_texto || undefined,
            attachments: [],
          });
          gmailMessageId = result.id;
          gmailThreadId = result.threadId || null;
        } catch (e: any) {
          estadoFinal = 'fallido';
          errorMensaje = (e?.message || 'Error desconocido').slice(0, 1000);
        }

        await client
          .from('comunicaciones_cotizacion')
          .update({
            estado: estadoFinal,
            enviado_at: estadoFinal === 'enviado' ? new Date().toISOString() : null,
            gmail_message_id: gmailMessageId,
            gmail_thread_id: gmailThreadId,
            error_mensaje: errorMensaje,
            google_email,
          })
          .eq('id', row.id);

        if (estadoFinal === 'enviado') enviados += 1;
        else fallidos += 1;
      } catch (e: any) {
        fallidos += 1;
        this.logger.error(`procesarProgramados id=${row.id}: ${e?.message}`);
        // Revertimos a 'fallido' para no quedar trancado en 'procesando'.
        await client
          .from('comunicaciones_cotizacion')
          .update({ estado: 'fallido', error_mensaje: (e?.message || '').slice(0, 1000) })
          .eq('id', row.id);
      }
    }
    return { procesados: pendientes.length, enviados, fallidos };
  }

  /**
   * Detecta cotizaciones próximas a vencer (según horas_antes de cada plantilla
   * con trigger='proximo_vencer') y dispara los correos correspondientes.
   * Marca `correo_recordatorio_enviado_at` en la licitación para no duplicar.
   */
  async procesarProximosVencer(): Promise<{ revisadas: number; disparados: number }> {
    const plantillas = await this.plantillas.findActivasByTrigger('proximo_vencer');
    if (plantillas.length === 0) return { revisadas: 0, disparados: 0 };

    // Usamos el max(horas_antes) para definir la ventana a revisar.
    const horasMax = Math.max(...plantillas.map((p: any) => Number(p.horas_antes) || 24));
    const desde = new Date(Date.now());
    const hasta = new Date(Date.now() + horasMax * 60 * 60 * 1000);

    const { data: lics, error } = await this.supabase
      .getClient()
      .from('licitaciones')
      .select('id, fecha_hora_cierre, estado, correo_recordatorio_enviado_at')
      .gte('fecha_hora_cierre', desde.toISOString())
      .lte('fecha_hora_cierre', hasta.toISOString())
      .in('estado', ['En espera', 'Pendiente Aprobación'])
      .is('correo_recordatorio_enviado_at', null);
    if (error) {
      this.logger.error(`procesarProximosVencer: ${error.message}`);
      return { revisadas: 0, disparados: 0 };
    }
    if (!lics || lics.length === 0) return { revisadas: 0, disparados: 0 };

    let disparados = 0;
    for (const lic of lics) {
      const res = await this.dispararPorTrigger({ licitacionId: lic.id, trigger: 'proximo_vencer' });
      if (res.enviados > 0) {
        await this.supabase
          .getClient()
          .from('licitaciones')
          .update({ correo_recordatorio_enviado_at: new Date().toISOString() })
          .eq('id', lic.id);
        disparados += res.enviados;
      }
    }
    return { revisadas: lics.length, disparados };
  }

  // ── Cancelar un correo programado ─────────────────────────────────────────
  async cancelarProgramado(licitacionId: number, comunicacionId: number) {
    const client = this.supabase.getClient();
    const { data: row, error } = await client
      .from('comunicaciones_cotizacion')
      .select('id, licitacion_id, estado')
      .eq('id', comunicacionId)
      .single();
    if (error || !row) throw new NotFoundException('Correo no encontrado.');
    if (Number(row.licitacion_id) !== Number(licitacionId)) {
      throw new BadRequestException('El correo no pertenece a esta cotización.');
    }
    if (row.estado !== 'programado') {
      throw new BadRequestException(`No se puede cancelar un correo en estado ${row.estado}.`);
    }
    const { error: e2 } = await client
      .from('comunicaciones_cotizacion')
      .update({ estado: 'cancelado' })
      .eq('id', comunicacionId);
    if (e2) throw new BadRequestException(e2.message);
    return { ok: true };
  }
}

function parseScheduledAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatCLP(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}
