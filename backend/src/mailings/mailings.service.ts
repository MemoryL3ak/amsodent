import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

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

  constructor(private supabase: SupabaseService) {}

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
      // smtp.gmail.com a una IPv6 y falla con ENETUNREACH.
      family: 4,
    } as any);
    return this.transporter;
  }

  private getApiBaseUrl(): string {
    return (
      process.env.PUBLIC_API_URL ||
      process.env.API_URL ||
      `http://localhost:${process.env.PORT || 3001}/api`
    );
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

    if (opts.conTracking) {
      return this.sendIndividualConTracking(opts, unicos);
    }
    return this.sendByBatchesBCC(opts, unicos);
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
      const trackingPixel =
        `<img src="${baseUrl}/mailings/track/open?t=${encodeURIComponent(row.token)}" ` +
        `width="1" height="1" border="0" alt="" ` +
        `style="display:block;width:1px;height:1px;border:0;" />`;
      const htmlConPixel = `${opts.cuerpoHtml}${trackingPixel}`;

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
  async registrarApertura(token: string, userAgent?: string): Promise<void> {
    if (!token) return;
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('mailings_destinatarios')
      .select('id, abierto_at')
      .eq('token', token)
      .maybeSingle();

    if (error || !data) {
      this.logger.warn(`Token de tracking no encontrado: ${token.slice(0, 8)}…`);
      return;
    }

    if (!data.abierto_at) {
      await client
        .from('mailings_destinatarios')
        .update({
          abierto_at: new Date().toISOString(),
          user_agent: userAgent ? userAgent.slice(0, 400) : null,
        })
        .eq('id', data.id);
    }
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
