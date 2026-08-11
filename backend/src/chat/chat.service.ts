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

  /* ── Puente grupo de WhatsApp → Chat Grupal (sentido entrante) ───────────
     Green API entrega los mensajes recibidos por webhook. Este método traduce
     ese webhook a una fila de `chat_mensajes` en la sala General; de ahí en
     adelante no hay que tocar el frontend, porque el chat ya escucha los
     INSERT por Supabase Realtime y el mensaje aparece solo en las pantallas
     abiertas.

     Tres cosas que hay que hacer bien o el puente se vuelve un problema:
      · Ignorar lo SALIENTE. Green API también notifica los mensajes que
        mandamos nosotros; reinsertarlos duplicaría en el chat todo lo que ya
        se escribió ahí.
      · Ignorar otros chats. Solo entra lo del grupo configurado en
        WHATSAPP_GROUP_ID; los mensajes privados al número no son del equipo.
      · No duplicar. Si no respondemos 200 a tiempo, Green API reintenta el
        mismo webhook: `wa_message_id` con índice único corta el duplicado. */
  /* `chat_mensajes.tipo` tiene un CHECK que solo admite estos valores, así que
     el mime se traduce a uno de ellos. Lo que no calza entra como 'texto' con
     el nombre del archivo a la vista: mejor eso que perder el mensaje, o que
     etiquetar una planilla como PDF y que el visor no sepa abrirla. */
  private static tipoDeMime(mime: string): string {
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'imagen';
    if (m.startsWith('audio/')) return 'audio';
    if (m === 'application/pdf') return 'pdf';
    return 'texto';
  }

  /** Traduce el remitente de WhatsApp a un autor con el que el chat sabe operar. */
  private static autorDeWhatsapp(senderData: any) {
    // `sender` viene como "56912345678@c.us". El chat guarda `autor_email` como
    // texto libre y no tiene clave foránea a usuarios, así que se sintetiza un
    // identificador estable y reconocible: no colisiona con un correo real y
    // deja claro de dónde salió el mensaje.
    const jid = String(senderData?.sender || '').trim();
    const telefono = jid.split('@')[0].replace(/[^\d]/g, '');
    const nombre = String(senderData?.senderName || senderData?.chatName || '').trim();
    return {
      email: `${telefono || 'desconocido'}@whatsapp`,
      nombre: nombre || (telefono ? `+${telefono}` : 'WhatsApp'),
    };
  }

  /** Saca el texto y, si lo hay, el adjunto de los distintos tipos de mensaje. */
  private static contenidoDeWhatsapp(messageData: any) {
    const t = String(messageData?.typeMessage || '');
    if (t === 'textMessage') {
      return { tipo: 'texto', texto: String(messageData?.textMessageData?.textMessage || '') };
    }
    if (t === 'extendedTextMessage') {
      return { tipo: 'texto', texto: String(messageData?.extendedTextMessageData?.text || '') };
    }
    const f = messageData?.fileMessageData;
    if (f?.downloadUrl) {
      const tipo = ChatService.tipoDeMime(f.mimeType);
      const nombre = String(f.fileName || 'archivo');
      const caption = String(f.caption || '');
      return {
        tipo,
        // Un archivo que el chat no sabe previsualizar entra como texto: ahí el
        // nombre tiene que ir escrito o el mensaje se vería vacío.
        texto: tipo === 'texto' ? [`📎 ${nombre}`, caption].filter(Boolean).join(' · ') : caption,
        adjunto_url: String(f.downloadUrl),
        adjunto_nombre: nombre,
        adjunto_mime: String(f.mimeType || ''),
      };
    }
    // Ubicaciones, contactos, encuestas…: se deja constancia en vez de
    // descartarlos en silencio, para que la conversación no quede coja.
    if (t) return { tipo: 'texto', texto: `[${t} recibido por WhatsApp]` };
    return null;
  }

  async recibirWhatsApp(payload: any) {
    const tipoWebhook = String(payload?.typeWebhook || '');
    // Green API manda muchos tipos (estados de envío, salientes, etc.).
    if (tipoWebhook !== 'incomingMessageReceived') return { ok: true, motivo: 'ignorado', tipo: tipoWebhook };

    const grupo = (process.env.WHATSAPP_GROUP_ID || '').trim();
    const chatId = String(payload?.senderData?.chatId || '').trim();
    if (!grupo) return { ok: false, motivo: 'sin_grupo_configurado' };
    if (chatId !== grupo) return { ok: true, motivo: 'otro_chat' };

    const idMensaje = String(payload?.idMessage || '').trim();
    const contenido = ChatService.contenidoDeWhatsapp(payload?.messageData);
    if (!contenido || (!contenido.texto && !contenido.adjunto_url)) {
      return { ok: true, motivo: 'sin_contenido' };
    }

    const client = this.supabase.getClient();
    const { data: sala, error: errSala } = await client
      .from('chat_salas')
      .select('id')
      .eq('es_general', true)
      .maybeSingle();
    if (errSala) throw new BadRequestException(errSala.message);
    if (!sala?.id) return { ok: false, motivo: 'sin_sala_general' };

    const autor = ChatService.autorDeWhatsapp(payload?.senderData);
    const fila: any = {
      sala_id: sala.id,
      autor_email: autor.email,
      autor_nombre: autor.nombre,
      tipo: contenido.tipo,
      texto: contenido.texto ? contenido.texto.slice(0, 4000) : null,
      adjunto_url: contenido.adjunto_url || null,
      adjunto_nombre: contenido.adjunto_nombre || null,
      adjunto_mime: contenido.adjunto_mime || null,
      wa_message_id: idMensaje || null,
    };

    const { error } = await client.from('chat_mensajes').insert([fila]);
    if (error) {
      // Choque contra el índice único: es un reintento del webhook, no un fallo.
      if (/duplicate key|23505/i.test(error.message)) return { ok: true, motivo: 'repetido' };
      // La columna nueva puede no existir aún (la migración se aplica a mano):
      // se reintenta sin ella para que el puente funcione igual, aceptando que
      // un reintento de Green API podría duplicar el mensaje.
      if (/wa_message_id|column|schema cache/i.test(error.message)) {
        delete fila.wa_message_id;
        const { error: err2 } = await client.from('chat_mensajes').insert([fila]);
        if (err2) throw new BadRequestException(err2.message);
        return { ok: true, sin_migracion: true };
      }
      throw new BadRequestException(error.message);
    }
    return { ok: true };
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
