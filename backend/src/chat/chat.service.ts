import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const fetchGlobal: any = (globalThis as any).fetch;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private supabase: SupabaseService) {}

  // ── Puente Chat Grupal → grupo de WhatsApp ──────────────────────────────
  // Reenvía los mensajes de la sala GENERAL a un grupo de WhatsApp usando
  // Green API (green-api.com: se vincula un número escaneando un QR y expone
  // API REST que SÍ envía a grupos — la API oficial de Meta no lo permite).
  // Config en .env: WHATSAPP_GA_INSTANCE, WHATSAPP_GA_TOKEN, WHATSAPP_GROUP_ID
  // (chatId del grupo, formato 1203...@g.us). Sin config, no hace nada.
  whatsappConfigurado(): boolean {
    return Boolean(
      (process.env.WHATSAPP_GA_INSTANCE || '').trim() &&
      (process.env.WHATSAPP_GA_TOKEN || '').trim() &&
      (process.env.WHATSAPP_GROUP_ID || '').trim(),
    );
  }

  async enviarWhatsApp(opts: {
    autor?: string;
    texto?: string;
    tipo?: string;
    adjunto_url?: string;
    file_name?: string;
  }) {
    if (!this.whatsappConfigurado()) return { ok: false, motivo: 'no_configurado' };
    const instancia = (process.env.WHATSAPP_GA_INSTANCE || '').trim();
    const token = (process.env.WHATSAPP_GA_TOKEN || '').trim();
    const grupo = (process.env.WHATSAPP_GROUP_ID || '').trim();
    const base = (process.env.WHATSAPP_GA_URL || 'https://api.green-api.com').trim().replace(/\/$/, '');

    const autor = String(opts.autor || '').trim().slice(0, 80);
    const texto = String(opts.texto || '').trim().slice(0, 3000);
    const tipo = String(opts.tipo || 'texto');
    const adjunto = String(opts.adjunto_url || '').trim();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      let url: string;
      let body: any;
      if (tipo !== 'texto' && /^https?:\/\//i.test(adjunto)) {
        // Adjuntos: se envían por URL pública (bucket chat-adjuntos) con caption.
        url = `${base}/waInstance${instancia}/sendFileByUrl/${token}`;
        body = {
          chatId: grupo,
          urlFile: adjunto,
          fileName: String(opts.file_name || 'archivo').slice(0, 120) || 'archivo',
          caption: autor ? `*${autor}*${texto ? `: ${texto}` : ''}` : texto,
        };
      } else {
        if (!texto) return { ok: false, motivo: 'sin_texto' };
        url = `${base}/waInstance${instancia}/sendMessage/${token}`;
        body = { chatId: grupo, message: autor ? `*${autor}*: ${texto}` : texto };
      }
      const res = await fetchGlobal(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        this.logger.warn(`WhatsApp bridge ${res.status}: ${String(t).slice(0, 200)}`);
        return { ok: false, motivo: `http_${res.status}` };
      }
      return { ok: true };
    } catch (e: any) {
      this.logger.warn(`WhatsApp bridge error: ${e?.message || e}`);
      return { ok: false, motivo: 'error_red' };
    } finally {
      clearTimeout(timer);
    }
  }

  // Borra todos los mensajes de TODAS las salas (incluida la General).
  // Las salas y miembros se mantienen — solo limpia el historial.
  async limpiarTodasSalas() {
    const { data, error } = await this.supabase
      .getClient()
      .from('chat_mensajes')
      .delete()
      .gt('created_at', '1900-01-01') // condición trivialmente cierta para borrar todo
      .select('id');
    if (error) throw new BadRequestException(error.message);
    const eliminados = (data || []).length;
    this.logger.warn(`Chat limpiado completo: ${eliminados} mensajes eliminados.`);
    return { ok: true, eliminados };
  }

  // Notificación genérica del chat (sala eliminada, etc.). Inserta un row
  // por cada destinatario. Bypassa RLS con service_role.
  async notificarEvento(opts: {
    tipo: string;
    mensaje: string;
    emails: string[];
    link?: string;
    metadata?: Record<string, unknown>;
  }) {
    const limpios = (opts.emails || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean);
    if (limpios.length === 0) return { ok: true, creadas: 0 };
    const rows = limpios.map((user_email) => ({
      user_email,
      tipo: opts.tipo,
      mensaje: opts.mensaje,
      link: opts.link || '/bitacora-cotizaciones',
      metadata: opts.metadata || {},
    }));
    const { error } = await this.supabase.getClient().from('notificaciones').insert(rows);
    if (error) {
      this.logger.error(`No se pudo notificar evento ${opts.tipo}: ${error.message}`);
    }
    return { ok: true, creadas: rows.length };
  }

  // Genera notificaciones para los usuarios recién agregados a una sala.
  // Llamado desde el frontend cuando se agregan miembros — usa service_role
  // para bypassar RLS de la tabla notificaciones.
  async notificarInvitacionSala(
    salaId: string,
    emails: string[],
    invitadoPor: string,
  ) {
    const client = this.supabase.getClient();
    const limpios = (emails || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean);
    if (limpios.length === 0) return { ok: true, creadas: 0 };

    // Traer el nombre de la sala para que la notificación sea informativa
    const { data: sala } = await client
      .from('chat_salas')
      .select('nombre')
      .eq('id', salaId)
      .maybeSingle();
    const nombreSala = sala?.nombre || 'una sala de chat';

    // Nombre de quien invita (si hay perfil)
    const invitador = String(invitadoPor || '').trim().toLowerCase();
    let nombreInvitador = invitador;
    if (invitador) {
      const { data: p } = await client
        .from('profiles')
        .select('nombre')
        .ilike('email', invitador)
        .maybeSingle();
      nombreInvitador = p?.nombre || invitador;
    }

    const rows = limpios.map((user_email) => ({
      user_email,
      tipo: 'chat_invitacion',
      mensaje: `${nombreInvitador} te agregó a la sala "${nombreSala}".`,
      link: `/bitacora-cotizaciones`,
      metadata: { sala_id: salaId },
    }));
    const { error } = await client.from('notificaciones').insert(rows);
    if (error) {
      this.logger.error(`No se pudo notificar invitación: ${error.message}`);
      // No bloqueamos — la invitación ya quedó en chat_sala_miembros
    }
    return { ok: true, creadas: rows.length };
  }
}
