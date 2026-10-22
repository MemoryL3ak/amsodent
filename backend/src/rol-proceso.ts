/* ============================================================================
   Rol del proceso: web, worker o todo (2026-10-21)
   ----------------------------------------------------------------------------
   Hasta ahora un solo proceso de Node atendía a los usuarios Y corría todos
   los trabajos de fondo (sincronización y exploración de Mercado Público,
   cambio de estados, Bsale, calendario de cobranza, Google Calendar…). Cada
   vez que un cron se ponía a esperar 30 segundos por ficha de Mercado Público
   —de a 12 en paralelo— la plataforma entera se ponía lenta para todos.

   Con APP_ROL se separa en dos servicios de Railway con la misma imagen:

     APP_ROL=web     → solo atiende HTTP. Ningún cron, ningún robot.
     APP_ROL=worker  → corre los crons y el robot de Mercado Público. También
                       escucha en PORT (sin dominio público) para que Railway
                       pueda chequear que está vivo.
     APP_ROL=todo    → como antes: todo en un proceso. Es el DEFAULT, para que
                       un despliegue que todavía no configuró la variable siga
                       funcionando igual que hoy.

   Los interruptores por tarea (MP_SYNC_AUTO=off, BSALE_SYNC_AUTO=off…) se
   siguen respetando ENCIMA del rol: en un backend local se deja APP_ROL=web o
   se apagan uno a uno, igual que antes.
============================================================================ */

export type RolProceso = 'web' | 'worker' | 'todo';

export function rolProceso(): RolProceso {
  const v = String(process.env.APP_ROL || '').trim().toLowerCase();
  if (v === 'web' || v === 'worker') return v;
  return 'todo';
}

/** ¿Este proceso corre las tareas de fondo (crons, robot)? */
export function correTareasDeFondo(): boolean {
  return rolProceso() !== 'web';
}

/** ¿Este proceso atiende a los usuarios (chequeos de salud, alertas del monitor)? */
export function atiendeWeb(): boolean {
  return rolProceso() !== 'worker';
}

/** Texto para los logs de arranque de cada cron cuando el rol lo deja fuera. */
export const MOTIVO_SIN_FONDO = 'este proceso es APP_ROL=web: las tareas de fondo corren en el worker';
