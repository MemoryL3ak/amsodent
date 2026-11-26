import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import * as dns from 'dns';
import { SupabaseService } from '../supabase/supabase.service';
import { MonitorService } from '../monitor/monitor.service';
import {
  TIPO_MAILING_APERTURA, avisoApertura, baseApiPublica, conPixelApertura, decidirAvisoApertura, esBaseLocal, esTokenApertura,
} from '../comunidad/mailing-aperturas';

/* Columnas de 20261126_mailing_aperturas.sql (contador y última apertura). Sin
   esa migración el seguimiento sigue funcionando con lo que ya había (primera
   apertura); solo no se sabe cuántas veces se abrió. */
const sinColumna = (e: any) => /^(42703|PGRST204)$/.test(String(e?.code || '')) || /does not exist|schema cache|could not find/i.test(String(e?.message || ''));
const SEGUNDOS_ENTRE_REVISIONES_AVISO = 30;

const BATCH_SIZE = 500; // Gmail/Workspace permite hasta 500 destinatarios por mensaje (modo BCC)
const DELAY_BETWEEN_BATCHES_MS = 1500;

export type InlineAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string; // referenciado en HTML como <img src="cid:..."/>
};

export type SendBulkOptions = {
  destinatarios: string[];
  asunto: string;
  cuerpoHtml: string;
  cuerpoTexto?: string;
  remitenteNombre?: string;
  inlineAttachments?: InlineAttachment[];
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  // Si true, envía un correo por destinatario con tracking pixel único.
  // Si false, usa BCC (rápido pero sin tracking por persona).
  conTracking?: boolean;
  creadoPor?: string;
};

export type SendBulkResult = {
  totalDestinatarios: number;
  lotes: number;
  enviados: number;
  fallidos: number;
  errores: Array<{ lote: number; mensaje: string; email?: string }>;
  envioId?: number;
};

