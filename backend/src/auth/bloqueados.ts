/* ============================================================================
   Usuarios bloqueados (2026-09-29)
   ----------------------------------------------------------------------------
   Cambiarle la contraseña a alguien NO lo saca del sistema: la Admin API de
   Supabase no revoca los tokens ya emitidos, así que su sesión abierta sigue
   funcionando. El bloqueo real son dos cosas, y esta es la mitad que corta la
   sesión en curso: el AuthGuard pregunta acá en cada petición y rechaza al
   bloqueado sin esperar a que caduque su token. (La otra mitad es el ban en
   Supabase Auth, que le impide volver a entrar.)

   La consulta va cacheada unos segundos porque pasa por TODAS las peticiones;
   quien bloquea o desbloquea invalida la caché en el acto, así que la demora
   solo existe si el cambio lo hizo otra instancia del backend.
============================================================================ */

let cache: { ts: number; ids: Set<string> } | null = null;
const TTL_MS = 20_000;

/** Invalida la caché: la llama quien bloquea o desbloquea. */
export function olvidarBloqueados() {
  cache = null;
}

/**
 * ¿Está bloqueado este usuario? Si la columna todavía no existe (migración
 * 20260929 pendiente) responde que no: el sistema sigue funcionando como antes
 * en vez de dejar a todos afuera.
 */
export async function estaBloqueado(client: any, userId: string): Promise<boolean> {
  const id = String(userId || '').trim();
  if (!id) return false;

  if (cache && Date.now() - cache.ts < TTL_MS) return cache.ids.has(id);

  const { data, error } = await client.from('profiles').select('id').eq('bloqueado', true);
  if (error) {
    cache = { ts: Date.now(), ids: new Set<string>() };
    return false;
  }
  const ids = new Set<string>((data || []).map((r: any) => String(r.id)));
  cache = { ts: Date.now(), ids };
  return ids.has(id);
}
