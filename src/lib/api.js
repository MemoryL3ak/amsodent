import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || '';
}

async function getAuthHeaders() {
  const token = await getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  // Lee siempre como texto y parsea solo si hay contenido — evita romper
  // cuando el backend devuelve body vacío (204 No Content, null, etc.).
  const text = await res.text();
  const body = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `Error ${res.status}`;
    const error = new Error(msg);
    error.status = res.status;
    error.body = body;
    throw error;
  }

  return body;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  postForm: async (path, formData) => {
    const token = await getAuthToken();
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const text = await res.text();
    const body = text ? safeJsonParse(text) : null;
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || `Error ${res.status}`;
      const error = new Error(msg);
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  },
};
