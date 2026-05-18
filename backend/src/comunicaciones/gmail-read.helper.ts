// Helper para leer hilos de Gmail.
// Usa la Gmail API users.threads.get para traer todos los mensajes de un hilo,
// y users.messages.modify para marcar como leído.
//
// Decodifica el body MIME (multipart/alternative) extrayendo HTML y text plain.

const GMAIL_THREAD_URL = (id: string) =>
  `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`;

const GMAIL_MODIFY_URL = (id: string) =>
  `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/modify`;

export interface GmailMessageParsed {
  id: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string; // ISO
  bodyHtml: string;
  bodyText: string;
  snippet: string;
  isUnread: boolean;
  labelIds: string[];
}

export async function fetchGmailThread(
  accessToken: string,
  threadId: string,
): Promise<GmailMessageParsed[]> {
  const res = await fetch(GMAIL_THREAD_URL(threadId), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail thread fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json: any = await res.json();
  const messages: any[] = json?.messages || [];
  return messages.map(parseGmailMessage);
}

export async function markGmailMessageAsRead(
  accessToken: string,
  messageId: string,
): Promise<void> {
  const res = await fetch(GMAIL_MODIFY_URL(messageId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail modify failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

function parseGmailMessage(msg: any): GmailMessageParsed {
  const headers = (msg.payload?.headers || []) as { name: string; value: string }[];
  const hdr = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const fromRaw = hdr('From');
  const { email: fromEmail, name: fromName } = parseAddress(fromRaw);

  const dateRaw = hdr('Date');
  const dateIso = dateRaw ? new Date(dateRaw).toISOString() : new Date(Number(msg.internalDate) || Date.now()).toISOString();

  const { html, text } = extractBodies(msg.payload);

  const labelIds = (msg.labelIds || []) as string[];

  return {
    id: msg.id,
    threadId: msg.threadId,
    fromEmail,
    fromName,
    to: hdr('To').split(',').map((s) => parseAddress(s).email).filter(Boolean),
    cc: hdr('Cc').split(',').map((s) => parseAddress(s).email).filter(Boolean),
    subject: hdr('Subject'),
    date: dateIso,
    bodyHtml: html,
    bodyText: text,
    snippet: String(msg.snippet || ''),
    isUnread: labelIds.includes('UNREAD'),
    labelIds,
  };
}

function parseAddress(raw: string): { email: string; name: string } {
  if (!raw) return { email: '', name: '' };
  // Formatos comunes: "Nombre <email@x.com>" o "email@x.com"
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  }
  return { email: raw.trim().toLowerCase(), name: '' };
}

// Recorre el árbol de payloads MIME y extrae el primer text/html y el primer text/plain.
// Si no hay multipart, usa el body del payload raíz.
function extractBodies(payload: any): { html: string; text: string } {
  let html = '';
  let text = '';

  function walk(part: any) {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    if (Array.isArray(part.parts) && part.parts.length > 0) {
      for (const p of part.parts) walk(p);
      return;
    }
    const data = part.body?.data;
    if (!data) return;
    const decoded = decodeBase64Url(data);
    if (mime === 'text/html' && !html) html = decoded;
    else if (mime === 'text/plain' && !text) text = decoded;
  }

  walk(payload);
  // Si no hubo multipart pero el payload raíz tiene body, intentar interpretar.
  if (!html && !text && payload?.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if ((payload.mimeType || '').toLowerCase() === 'text/html') html = decoded;
    else text = decoded;
  }
  return { html, text };
}

function decodeBase64Url(data: string): string {
  // Gmail usa base64url: '-' por '+', '_' por '/', sin padding.
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}
