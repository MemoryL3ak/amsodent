/* Clasificación de los errores que devuelve Mercado Público, para que el robot
   decida qué hacer con un trabajo que falló:
     · cuota agotada   → pausar TODO hasta mañana (reintentar solo gasta cuota).
     · transitorio     → reintentar más tarde (504, timeouts, «simultáneas»…).
     · otro            → reintento corto y, si insiste, se marca con error.    */

export function esCuotaAgotada(msg: unknown): boolean {
  const m = String(msg || '');
  if (/simult/i.test(m)) return false; // 429 «peticiones simultáneas» no es cuota
  return /cuota|l[ií]mite de solicitudes|l[ií]mite diario|quota exceeded/i.test(m);
}

export function esTransitorio(msg: unknown): boolean {
  const m = String(msg || '');
  return /\b50[234]\b|tard[oó] demasiado|dej[oó] de responder|no responde|abort|timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|simult|network|HTTP 5\d\d/i.test(m);
}