@Injectable()
export class MailingsService {
  private readonly logger = new Logger(MailingsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private supabase: SupabaseService,
    private monitor: MonitorService,
  ) {}

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      throw new BadRequestException(
        'SMTP no configurado: faltan SMTP_USER y/o SMTP_PASS en variables de entorno.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      // Railway/Fly/Render no soportan IPv6 saliente. Sin esto Node resuelve
      // smtp.gmail.com a una IPv6 y falla con ENETUNREACH. Aunque
      // dns.setDefaultResultOrder ya fuerza IPv4 globalmente, redundamos
      // acá con un lookup explícito porque algunas versiones de nodemailer
      // ignoran el setting global.
      family: 4,
      lookup: (hostname: string, options: any, callback: any) => {
        const cb = typeof options === 'function' ? options : callback;
        // dns.resolve4 consulta DIRECTO los registros A (solo IPv4), sin pasar
        // por getaddrinfo: aunque el sistema/Node prefiera IPv6 (Happy
        // Eyeballs, resolvers raros), aquí jamás puede salir una dirección
        // IPv6. Fallback a dns.lookup con family:4 si la consulta falla.
        dns.resolve4(hostname, (err: any, addrs: string[]) => {
          if (err || !addrs || addrs.length === 0) {
            const opts = typeof options === 'function' ? {} : options || {};
            return dns.lookup(hostname, { ...opts, family: 4, all: false }, cb);
          }
          cb(null, addrs[0], 4);
        });
      },
      // Si la red está bloqueada o lenta, queremos fallar rápido y no dejar
      // la petición HTTP colgada minutos.
      connectionTimeout: 20 * 1000,
      greetingTimeout: 20 * 1000,
      socketTimeout: 60 * 1000,
    } as any);
    return this.transporter;
  }

  /* (2026-11-26) A dónde apunta el píxel de apertura. Antes era PUBLIC_API_URL o
     localhost: sin esa variable en el servidor, todos los correos salían con el
     píxel apuntando a localhost y ninguna apertura quedaba registrada. Ahora,
     si falta, se usa la dirección por la que llegó la petición de envío
     (`desdePeticion`) o el dominio público que pone Railway. */
  urlBaseAperturas(desdePeticion?: string | null): string {
    return baseApiPublica(process.env as Record<string, string | undefined>, desdePeticion);
  }

  /** false = el servidor no tiene dirección pública: el correo sale, pero no se sabrá quién lo abrió. */
  aperturasRastreables(desdePeticion?: string | null): boolean {
    return !esBaseLocal(this.urlBaseAperturas(desdePeticion));
  }

  private getApiBaseUrl(): string {
    return this.urlBaseAperturas();
  }

  async sendBulkBCC(opts: SendBulkOptions): Promise<SendBulkResult> {
    const destinatarios = (opts.destinatarios || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    const unicos = Array.from(new Set(destinatarios));

    if (unicos.length === 0) {
      throw new BadRequestException('No hay destinatarios válidos.');
    }
    if (!opts.asunto?.trim()) {
      throw new BadRequestException('Falta el asunto del correo.');
    }
    if (!opts.cuerpoHtml?.trim()) {
      throw new BadRequestException('Falta el cuerpo del correo.');
    }

    const resultado = opts.conTracking
      ? await this.sendIndividualConTracking(opts, unicos)
      : await this.sendByBatchesBCC(opts, unicos);

    this.monitor.registrar({
      nivel: resultado.fallidos > 0 ? 'warn' : 'info',
      tipo: 'correo',
      mensaje: `Mailing "${opts.asunto.trim()}": ${resultado.enviados} enviados, ${resultado.fallidos} fallidos`,
      metadata: {
        asunto: opts.asunto.trim(),
        destinatarios: resultado.totalDestinatarios,
        enviados: resultado.enviados,
        fallidos: resultado.fallidos,
        via: 'smtp-bulk',
      },
    });
    return resultado;
  }

  // ── Envío rápido en BCC (sin tracking por persona) ──────────────────
  private async sendByBatchesBCC(opts: SendBulkOptions, unicos: string[]): Promise<SendBulkResult> {
    const transporter = this.getTransporter();
    const from = this.buildFrom(opts);

    const lotes: string[][] = [];
    for (let i = 0; i < unicos.length; i += BATCH_SIZE) {
      lotes.push(unicos.slice(i, i + BATCH_SIZE));
    }

    let enviados = 0;
    let fallidos = 0;
    const errores: Array<{ lote: number; mensaje: string }> = [];

    const allAttachments = this.buildAttachments(opts);

    for (let i = 0; i < lotes.length; i++) {
      const bcc = lotes[i];
      try {
        await transporter.sendMail({
          from,
          to: 'Destinatarios no revelados:;',
          bcc,
          subject: opts.asunto.trim(),
          html: opts.cuerpoHtml,
          text: opts.cuerpoTexto || stripHtml(opts.cuerpoHtml),
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
        });
        enviados += bcc.length;
        this.logger.log(`Lote ${i + 1}/${lotes.length}: ${bcc.length} enviados.`);
      } catch (err: any) {
        fallidos += bcc.length;
        const mensaje = err?.message || String(err);
        errores.push({ lote: i + 1, mensaje });
        this.logger.error(`Lote ${i + 1}/${lotes.length} FALLÓ: ${mensaje}`);
      }

      if (i < lotes.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    return {
      totalDestinatarios: unicos.length,
      lotes: lotes.length,
      enviados,
      fallidos,
      errores,
    };
  }

  // ── Envío individual con tracking pixel único por destinatario ──────
  private async sendIndividualConTracking(
    opts: SendBulkOptions,
    unicos: string[],
  ): Promise<SendBulkResult> {
    const transporter = this.getTransporter();
    const from = this.buildFrom(opts);
    const allAttachments = this.buildAttachments(opts);
    const baseUrl = this.getApiBaseUrl();

    // Crear envio + destinatarios en DB
    const client = this.supabase.getClient();
    const conFlyer = (opts.inlineAttachments?.length || 0) > 0;

    const { data: envio, error: envioErr } = await client
      .from('mailings_envios')
      .insert([
        {
          asunto: opts.asunto.trim(),
          total: unicos.length,
          enviados: 0,
          fallidos: 0,
          con_flyer: conFlyer,
          creado_por: opts.creadoPor || null,
        },
      ])
      .select('id')
      .single();

    if (envioErr || !envio) {
      throw new BadRequestException(
        `No se pudo crear el envío: ${envioErr?.message || 'error desconocido'}`,
      );
    }

    const envioId: number = envio.id;

    const destinatariosRows = unicos.map((email) => ({
      envio_id: envioId,
      email,
      token: crypto.randomBytes(16).toString('hex'),
    }));

    const { data: destInsertados, error: destErr } = await client
      .from('mailings_destinatarios')
      .insert(destinatariosRows)
      .select('id, email, token');

    if (destErr || !destInsertados) {
      throw new BadRequestException(
        `No se pudieron registrar los destinatarios: ${destErr?.message || 'error desconocido'}`,
      );
    }

    let enviados = 0;
    let fallidos = 0;
    const errores: Array<{ lote: number; mensaje: string; email?: string }> = [];

    for (const row of destInsertados) {
      const htmlConPixel = conPixelApertura(opts.cuerpoHtml, baseUrl, row.token);

      try {
        await transporter.sendMail({
          from,
          to: row.email,
          subject: opts.asunto.trim(),
          html: htmlConPixel,
          text: opts.cuerpoTexto || stripHtml(opts.cuerpoHtml),
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
        });

        await client
          .from('mailings_destinatarios')
          .update({ enviado_at: new Date().toISOString() })
          .eq('id', row.id);

        enviados += 1;
      } catch (err: any) {
        fallidos += 1;
        const mensaje = err?.message || String(err);
        errores.push({ lote: 1, email: row.email, mensaje });
        await client
          .from('mailings_destinatarios')
          .update({ fallo: mensaje.slice(0, 500) })
          .eq('id', row.id);
        this.logger.error(`Falló envío a ${row.email}: ${mensaje}`);
      }
    }

    await client
      .from('mailings_envios')
      .update({ enviados, fallidos })
      .eq('id', envioId);

    this.logger.log(
      `Envío ${envioId}: ${enviados}/${unicos.length} entregados, ${fallidos} fallidos.`,
    );

    return {
      totalDestinatarios: unicos.length,
      lotes: 1,
      enviados,
      fallidos,
      errores,
      envioId,
    };
  }

  /* ── Envío personalizado en segundo plano (2026-11-19, mailing de Comunidad) ──
     Un correo por persona, cada uno con SU html (saludo con el nombre, enlace
     de baja propio) y el pixel de apertura. Deja el envío y sus destinatarios
     registrados, responde de inmediato con el id y sigue enviando por detrás:
     con cientos de destinatarios la petición HTTP no alcanza a esperar. El
     avance se lee de `mailings_envios` (enviados / fallidos se actualizan cada
     10 correos) y de `enviosEnCurso`. Si el servidor se reinicia a mitad de
     camino, los que faltaban quedan sin `enviado_at` ni `fallo`. */
  private enCurso = new Set<number>();

  envioEnCurso(envioId: number): boolean {
    return this.enCurso.has(Number(envioId));
  }

  smtpConfigurado(): boolean {
    return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  async iniciarEnvioPersonalizado(opts: {
    destinatarios: string[];
    asunto: string;
    htmlPara: (email: string) => string;
    cabecerasPara?: (email: string) => Record<string, string> | undefined;
    remitenteNombre?: string;
    replyTo?: string | null;
    inlineAttachments?: InlineAttachment[];
    creadoPor?: string | null;
    origen?: string;
    detalle?: Record<string, any>;
    pausaMs?: number;
    /** Dirección pública del backend (…/api) vista desde la petición; solo se usa si falta PUBLIC_API_URL. */
    apiBaseUrl?: string | null;
  }): Promise<{ envioId: number; total: number }> {
    const unicos = Array.from(new Set((opts.destinatarios || []).map((e) => String(e || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))));
    if (!unicos.length) throw new BadRequestException('No hay destinatarios válidos.');
    if (!opts.asunto?.trim()) throw new BadRequestException('Falta el asunto del correo.');
    const transporter = this.getTransporter(); // sin SMTP configurado falla aquí, antes de registrar nada
    const from = this.buildFrom({ remitenteNombre: opts.remitenteNombre } as SendBulkOptions);
    const client = this.supabase.getClient();

    const base = { asunto: opts.asunto.trim(), total: unicos.length, enviados: 0, fallidos: 0, con_flyer: (opts.inlineAttachments?.length || 0) > 0, creado_por: opts.creadoPor || null };
    let { data: envio, error: envioErr } = await client.from('mailings_envios').insert([{ ...base, origen: opts.origen || null, detalle: opts.detalle || null }]).select('id').single();
    // Sin la migración 20261119 (columnas origen / detalle) el envío se registra igual, sin ellas.
    if (envioErr && /origen|detalle|schema cache|PGRST204|42703/i.test(`${envioErr.message} ${(envioErr as any).code || ''}`)) {
      ({ data: envio, error: envioErr } = await client.from('mailings_envios').insert([base]).select('id').single());
    }
    if (envioErr || !envio) throw new BadRequestException(`No se pudo crear el envío: ${envioErr?.message || 'error desconocido'}`);
    const envioId = Number(envio.id);

    const filas: { id: number; email: string; token: string }[] = [];
    for (let i = 0; i < unicos.length; i += 500) {
      const { data, error } = await client.from('mailings_destinatarios')
        .insert(unicos.slice(i, i + 500).map((email) => ({ envio_id: envioId, email, token: crypto.randomBytes(16).toString('hex') })))
        .select('id, email, token');
      if (error || !data) {
        await client.from('mailings_envios').delete().eq('id', envioId);
        throw new BadRequestException(`No se pudieron registrar los destinatarios: ${error?.message || 'error desconocido'}`);
      }
      filas.push(...(data as any[]));
    }

    const baseUrl = this.urlBaseAperturas(opts.apiBaseUrl);
    const adjuntos = (opts.inlineAttachments || []).map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, cid: a.cid }));
    const pausa = Math.max(0, opts.pausaMs ?? 250);
    this.enCurso.add(envioId);
    void (async () => {
      let enviados = 0;
      let fallidos = 0;
      try {
        for (let i = 0; i < filas.length; i++) {
          const fila = filas[i];
          try {
            const html = conPixelApertura(opts.htmlPara(fila.email), baseUrl, fila.token);
            await transporter.sendMail({
              from,
              to: fila.email,
              replyTo: opts.replyTo?.trim() || undefined,
              subject: opts.asunto.trim(),
              html,
              text: stripHtml(html),
              headers: opts.cabecerasPara?.(fila.email),
              attachments: adjuntos.length ? adjuntos : undefined,
            });
            await client.from('mailings_destinatarios').update({ enviado_at: new Date().toISOString() }).eq('id', fila.id);
            enviados++;
          } catch (err: any) {
            fallidos++;
            const mensaje = String(err?.message || err);
            await client.from('mailings_destinatarios').update({ fallo: mensaje.slice(0, 500) }).eq('id', fila.id);
            this.logger.error(`Envío ${envioId}: falló ${fila.email}: ${mensaje}`);
          }
          if ((i + 1) % 10 === 0) await client.from('mailings_envios').update({ enviados, fallidos }).eq('id', envioId);
          if (pausa && i < filas.length - 1) await new Promise((r) => setTimeout(r, pausa));
        }
      } finally {
        this.enCurso.delete(envioId);
        await client.from('mailings_envios').update({ enviados, fallidos }).eq('id', envioId);
        this.monitor.registrar({
          nivel: fallidos > 0 ? 'warn' : 'info',
          tipo: 'correo',
          mensaje: `Mailing "${opts.asunto.trim()}"${opts.origen ? ` (${opts.origen})` : ''}: ${enviados} enviados, ${fallidos} fallidos`,
          metadata: { asunto: opts.asunto.trim(), destinatarios: filas.length, enviados, fallidos, via: 'smtp-personalizado', envio_id: envioId },
        });
        this.logger.log(`Envío ${envioId}: ${enviados}/${filas.length} entregados, ${fallidos} fallidos.`);
      }
    })().catch((e) => this.logger.error(`Envío ${envioId}: se interrumpió: ${e?.message || e}`));
    return { envioId, total: filas.length };
  }

  // Envío de un único correo transaccional (agradecimiento OC, guía, etc.).
  // Reusa el transporter SMTP compartido. replyTo permite que las respuestas
  // del cliente lleguen al vendedor aunque el remitente sea la cuenta común.
  async enviarUno(opts: {
    para: string;
    asunto: string;
    cuerpoHtml: string;
    cuerpoTexto?: string;
    replyTo?: string;
    remitenteNombre?: string;
    cc?: string[];
    // `cid` permite referenciar el adjunto como imagen inline (src="cid:...").
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string }>;
  }): Promise<{ enviado: boolean; messageId?: string }> {
    const para = String(opts.para || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
      throw new BadRequestException('El destinatario no es un correo válido.');
    }
    if (!opts.asunto?.trim()) {
      throw new BadRequestException('Falta el asunto del correo.');
    }
    if (!opts.cuerpoHtml?.trim()) {
      throw new BadRequestException('Falta el cuerpo del correo.');
    }

    const cc = (Array.isArray(opts.cc) ? opts.cc : [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    const transporter = this.getTransporter();
    const from = this.buildFrom({ remitenteNombre: opts.remitenteNombre } as SendBulkOptions);

    let info: any;
    try {
      info = await transporter.sendMail({
        from,
        to: para,
        cc: cc.length > 0 ? cc : undefined,
        replyTo: opts.replyTo?.trim() || undefined,
        subject: opts.asunto.trim(),
        html: opts.cuerpoHtml,
        text: opts.cuerpoTexto || stripHtml(opts.cuerpoHtml),
        attachments:
          opts.attachments && opts.attachments.length > 0 ? opts.attachments : undefined,
      });
    } catch (e: any) {
      // Anexar host:puerto al error de conexión: permite distinguir en el
      // toast qué configuración SMTP estaba activa (587 vs 465, etc.).
      const host = process.env.SMTP_HOST || 'smtp.gmail.com';
      const port = Number(process.env.SMTP_PORT || 465);
      if (e && typeof e.message === 'string' && !e.message.includes(host)) {
        e.message = `${e.message} [${host}:${port}]`;
      }
      this.monitor.registrar({
        nivel: 'error',
        tipo: 'correo',
        mensaje: `Falló envío SMTP a ${para}: ${e?.message || e}`,
        metadata: { para, asunto: opts.asunto, via: 'smtp' },
      });
      throw e;
    }

    this.monitor.registrar({
      nivel: 'info',
      tipo: 'correo',
      mensaje: `Correo enviado a ${para} · "${opts.asunto.trim()}"`,
      metadata: { para, asunto: opts.asunto.trim(), via: 'smtp' },
    });
    this.logger.log(`Correo transaccional enviado a ${para}: ${info?.messageId || 'ok'}`);
    return { enviado: true, messageId: info?.messageId };
  }

  private buildFrom(opts: SendBulkOptions): string {
    const fromUser = process.env.SMTP_USER!;
    const fromName = (opts.remitenteNombre || process.env.SMTP_FROM_NAME || 'AMSODENT').replace(
      /[<>]/g,
      '',
    );
    return `"${fromName}" <${fromUser}>`;
  }

  private buildAttachments(opts: SendBulkOptions) {
    return [
      ...(opts.inlineAttachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        cid: a.cid,
      })),
      ...(opts.attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    ];
  }

  // ── Tracking de aperturas ────────────────────────────────────────────
  /* (2026-11-26) Cada carga del píxel: la primera deja `abierto_at`; todas suman
     al contador y mueven `ultima_apertura_at` (columnas de la migración
     20261126; si faltan, se sigue anotando solo la primera, como antes). La
     primera apertura de cada persona, además, puede avisar a quien envió
     (ver la regla en comunidad/mailing-aperturas.ts). Nunca lanza: el píxel
     responde su imagen pase lo que pase. */
  private sinContadorHasta = 0; // si faltan las columnas, no se vuelve a probar por 10 minutos

  async registrarApertura(token: string, userAgent?: string): Promise<void> {
    if (!esTokenApertura(token)) return;
    try {
      const client = this.supabase.getClient();
      let conContador = Date.now() >= this.sinContadorHasta;
      let fila: any = null;
      if (conContador) {
        const r = await client.from('mailings_destinatarios').select('id, envio_id, abierto_at, aperturas').eq('token', token).maybeSingle();
        if (r.error && sinColumna(r.error)) {
          conContador = false;
          this.sinContadorHasta = Date.now() + 10 * 60_000;
        } else if (r.error) {
          return;
        } else {
          fila = r.data;
        }
      }
      if (!conContador) {
        const r = await client.from('mailings_destinatarios').select('id, envio_id, abierto_at').eq('token', token).maybeSingle();
        if (r.error) return;
        fila = r.data;
      }
      if (!fila) return; // token que no existe (o envío ya eliminado)

      const ahora = new Date().toISOString();
      const primera = !fila.abierto_at;
      const cambios: Record<string, any> = {};
      if (primera) {
        cambios.abierto_at = ahora;
        cambios.user_agent = userAgent ? userAgent.slice(0, 400) : null;
      }
      if (conContador) {
        cambios.aperturas = (Number(fila.aperturas) || 0) + 1;
        cambios.ultima_apertura_at = ahora;
      }
      if (!Object.keys(cambios).length) return;
      const { error } = await client.from('mailings_destinatarios').update(cambios).eq('id', fila.id);
      if (error) {
        this.logger.warn(`Apertura sin anotar (destinatario ${fila.id}): ${error.message}`);
        return;
      }
      if (primera && fila.envio_id) this.programarAvisoApertura(Number(fila.envio_id));
    } catch (e: any) {
      this.logger.warn(`Apertura sin anotar: ${e?.message || e}`);
    }
  }

  /* Los avisos se revisan a lo más una vez cada 30 s por envío: cuando un
     mailing grande empieza a abrirse llegan muchas aperturas juntas y basta
     con mirar el total una vez (la última revisión queda programada, así el
     número del aviso termina al día). */
  private avisosProgramados = new Map<number, NodeJS.Timeout>();
  private ultimaRevisionAviso = new Map<number, number>();

  private programarAvisoApertura(envioId: number) {
    if (this.avisosProgramados.has(envioId)) return;
    const espera = Math.max(0, (this.ultimaRevisionAviso.get(envioId) || 0) + SEGUNDOS_ENTRE_REVISIONES_AVISO * 1000 - Date.now());
    const t = setTimeout(() => {
      this.avisosProgramados.delete(envioId);
      this.ultimaRevisionAviso.set(envioId, Date.now());
      void this.avisarAperturas(envioId).catch((e) => this.logger.warn(`Envío ${envioId}: aviso de aperturas sin escribir: ${e?.message || e}`));
    }, espera);
    t.unref?.();
    this.avisosProgramados.set(envioId, t);
  }

  /**
   * Escribe (o pone al día) el aviso de la campana de quien envió. Devuelve qué
   * hizo, para las pruebas. La decisión es de `decidirAvisoApertura`.
   */
  async avisarAperturas(envioId: number): Promise<'crear' | 'actualizar' | 'nada'> {
    const client = this.supabase.getClient();
    let { data: envio, error } = await client.from('mailings_envios').select('id, asunto, total, enviados, creado_por, origen').eq('id', envioId).maybeSingle();
    // Sin la migración 20261119 no existe `origen`: el aviso sale igual.
    if (error && sinColumna(error)) ({ data: envio, error } = (await client.from('mailings_envios').select('id, asunto, total, enviados, creado_por').eq('id', envioId).maybeSingle()) as any);
    if (error || !envio) return 'nada';

    // Cuenta acotada a los destinatarios de ESTE envío (índice por envio_id; a lo más unos miles de filas).
    // Se leen los ids en vez de pedir un `count: 'exact'` (regla del proyecto tras el
    // incidente del 23-10: nada de conteos exactos en producción). El tope de filas de
    // la API (1.000) alcanza de sobra para los envíos de hoy (~400 destinatarios).
    const { data: abiertos, error: errCuenta } = await client.from('mailings_destinatarios').select('id').eq('envio_id', envioId).not('abierto_at', 'is', null).limit(5000);
    if (errCuenta) return 'nada';
    const aviso = avisoApertura(envio as any, ((abiertos as any[]) || []).length);
    if (!aviso) return 'nada'; // envío sin autor conocido

    const { data: previos, error: errPrevio } = await client.from('notificaciones')
      .select('id, leida_at, creado_at, metadata')
      .eq('tipo', TIPO_MAILING_APERTURA)
      .eq('metadata->>envio_id', String(envioId))
      .order('id', { ascending: false })
      .limit(1);
    if (errPrevio) {
      this.logger.warn(`Envío ${envioId}: no se leyó el aviso de aperturas anterior: ${errPrevio.message}`);
      return 'nada';
    }
    const previo = (previos || [])[0] as any;
    const decision = decidirAvisoApertura({
      abiertos: aviso.metadata.abiertos,
      enviados: aviso.metadata.enviados,
      previo: previo ? { abiertos: Number(previo.metadata?.abiertos) || 0, leida: !!previo.leida_at, creado_at: previo.creado_at } : null,
    });
    if (decision === 'crear') {
      const { error: e } = await client.from('notificaciones').insert([{ user_email: aviso.destinatario, tipo: TIPO_MAILING_APERTURA, mensaje: aviso.mensaje, link: aviso.link, metadata: aviso.metadata }]);
      if (e) this.logger.warn(`Envío ${envioId}: sin campana para ${aviso.destinatario}: ${e.message}`);
    } else if (decision === 'actualizar') {
      // El mismo aviso, con el número al día y arriba de la lista.
      const { error: e } = await client.from('notificaciones').update({ mensaje: aviso.mensaje, metadata: aviso.metadata, creado_at: new Date().toISOString() }).eq('id', previo.id);
      if (e) this.logger.warn(`Envío ${envioId}: no se actualizó el aviso de aperturas: ${e.message}`);
    }
    return decision;
  }

  async getUltimoEnvio() {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('mailings_envios')
      .select('*')
      .order('creado_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Devuelve los emails que abrieron el último envío.
  // Útil para cruzar con la lista de participantes del sorteo.
  async getEmailsAbiertosDelUltimoEnvio(): Promise<{ envio: any; emails: string[] }> {
    const envio = await this.getUltimoEnvio();
    if (!envio) return { envio: null, emails: [] };

    const { data, error } = await this.supabase
      .getClient()
      .from('mailings_destinatarios')
      .select('email')
      .eq('envio_id', envio.id)
      .not('abierto_at', 'is', null);

    if (error) throw new BadRequestException(error.message);

    const emails = (data || [])
      .map((r: any) => String(r?.email || '').trim().toLowerCase())
      .filter(Boolean);

    return { envio, emails };
  }

  async listarEnvios(limit = 50) {
    const client = this.supabase.getClient();
    const { data: envios, error } = await client
      .from('mailings_envios')
      .select('*')
      .order('creado_at', { ascending: false })
      .limit(limit);
    if (error) throw new BadRequestException(error.message);

    // Para cada envío contamos cuántos abrieron (queryeable barato).
    if (!envios || envios.length === 0) return [];

    const ids = envios.map((e: any) => e.id);
    const { data: aperturas } = await client
      .from('mailings_destinatarios')
      .select('envio_id')
      .in('envio_id', ids)
      .not('abierto_at', 'is', null);

    const counts: Record<number, number> = {};
    (aperturas || []).forEach((r: any) => {
      const id = Number(r?.envio_id);
      counts[id] = (counts[id] || 0) + 1;
    });

    return envios.map((e: any) => ({
      ...e,
      abiertos: counts[Number(e.id)] || 0,
    }));
  }

  async eliminarEnvio(envioId: number) {
    const client = this.supabase.getClient();
    // El FK con on delete cascade borra los destinatarios automáticamente.
    const { error } = await client
      .from('mailings_envios')
      .delete()
      .eq('id', envioId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async getEnvioDetalle(envioId: number) {
    const client = this.supabase.getClient();
    const { data: envio, error: errEnvio } = await client
      .from('mailings_envios')
      .select('*')
      .eq('id', envioId)
      .maybeSingle();
    if (errEnvio) throw new BadRequestException(errEnvio.message);
    if (!envio) return null;

    const { data: destinatarios, error: errDest } = await client
      .from('mailings_destinatarios')
      .select('id, email, enviado_at, abierto_at, fallo, user_agent, creado_at')
      .eq('envio_id', envioId)
      .order('email', { ascending: true });
    if (errDest) throw new BadRequestException(errDest.message);

    const total = (destinatarios || []).length;
    const enviados = (destinatarios || []).filter((d: any) => d?.enviado_at && !d?.fallo).length;
    const fallidos = (destinatarios || []).filter((d: any) => Boolean(d?.fallo)).length;
    const abiertos = (destinatarios || []).filter((d: any) => Boolean(d?.abierto_at)).length;

    return {
      envio,
      destinatarios: destinatarios || [],
      stats: { total, enviados, fallidos, abiertos },
    };
  }
}

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
