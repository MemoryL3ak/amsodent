// Helper para enviar correos via Gmail API en nombre del usuario autenticado
// con OAuth (token vivo). Construye el MIME multipart manualmente (sin nodemailer)
// para mantener el módulo de Comunicaciones desacoplado del transporter SMTP.
//
// Referencias:
//   https://developers.google.com/gmail/api/reference/rest/v1/users.messages/send
//   https://datatracker.ietf.org/doc/html/rfc5322  (MIME headers)
//   https://datatracker.ietf.org/doc/html/rfc2045  (MIME content-type)

const GMAIL_SEND_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export type GmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type GmailSendInput = {
  accessToken: string;
  fromEmail: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: GmailAttachment[];
  // Si el usuario quiere que el cliente responda a otro email (poco común,
  // pero útil si la cuenta enviadora es genérica).
  replyTo?: string;
};

export type GmailSendResult = {
  id: string; // message id retornado por Gmail
  threadId?: string;
  labelIds?: string[];
};

// ── Helpers internos ─────────────────────────────────────────────────────────

function base64urlEncode(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Codifica un header en formato RFC 2047 si tiene caracteres no-ASCII.
// Ej: "Áéíóú" → "=?utf-8?B?w4HDqcOtw7PDug==?="
function encodeHeader(value: string): string {
  if (!value) return '';
  const s = String(value);
  // Solo codifica si hay caracteres fuera de ASCII imprimible.
  if (!/[^\x20-\x7e]/.test(s)) return s;
  return `=?utf-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function formatFrom(email: string, name?: string): string {
  if (!name) return email;
  // Si el nombre tiene comas o caracteres especiales, va entre comillas.
  const needsQuotes = /[,;<>@()"\\]/.test(name);
  const safeName = needsQuotes ? `"${name.replace(/"/g, '\\"')}"` : name;
  return `${encodeHeader(safeName)} <${email}>`;
}

function joinAddresses(list?: string[]): string {
  return (list || [])
    .map((e) => String(e || '').trim())
    .filter(Boolean)
    .join(', ');
}

function randomBoundary(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

// ── Construcción MIME ────────────────────────────────────────────────────────

function buildMimeMessage(input: GmailSendInput): string {
  const {
    fromEmail,
    fromName,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    attachments,
    replyTo,
  } = input;

  const hasAttachments = (attachments?.length || 0) > 0;
  const hasText = Boolean(text && text.trim());

  // Encabezados comunes
  const headers: string[] = [];
  headers.push(`From: ${formatFrom(fromEmail, fromName)}`);
  headers.push(`To: ${joinAddresses(to)}`);
  if (cc?.length) headers.push(`Cc: ${joinAddresses(cc)}`);
  if (bcc?.length) headers.push(`Bcc: ${joinAddresses(bcc)}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push(`MIME-Version: 1.0`);
  headers.push(`Date: ${new Date().toUTCString()}`);

  // ── Caso 1: solo HTML, sin adjuntos ────────────────────────────────────────
  if (!hasAttachments && !hasText) {
    headers.push(`Content-Type: text/html; charset="UTF-8"`);
    headers.push(`Content-Transfer-Encoding: base64`);
    const body = Buffer.from(html, 'utf8').toString('base64');
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }

  // ── Caso 2: HTML + plain text, sin adjuntos → multipart/alternative ────────
  if (!hasAttachments && hasText) {
    const altBoundary = randomBoundary('alt');
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    const parts: string[] = [];
    parts.push(
      [
        `--${altBoundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        '',
        Buffer.from(text!, 'utf8').toString('base64'),
      ].join('\r\n'),
    );
    parts.push(
      [
        `--${altBoundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        '',
        Buffer.from(html, 'utf8').toString('base64'),
      ].join('\r\n'),
    );
    parts.push(`--${altBoundary}--`);
    return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
  }

  // ── Caso 3: con adjuntos → multipart/mixed ─────────────────────────────────
  const mixedBoundary = randomBoundary('mix');
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

  const parts: string[] = [];

  // Primera parte: el contenido (HTML o multipart/alternative si hay text).
  if (hasText) {
    const altBoundary = randomBoundary('alt');
    const altSection: string[] = [];
    altSection.push(`--${mixedBoundary}`);
    altSection.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    altSection.push('');
    altSection.push(
      [
        `--${altBoundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        '',
        Buffer.from(text!, 'utf8').toString('base64'),
      ].join('\r\n'),
    );
    altSection.push(
      [
        `--${altBoundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        '',
        Buffer.from(html, 'utf8').toString('base64'),
      ].join('\r\n'),
    );
    altSection.push(`--${altBoundary}--`);
    parts.push(altSection.join('\r\n'));
  } else {
    parts.push(
      [
        `--${mixedBoundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        '',
        Buffer.from(html, 'utf8').toString('base64'),
      ].join('\r\n'),
    );
  }

  // Adjuntos
  for (const att of attachments || []) {
    const partLines = [
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType}; name="${encodeHeader(att.filename)}"`,
      `Content-Disposition: attachment; filename="${encodeHeader(att.filename)}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      // base64 a 76 chars por línea para compatibilidad
      att.content.toString('base64').replace(/(.{76})/g, '$1\r\n'),
    ];
    parts.push(partLines.join('\r\n'));
  }

  parts.push(`--${mixedBoundary}--`);

  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

// ── Send ─────────────────────────────────────────────────────────────────────

export async function gmailApiSend(input: GmailSendInput): Promise<GmailSendResult> {
  const mime = buildMimeMessage(input);
  const raw = base64urlEncode(mime);

  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  const json: any = await res.json();
  if (!res.ok) {
    const detail = json?.error?.message || res.statusText;
    throw new Error(`Gmail API rechazó el envío: ${detail}`);
  }
  return { id: json.id, threadId: json.threadId, labelIds: json.labelIds };
}
