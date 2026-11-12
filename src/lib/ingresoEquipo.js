/* Ingreso del equipo interno (2026-11-12)
   ----------------------------------------------------------------------------
   Al login se entra de dos formas: correo/usuario y contraseña (como siempre) o
   «Continuar con Google». Las dos llegan a la MISMA cuenta: Supabase enlaza la
   cuenta de Google con el usuario que ya existe con ese correo. Google no crea
   usuarios: una cuenta es del equipo solo si administración la creó (tiene su
   fila en `profiles`); si no, el servidor responde 403 con el código de abajo
   y aquí se cierra la sesión y se explica por qué.

   Esto es solo para la plataforma interna: el Portal del cliente, el de
   choferes y el de despachos tienen su propio ingreso y no pasan por aquí. */

export const CODIGO_SIN_PERFIL = "cuenta_no_registrada";

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
