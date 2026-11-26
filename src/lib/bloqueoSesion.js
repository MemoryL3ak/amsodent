// bloqueoSesion.js
/* ── Sesión cerrada sin perder lo que se estaba haciendo (2026-11-26) ────────
   Pedido de Ariel: «cuando se cierra la sesión, no se pierda la información en
   la que se está trabajando».

   Antes, al cerrarse la sesión por inactividad (30 min) la plataforma mandaba
   al login: la pantalla se desmontaba y lo escrito sin guardar se perdía. Una
   pestaña quieta en segundo plano, además, cerraba la sesión de TODAS, también
   la de la pestaña donde se estaba trabajando.

   Ahora la sesión se cierra igual (queda sin acceso a los datos), pero la
   pantalla NO se desmonta: se le pone encima una ventana que pide la clave
   (components/SesionBloqueada.jsx). Al ingresarla, todo sigue como estaba.

   Este archivo es el estado compartido de ese bloqueo:
   · activarBloqueoSesion / liberarBloqueoSesion / bloqueoSesionActual /
     suscribirBloqueoSesion: el bloqueo vigente ({ userId, email, motivo }).
   · marcarSalidaVoluntaria / fueSalidaVoluntaria: «Cerrar sesión» apretado a
     propósito (en esta pestaña o en otra) NO bloquea: va al login como siempre.
   · anotarActividad / ultimaActividadCompartida: la actividad se comparte entre
     pestañas, para que una pestaña quieta no cierre la sesión de la que sí se
     está usando. */

const CLAVE_SALIDA = "amsodent.salida_voluntaria";
const CLAVE_ACTIVIDAD = "amsodent.ultima_actividad";
const VENTANA_SALIDA_MS = 15 * 1000;

let bloqueo = null;
const oyentes = new Set();
const avisar = () => { for (const fn of [...oyentes]) { try { fn(bloqueo); } catch { /* un oyente roto no frena a los demás */ } } };

export const bloqueoSesionActual = () => bloqueo;

export function activarBloqueoSesion({ userId, email, motivo = "sesion" } = {}) {
  if (bloqueo) return bloqueo;
  bloqueo = { userId: userId || null, email: String(email || "").trim(), motivo, desde: Date.now() };
  avisar();
  return bloqueo;
}

/* Completa la cuenta de un bloqueo que se activó sin poder leerla (sin red al
   cerrar por inactividad): la pantalla ya conoce a quién pertenece. */
export function completarBloqueoSesion({ userId, email } = {}) {
  if (!bloqueo) return;
  const correo = String(email || "").trim();
  if ((bloqueo.email || !correo) && (bloqueo.userId || !userId)) return;
  bloqueo = { ...bloqueo, email: bloqueo.email || correo, userId: bloqueo.userId || userId || null };
  avisar();
}

export function liberarBloqueoSesion() {
  if (!bloqueo) return;
  bloqueo = null;
  avisar();
}

export function suscribirBloqueoSesion(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

/* «Cerrar sesión» a propósito. Se anota también en el navegador para que las
   demás pestañas, al enterarse del cierre, vayan al login en vez de bloquearse. */
let voluntariaAqui = false;
export function marcarSalidaVoluntaria() {
  voluntariaAqui = true;
  try { localStorage.setItem(CLAVE_SALIDA, String(Date.now())); } catch { /* sin almacenamiento */ }
}
export function fueSalidaVoluntaria() {
  if (voluntariaAqui) return true;
  try {
    const t = Number(localStorage.getItem(CLAVE_SALIDA)) || 0;
    return t > 0 && Date.now() - t < VENTANA_SALIDA_MS;
  } catch {
    return false;
  }
}

/* Actividad compartida entre pestañas (se escribe como mucho cada 5 s). */
let ultimaEscritura = 0;
export function anotarActividad(ahora = Date.now()) {
  if (ahora - ultimaEscritura < 5000) return;
  ultimaEscritura = ahora;
  try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora)); } catch { /* sin almacenamiento */ }
}
export function ultimaActividadCompartida() {
  try {
    return Number(localStorage.getItem(CLAVE_ACTIVIDAD)) || 0;
  } catch {
    return 0;
  }
}
