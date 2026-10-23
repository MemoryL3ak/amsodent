import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosEfectivos } from '../auth/permisos';

/* Inventario (2026-10-14): LEE quien tenga el módulo `inventario` en sus
   permisos efectivos (perfil asignado o rol) o sea admin. Antes el módulo
   entero era solo admin; ahora ventas ve el stock (sin tarjetas KPI ni
   acciones) y mover stock sigue siendo solo admin (AdminGuard en esas rutas).
   Mismo cálculo de permisos que auth.service y el Monitoreo de alertas.
   (2026-10-16) "Todos pueden ver el inventario": permisosEfectivos ya incluye
   `inventario` para cualquier rol o perfil (PARA_TODOS).
   (2026-10-22) Las tarjetas KPI son solo admin (lo decide el front por rol) y
   el costo de cada producto solo viaja a admin o a quien tenga `ver_costos`
   (request.verCostos → resumen()). */
@Injectable()
export class InventarioGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Token no proporcionado');
    const token = authHeader.split(' ')[1];
    const client = this.supabase.getClient();
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) throw new UnauthorizedException('Token inválido o expirado');

    const { data: perfil, error: errPerfil } = await client.from('profiles').select('rol, permission_profile_id').eq('id', user.id).maybeSingle();
    if (errPerfil) throw new UnauthorizedException('No se pudo verificar el perfil del usuario');
    const rol = String(perfil?.rol || '').trim().toLowerCase();
    let permisosPerfil: any = null;
    if (perfil?.permission_profile_id) {
      const { data: asignado } = await client.from('permission_profiles').select('permisos').eq('id', perfil.permission_profile_id).maybeSingle();
      permisosPerfil = asignado?.permisos ?? null;
    }
    const esAdmin = esRolAdmin(rol);
    const permisos = permisosEfectivos(rol, permisosPerfil);
    if (!esAdmin && !permisos.includes('inventario')) {
      throw new ForbiddenException('No tienes acceso al Inventario. Pídele a administración que lo agregue a tu perfil.');
    }
    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    // (2026-10-22) El costo (y con él la valorización) solo viaja a admin o a
    // quien tenga «ver_costos» en su perfil: resumen() lo omite para el resto.
    request.verCostos = esAdmin || permisos.includes('ver_costos');
    return true;
  }
}
