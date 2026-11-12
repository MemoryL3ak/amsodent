/* Ingreso del equipo interno (2026-11-12)
   ----------------------------------------------------------------------------
   Al login se entra de dos formas: correo/usuario y contraseña (como siempre) o
   «Continuar con Google». Las dos llegan a la MISMA cuenta: Supabase enlaza la
   cuenta de Google con el usuario que ya existe con ese correo. Google no crea
   usuarios: una cuenta es del equipo solo si administración la creó (tiene su
   fila en `profiles`); si no, el servidor responde 403 con el código de abajo
   y aquí se cierra la sesión y se explica por qué.

   Entrar con Google deja además el correo conectado (Mi Correo, envíos y
   calendario): ver `conectarCorreoDeGoogle` más abajo.

   Esto es solo para la plataforma interna: el Portal del cliente, el de
   choferes y el de despachos tienen su propio ingreso y no pasan por aquí. */

import { api } from "./api";

export const CODIGO_SIN_PERFIL = "cuenta_no_registrada";

/* ── El correo queda conectado al entrar con Google ───────────────
   El ingreso con Google pide de una vez los permisos de Gmail y Calendar (los
   mismos de «Conectar cuenta» en Mi Correo). Google entrega un refresh_token la
   primera vez que la persona los acepta; ese token se manda al servidor, que lo
   revisa y lo guarda en correo_cuentas. En los ingresos siguientes Google no
   vuelve a preguntar ni a entregar token: la conexión ya guardada sigue viva. */
export const PERMISOS_GOOGLE = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const CLAVE_CORREO = "google-auth-synced";

/** Manda al servidor el refresh_token de Google de la sesión recién iniciada.
    Devuelve lo que respondió el servidor ({ conectado, email, motivo }) o null
    si no había nada que mandar o no se pudo. Nunca lanza: entrar a la
    plataforma no depende de esto. */
export async function conectarCorreoDeGoogle(session) {
  const refresh = session?.provider_refresh_token;
  if (!refresh) return null; // ingreso con contraseña, o Google no entregó token
  // Una vez por token: el login lo manda y, al cargar la app, no se repite.
  const marca = String(refresh).slice(-16);
  try { if (sessionStorage.getItem(CLAVE_CORREO) === marca) return null; } catch { /* sin almacenamiento */ }
  try {
    const r = await api.post("/correos/oauth/supabase-sync", {
      email: String(session.user?.email || "").toLowerCase(),
      refreshToken: refresh,
    });
    try { sessionStorage.setItem(CLAVE_CORREO, marca); } catch { /* sin almacenamiento */ }
    return r || null;
  } catch (e) {
    console.warn("No se pudo conectar el correo con la cuenta de Google:", e?.message || e);
    return null;
  }
}

/* Marca «salí hacia Google» (sessionStorage sobrevive a la ida y vuelta en la
   misma pestaña): al volver al login se sabe que hay que revisar la cuenta. */
const CLAVE_VUELTA = "amsodent.login.google";
export function marcarIdaAGoogle() {
  try { sessionStorage.setItem(CLAVE_VUELTA, "1"); } catch { /* sin almacenamiento */ }
}
export function olvidarIdaAGoogle() {
  try { sessionStorage.removeItem(CLAVE_VUELTA); } catch { /* sin almacenamiento */ }
}
export function vieneDeGoogle(hash = "") {
  let marca = false;
  try { marca = sessionStorage.getItem(CLAVE_VUELTA) === "1"; } catch { /* sin almacenamiento */ }
  return marca || /(^|[#&])access_token=/.test(String(hash));
}

/** ¿El servidor rechazó la cuenta por no ser del equipo? */
export const esCuentaNoRegistrada = (e) => e?.status === 403 && e?.body?.codigo === CODIGO_SIN_PERFIL;

export function mensajeCuentaNoRegistrada(correo) {
  const cual = correo ? `La cuenta ${correo}` : "Esa cuenta";
  return `${cual} no está registrada en la plataforma de Amsodent. Entra con el correo de tu usuario o pide uno a administración.`;
}

/** Lo que Supabase deja en la URL (en la consulta o tras el #) cuando el
    ingreso con Google falla. Devuelve null si no hay error. */
export function leerErrorDeUrl(search = "", hash = "") {
  const q = new URLSearchParams(String(search).replace(/^\?/, ""));
  const h = new URLSearchParams(String(hash).replace(/^#/, ""));
  const de = (k) => q.get(k) || h.get(k) || "";
  const error = de("error");
  const codigo = de("error_code");
  const descripcion = de("error_description");
  if (!error && !codigo && !descripcion) return null;
  return { error, codigo, descripcion };
}

/** El error de Supabase/Google dicho en castellano y sin tecnicismos. */
export function mensajeErrorGoogle(err) {
  const texto = `${err?.codigo || ""} ${err?.descripcion || ""}`.toLowerCase();
  // «Signups not allowed for this instance»: el correo de Google no tiene usuario.
  if (/signup|sign ?ups? not allowed/.test(texto)) {
    return "Esa cuenta de Google no está registrada en la plataforma de Amsodent. Entra con el correo de tu usuario o pide uno a administración.";
  }
  if (/banned/.test(texto)) return "Tu cuenta está bloqueada. Contacta a administración.";
  if (err?.error === "access_denied" && !/server_error|unexpected/.test(texto)) {
    return "Se canceló el ingreso con Google. Puedes intentarlo de nuevo o entrar con tu correo y contraseña.";
  }
  return "No se pudo ingresar con Google. Intenta de nuevo o entra con tu correo y contraseña.";
}
