import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

/* ── Sesión y token (2026-11-04) ─────────────────────────────────────────────
   `supabase.auth.getSession()` puede devolver null un instante mientras
   Supabase renueva el token, o cuando otra pestaña lo renovó primero. Las
   peticiones salían SIN Authorization y el backend respondía 401 «Token no
   proporcionado» (ráfagas casi diarias en monitor_logs; p. ej. el 2026-11-04
   12:02 UTC siete fichas técnicas en masa salieron sin foto ni textos). Regla:
   - si hubo sesión y no hubo cierre, un token vacío es un hueco transitorio:
     se espera un poco (y se pide renovar) antes de salir sin token;
   - si una petición vuelve con 401 y hay sesión, se renueva y se reintenta
     UNA vez (el backend rechaza antes de hacer nada, así que es seguro).
   Sin sesión conocida (portales públicos, login) no se espera nada. */
let sesionConocida = null;
try {
  supabase.auth.onAuthStateChange((evento, sesion) => {
    if (evento === 'SIGNED_OUT') sesionConocida = null;
    else if (sesion) sesionConocida = sesion;
  });
} catch { /* sin auth (pruebas) */ }

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function sesionActual() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
  } catch {
    return null;
  }
}

/* Renueva con la sesión guardada (nunca con un refresh token viejo: Supabase
   revoca toda la familia si se reutiliza uno ya usado). */
async function renovarSesion() {
  try {
    const { data } = await supabase.auth.refreshSession();
    if (data?.session) sesionConocida = data.session;
    return data?.session || null;
  } catch {
    return null;
  }
}

async function getAuthToken() {
  let sesion = await sesionActual();
  if (!sesion && sesionConocida) {
    for (let i = 0; i < 3 && !sesion; i++) {
      await espera(400 * (i + 1));
      sesion = await sesionActual();
      if (!sesion && i === 1) sesion = await renovarSesion();
    }
  }
  return sesion?.access_token || '';
}

/* Ejecuta la petición con el token y, ante un 401 con sesión, renueva y
   reintenta una vez. `conAuthPropia`: la petición trae su propio Authorization
   (portales con su JWT): no se toca. */
async function conSesion(ejecutar, conAuthPropia) {
  const token = await getAuthToken();
  const res = await ejecutar(token);
  if (res.status === 401 && !conAuthPropia && sesionConocida) {
    const nueva = await renovarSesion();
    if (nueva?.access_token && nueva.access_token !== token) return ejecutar(nueva.access_token);
  }
  return res;
}

const authHeaders = (token) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function request(path, options = {}) {
  const res = await conSesion(
    (token) => fetch(`${API_URL}${path}`, { ...options, headers: { ...authHeaders(token), ...options.headers } }),
    Boolean(options.headers?.Authorization),
  );

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
  get: (path, options) => request(path, options),
  // `options` permite pasar un AbortSignal: hay procesos largos (la
  // sincronización con Mercado Público dura decenas de minutos) que el usuario
  // tiene que poder cortar sin esperar a que responda la request en vuelo.
  post: (path, body, options = {}) =>
    request(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  postForm: (path, formData) => sendForm('POST', path, formData),
  putForm: (path, formData) => sendForm('PUT', path, formData),
};

async function sendForm(method, path, formData) {
  const res = await conSesion(
    (token) => fetch(`${API_URL}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData }),
    false,
  );
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
