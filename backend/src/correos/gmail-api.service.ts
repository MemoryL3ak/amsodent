import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import MailComposer = require('nodemailer/lib/mail-composer');

// Acceso a Gmail desde el backend, en dos modos:
// 1) OAuth por usuario — el vendedor conecta su cuenta de Google (botón
//    "Conectar cuenta" o sign-in con Google) y guardamos su refresh_token.
// 2) Domain-Wide Delegation (DWD) — usamos una cuenta de servicio del
//    proyecto de Google Cloud autorizada por el admin de Workspace a
//    suplantar a cualquier usuario del dominio configurado. Permite que
//    cualquier @amsodentmedical.cl envíe correos automáticamente sin pasar
//    por consentimiento individual.

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  // Crear eventos en el calendario del usuario (reuniones con Google Meet).
  'https://www.googleapis.com/auth/calendar.events',
];

const SCOPES_DWD = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

// Credenciales para operar Gmail en nombre de un usuario.
export type GmailCreds =
  | { modo: 'oauth'; refreshToken: string }
  | { modo: 'dwd'; email: string };

export type EnviarComoOpts = {
  remitente: string;
  para: string;
  cc?: string[];
  asunto: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

export type MensajeLista = {
  id: string;
  threadId: string;
  de: string;
  deNombre: string;
  para: string;
  asunto: string;
  fecha: string; // ISO
  snippet: string;
  leido: boolean;
  destacado: boolean;
  labelIds: string[];
};

export type CuentaConectada = {
  email: string;
  refreshToken: string;
  scopes: string;
};

@Injectable()
export class GmailApiService {
  private readonly logger = new Logger(GmailApiService.name);

  // ── Configuración OAuth ──────────────────────────────────────────────
  configurado(): boolean {
    return Boolean(
      (process.env.GOOGLE_CLIENT_ID || '').trim() &&
        (process.env.GOOGLE_CLIENT_SECRET || '').trim() &&
        (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim(),
    );
  }

  private oauth2Client() {
    const id = (process.env.GOOGLE_CLIENT_ID || '').trim();
    const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const redirect = (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
    if (!id || !secret || !redirect) {
      throw new BadRequestException(
        'La conexión con Google no está configurada en el servidor.',
      );
    }
    return new google.auth.OAuth2(id, secret, redirect);
  }

  // URL de consentimiento de Google. `state` viaja de ida y vuelta para
  // identificar al usuario que está conectando su cuenta.
  urlConsentimiento(state: string): string {
    return this.oauth2Client().generateAuthUrl({
      access_type: 'offline',
      // 'select_account' fuerza el selector de cuenta; 'consent' garantiza
      // que Google entregue un refresh_token aunque ya se haya autorizado.
      prompt: 'select_account consent',
      scope: SCOPES,
      include_granted_scopes: true,
      state,
    });
  }

  // Intercambia el `code` del callback por el refresh_token y el correo.
  async intercambiarCodigo(code: string): Promise<CuentaConectada> {
    const cliente = this.oauth2Client();
    const { tokens } = await cliente.getToken(String(code || '').trim());
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google no entregó un token de actualización. Vuelve a intentar la conexión.',
      );
    }
    cliente.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: cliente });
    const info = await oauth2.userinfo.get();
    const email = String(info.data?.email || '').trim().toLowerCase();
    if (!email) {
      throw new BadRequestException(
        'No se pudo determinar el correo de la cuenta de Google.',
      );
    }
    return {
      email,
      refreshToken: tokens.refresh_token,
      scopes: tokens.scope || SCOPES.join(' '),
    };
  }

  // Cliente Gmail autenticado según el modo (OAuth por usuario o DWD).
  private clienteGmail(creds: GmailCreds | string) {
    // Compatibilidad: si recibimos un string, asumimos OAuth refreshToken.
    if (typeof creds === 'string') {
      const token = creds.trim();
      if (!token) {
        throw new BadRequestException('La cuenta de correo no está conectada.');
      }
      const cliente = this.oauth2Client();
      cliente.setCredentials({ refresh_token: token });
      return google.gmail({ version: 'v1', auth: cliente });
    }
    if (creds.modo === 'oauth') {
      if (!creds.refreshToken) {
        throw new BadRequestException('La cuenta de correo no está conectada.');
      }
      const cliente = this.oauth2Client();
      cliente.setCredentials({ refresh_token: creds.refreshToken });
      return google.gmail({ version: 'v1', auth: cliente });
    }
    // modo === 'dwd' — impersonación con cuenta de servicio
    const jwt = this.jwtImpersonando(creds.email);
    return google.gmail({ version: 'v1', auth: jwt });
  }

  // ── Service Account con Domain-Wide Delegation ───────────────────────
  configuradoDWD(): boolean {
    return Boolean(
      (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim() &&
        (process.env.GOOGLE_WORKSPACE_DOMAIN || '').trim(),
    );
  }

  dominioWorkspace(): string {
    return String(process.env.GOOGLE_WORKSPACE_DOMAIN || '').trim().toLowerCase();
  }

  // Devuelve true si el correo dado puede usar Gmail vía service account
  // (porque pertenece al dominio configurado en Workspace y la app tiene
  // las credenciales del service account).
  puedeImpersonar(email: string): boolean {
    if (!this.configuradoDWD()) return false;
    const dominio = this.dominioWorkspace();
    return String(email || '').toLowerCase().endsWith('@' + dominio);
  }

  private credencialesServiceAccount() {
    const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) {
      throw new BadRequestException(
        'GOOGLE_SERVICE_ACCOUNT_JSON no está configurado en el servidor.',
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new BadRequestException(
        'GOOGLE_SERVICE_ACCOUNT_JSON contiene JSON inválido.',
      );
    }
  }

  private jwtImpersonando(email: string) {
    const sa = this.credencialesServiceAccount();
    const subject = String(email || '').trim().toLowerCase();
    if (!subject) {
      throw new BadRequestException('Falta el correo a impersonar.');
    }
    if (!this.puedeImpersonar(subject)) {
      throw new BadRequestException(
        `El correo ${subject} no pertenece al dominio Workspace configurado.`,
      );
    }
    return new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: SCOPES_DWD,
      subject,
    });
  }

  // ── Envío ────────────────────────────────────────────────────────────
  async enviarComo(
    creds: GmailCreds | string,
    opts: EnviarComoOpts,
  ): Promise<{ enviado: boolean; messageId?: string }> {
    const gmail = this.clienteGmail(creds);
    const raw = await this.construirRaw(opts);
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    this.logger.log(
      `Correo enviado vía Gmail API como ${opts.remitente} → ${opts.para} (${res.data?.id || 'ok'}).`,
    );
    return { enviado: true, messageId: res.data?.id || undefined };
  }

  private construirRaw(opts: EnviarComoOpts): Promise<string> {
    return new Promise((resolve, reject) => {
      const cc = (opts.cc || []).filter(Boolean).join(', ');
      const composer = new MailComposer({
        from: opts.remitente,
        to: opts.para,
        cc: cc || undefined,
        subject: opts.asunto,
        html: opts.html,
        text: stripHtml(opts.html),
        attachments: opts.attachments,
      });
      composer.compile().build((err: Error | null, message: Buffer) => {
        if (err) return reject(err);
        resolve(base64url(message));
      });
    });
  }

  // ── Lectura del buzón ────────────────────────────────────────────────
  // Acepta una carpeta del sistema (recibidos, destacados, enviados, spam,
  // papelera, borradores) o el id de una etiqueta custom del usuario.
  async listarMensajes(
    creds: GmailCreds | string,
    opts: {
      carpeta?:
        | 'recibidos'
        | 'destacados'
        | 'enviados'
        | 'spam'
        | 'papelera'
        | 'borradores';
      labelId?: string;
      q?: string;
      maxResults?: number;
      pageToken?: string;
    },
  ): Promise<{ mensajes: MensajeLista[]; nextPageToken?: string; total: number }> {
    const gmail = this.clienteGmail(creds);
    const { labelIds, includeSpamTrash } = this.resolverCarpeta(opts.carpeta, opts.labelId);
    const maxResults = Math.min(Math.max(Number(opts.maxResults) || 25, 1), 50);

    // Cuando hay texto de búsqueda, buscar en TODO el correo (como Gmail) en vez
    // de limitar a la carpeta/etiqueta actual: así un correo que está en otra
    // carpeta también aparece. Sin texto, se respeta la carpeta seleccionada.
    const tieneBusqueda = Boolean((opts.q || '').trim());

    const lista = await gmail.users.messages.list({
      userId: 'me',
      labelIds: tieneBusqueda ? undefined : labelIds,
      q: opts.q || undefined,
      maxResults,
      pageToken: opts.pageToken || undefined,
      includeSpamTrash: tieneBusqueda ? true : includeSpamTrash,
    });

    const ids = (lista.data.messages || []).map((m) => m.id!).filter(Boolean);
    const mensajes: MensajeLista[] = await Promise.all(
      ids.map(async (id) => {
        const r = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });
        return this.aMensajeLista(r.data);
      }),
    );

    return {
      mensajes,
      nextPageToken: lista.data.nextPageToken || undefined,
      total: lista.data.resultSizeEstimate || mensajes.length,
    };
  }

  private resolverCarpeta(
    carpeta: string | undefined,
    labelId: string | undefined,
  ): { labelIds: string[]; includeSpamTrash: boolean } {
    if (labelId) return { labelIds: [labelId], includeSpamTrash: true };
    switch (carpeta) {
      case 'destacados':
        return { labelIds: ['STARRED'], includeSpamTrash: false };
      case 'enviados':
        return { labelIds: ['SENT'], includeSpamTrash: false };
      case 'spam':
        return { labelIds: ['SPAM'], includeSpamTrash: true };
      case 'papelera':
        return { labelIds: ['TRASH'], includeSpamTrash: true };
      case 'borradores':
        return { labelIds: ['DRAFT'], includeSpamTrash: false };
      case 'recibidos':
      default:
        return { labelIds: ['INBOX'], includeSpamTrash: false };
    }
  }

  async obtenerMensaje(creds: GmailCreds | string, id: string) {
    const gmail = this.clienteGmail(creds);
    const r = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const data = r.data;
    const headers = (data.payload?.headers || []) as Array<{ name: string; value: string }>;
    const h = (n: string) =>
      headers.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value || '';

    const html = buscarParte(data.payload, 'text/html');
    const texto = buscarParte(data.payload, 'text/plain');
    const cuerpoHtml = html
      ? decodificar(html)
      : texto
        ? `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(decodificar(texto))}</pre>`
        : '';

    const adjuntos = recolectarAdjuntos(data.payload).map((a) => ({
      attachmentId: a.attachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
    }));

    const dir = parseDireccion(h('From'));
    return {
      id: data.id,
      threadId: data.threadId,
      de: dir.email,
      deNombre: dir.nombre,
      para: h('To'),
      cc: h('Cc'),
      asunto: h('Subject'),
      fecha: aIso(data.internalDate, h('Date')),
      cuerpoHtml,
      adjuntos,
      leido: !(data.labelIds || []).includes('UNREAD'),
    };
  }

  async marcarLeido(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }

  async marcarNoLeido(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { addLabelIds: ['UNREAD'] },
    });
  }

  async archivar(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { removeLabelIds: ['INBOX'] },
    });
  }

  async moverPapelera(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.trash({ userId: 'me', id });
  }

  async restaurar(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.untrash({ userId: 'me', id });
  }

  async marcarNoSpam(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] },
    });
  }

  async destacar(creds: GmailCreds | string, id: string, on: boolean): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: on
        ? { addLabelIds: ['STARRED'] }
        : { removeLabelIds: ['STARRED'] },
    });
  }

  // ── Etiquetas (carpetas custom estilo Gmail) ─────────────────────────
  async listarEtiquetas(creds: GmailCreds | string) {
    const gmail = this.clienteGmail(creds);
    const r = await gmail.users.labels.list({ userId: 'me' });
    const todas = r.data.labels || [];
    // Solo las creadas por el usuario (no las del sistema como INBOX, SPAM…).
    const custom = todas.filter((l) => l.type === 'user');
    // Pedimos en paralelo los contadores para cada etiqueta custom.
    const conConteos = await Promise.all(
      custom.map(async (l) => {
        try {
          const det = await gmail.users.labels.get({ userId: 'me', id: l.id! });
          return {
            id: l.id,
            name: l.name,
            total: Number(det.data.messagesTotal || 0),
            unread: Number(det.data.messagesUnread || 0),
          };
        } catch {
          return { id: l.id, name: l.name, total: 0, unread: 0 };
        }
      }),
    );
    return conConteos.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || '')),
    );
  }

  async crearEtiqueta(creds: GmailCreds | string, nombre: string) {
    const gmail = this.clienteGmail(creds);
    const r = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: String(nombre || '').trim(),
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    return { id: r.data.id, name: r.data.name, total: 0, unread: 0 };
  }

  async eliminarEtiqueta(creds: GmailCreds | string, id: string): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.labels.delete({ userId: 'me', id });
  }

  async aplicarEtiqueta(
    creds: GmailCreds | string,
    messageId: string,
    labelId: string,
  ): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: [labelId] },
    });
  }

  async quitarEtiqueta(
    creds: GmailCreds | string,
    messageId: string,
    labelId: string,
  ): Promise<void> {
    const gmail = this.clienteGmail(creds);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: [labelId] },
    });
  }

  // Conteos para las carpetas del sistema (recibidos, destacados, spam,
  // papelera, borradores). Útil para mostrar badges en la sidebar.
  async contarCarpetas(creds: GmailCreds | string) {
    const gmail = this.clienteGmail(creds);
    const ids = ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'SPAM', 'TRASH'];
    const data = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await gmail.users.labels.get({ userId: 'me', id });
          return {
            id,
            total: Number(r.data.messagesTotal || 0),
            unread: Number(r.data.messagesUnread || 0),
          };
        } catch {
          return { id, total: 0, unread: 0 };
        }
      }),
    );
    const por = Object.fromEntries(data.map((d) => [d.id, { total: d.total, unread: d.unread }]));
    return {
      recibidos: por.INBOX || { total: 0, unread: 0 },
      destacados: por.STARRED || { total: 0, unread: 0 },
      enviados: por.SENT || { total: 0, unread: 0 },
      borradores: por.DRAFT || { total: 0, unread: 0 },
      spam: por.SPAM || { total: 0, unread: 0 },
      papelera: por.TRASH || { total: 0, unread: 0 },
    };
  }

  async obtenerAdjunto(creds: GmailCreds | string, messageId: string, attachmentId: string) {
    const gmail = this.clienteGmail(creds);
    const r = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    return Buffer.from(String(r.data?.data || ''), 'base64url');
  }

  // Destinatarios recientes: a quiénes ha escrito el usuario últimamente
  // (extraídos del header `To` de los últimos correos enviados).
  async destinatariosRecientes(creds: GmailCreds | string): Promise<Array<{ email: string; nombre: string }>> {
    const gmail = this.clienteGmail(creds);
    const lista = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['SENT'],
      maxResults: 30,
    });
    const ids = (lista.data.messages || []).map((m) => m.id!).filter(Boolean);
    const headers = await Promise.all(
      ids.map(async (id) => {
        const r = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['To'],
        });
        const hs = (r.data.payload?.headers || []) as Array<{ name: string; value: string }>;
        return hs.find((h) => h.name?.toLowerCase() === 'to')?.value || '';
      }),
    );
    const mapa = new Map<string, { email: string; nombre: string }>();
    for (const valor of headers) {
      for (const parte of String(valor || '').split(/,/)) {
        const dir = parseDireccion(parte.trim());
        const k = dir.email.toLowerCase();
        if (!k || !k.includes('@')) continue;
        if (!mapa.has(k)) {
          mapa.set(k, { email: dir.email, nombre: dir.nombre !== dir.email ? dir.nombre : '' });
        }
      }
    }
    return Array.from(mapa.values()).slice(0, 50);
  }

  async contarNoLeidos(creds: GmailCreds | string): Promise<number> {
    const gmail = this.clienteGmail(creds);
    const r = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    return Number(r.data?.messagesUnread || 0);
  }

  private aMensajeLista(data: any): MensajeLista {
    const headers = (data.payload?.headers || []) as Array<{ name: string; value: string }>;
    const h = (n: string) =>
      headers.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value || '';
    const dir = parseDireccion(h('From'));
    const labelIds = (data.labelIds || []) as string[];
    return {
      id: data.id,
      threadId: data.threadId,
      de: dir.email,
      deNombre: dir.nombre,
      para: h('To'),
      asunto: h('Subject'),
      fecha: aIso(data.internalDate, h('Date')),
      snippet: decodeHtmlEntities(data.snippet || ''),
      leido: !labelIds.includes('UNREAD'),
      destacado: labelIds.includes('STARRED'),
      labelIds,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodificar(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

// Busca recursivamente la primera parte con el mimeType dado y devuelve su data.
function buscarParte(payload: any, mime: string): string | null {
  if (!payload) return null;
  if (payload.mimeType === mime && payload.body?.data) return payload.body.data;
  for (const p of payload.parts || []) {
    const r = buscarParte(p, mime);
    if (r) return r;
  }
  return null;
}

function recolectarAdjuntos(
  payload: any,
  acc: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> = [],
) {
  if (!payload) return acc;
  if (payload.filename && payload.body?.attachmentId) {
    acc.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename,
      mimeType: payload.mimeType || 'application/octet-stream',
      size: Number(payload.body.size || 0),
    });
  }
  for (const p of payload.parts || []) recolectarAdjuntos(p, acc);
  return acc;
}

function parseDireccion(str: string): { nombre: string; email: string } {
  const s = String(str || '').trim();
  const m = s.match(/^(.*?)<([^>]+)>$/);
  if (m) {
    return {
      nombre: m[1].trim().replace(/^"|"$/g, '') || m[2].trim(),
      email: m[2].trim(),
    };
  }
  return { nombre: s, email: s };
}

function aIso(internalDate?: string | null, headerDate?: string): string {
  if (internalDate) {
    const n = Number(internalDate);
    if (n > 0) return new Date(n).toISOString();
  }
  const d = headerDate ? new Date(headerDate) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeHtmlEntities(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
