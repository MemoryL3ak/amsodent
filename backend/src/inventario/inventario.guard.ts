import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosEfectivos } from '../auth/permisos';

/* Inventario (2026-10-14): LEE quien tenga el módulo `inventario` en sus
   permisos efectivos (perfil asignado o rol) o sea admin. Antes el módulo
   entero era solo admin; ahora ventas ve el stock (sin tarjetas KPI ni
   acciones) y mover stock sigue siendo solo admin (AdminGuard en esas rutas).
   Mismo cálculo de permisos que auth.service y el Monitoreo de alertas. */
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
    if (!esRolAdmin(rol) && !permisosEfectivos(rol, permisosPerfil).includes('inventario')) {
      throw new ForbiddenException('No tienes acceso al Inventario. Pídele a administración que lo agregue a tu perfil.');
    }
    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
