import { ForbiddenException } from '@nestjs/common';

/* ============================================================================
   Solo el equipo interno (2026-11-12)
   ----------------------------------------------------------------------------
   Con el ingreso por Google activo en Supabase Auth, cualquier cuenta de Google
   puede terminar con un token VÁLIDO: si el correo no existe, Supabase crea la
   cuenta sola (mientras «Allow new users to sign up» siga encendido). Ese token
   pasaba el AuthGuard y, como un usuario sin perfil cae en los permisos base
   del rol, veía cotizaciones, clientes y productos.

   Regla: una cuenta es del equipo solo si tiene su fila en `profiles`, que
   únicamente crea administración (Usuarios → Nuevo usuario). Sin perfil no se
   entra, venga el token de Google o de correo y clave.

   Se consulta en TODAS las peticiones, así que va con caché: quien ya mostró
   tener perfil no se vuelve a consultar por unos minutos; el «no tiene» se
   recuerda pocos segundos (por si administración lo está creando).
============================================================================ */

export const CODIGO_SIN_PERFIL = 'cuenta_no_registrada';
export const MENSAJE_SIN_PERFIL =
  'Esta cuenta no está registrada en la plataforma de Amsodent. Pídele a administración que te cree un usuario con este correo.';

const TTL_CON_PERFIL_MS = 5 * 60_000;
const TTL_SIN_PERFIL_MS = 15_000;
const MAX_RECORDADOS = 5000;
const conPerfil = new Map<string, number>();
const sinPerfil = new Map<string, number>();

/** El error que recibe quien entra con una cuenta que no es del equipo. */
export function errorSinPerfil() {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    codigo: CODIGO_SIN_PERFIL,
    message: MENSAJE_SIN_PERFIL,
  });
}

/** Olvida lo recordado de una cuenta (al crearla o eliminarla). */
export function olvidarPerfil(userId?: string | null) {
  const id = String(userId || '').trim();
  if (!id) {
    conPerfil.clear();
    sinPerfil.clear();
    return;
  }
  conPerfil.delete(id);
  sinPerfil.delete(id);
}

/**
 * ¿Tiene perfil esta cuenta? Si la consulta falla (base caída o lenta) responde
 * que sí: el pedido seguirá su curso y fallará por lo que tenga que fallar, en
 * vez de dejar a todo el equipo afuera con un mensaje que no corresponde.
 */
export async function tienePerfil(client: any, userId: string): Promise<boolean> {
  const id = String(userId || '').trim();
  if (!id) return false;
  const ahora = Date.now();

  const visto = conPerfil.get(id);
  if (visto && ahora - visto < TTL_CON_PERFIL_MS) return true;
  const negado = sinPerfil.get(id);
  if (negado && ahora - negado < TTL_SIN_PERFIL_MS) return false;

  const { data, error } = await client.from('profiles').select('id').eq('id', id).maybeSingle();
  if (error) return true;

  if (data?.id) {
    sinPerfil.delete(id);
    if (conPerfil.size >= MAX_RECORDADOS) conPerfil.clear();
    conPerfil.set(id, ahora);
    return true;
  }
  conPerfil.delete(id);
  if (sinPerfil.size >= MAX_RECORDADOS) sinPerfil.clear();
  sinPerfil.set(id, ahora);
  return false;
}
