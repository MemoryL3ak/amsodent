// Cliente HTTP hacia el backend NestJS. Mismo contrato que src/lib/api.js del
// web: adjunta el bearer token de Supabase y tolera respuestas con body vacío.
import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  const body = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `Error ${res.status}`;
    throw new ApiError(Array.isArray(msg) ? msg.join(', ') : String(msg), res.status, body);
  }

  return body;
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) =>
    request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (path: string, body?: unknown) =>
    request(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};
