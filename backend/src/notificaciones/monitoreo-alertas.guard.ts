import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosEfectivos } from '../auth/permisos';

/* Monitoreo de alertas (2026-10-07): entra quien tenga el módulo
   `monitoreo_alertas` en sus permisos efectivos (perfil o rol) o sea admin.
   Mismo cálculo de permisos que auth.service y la Reportería: la lista de
   módulos vive en permission_profiles, no en profiles. */
@Injectable()
export class MonitoreoAlertasGuard implements CanActivate {
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
    if (!esRolAdmin(rol) && !permisosEfectivos(rol, permisosPerfil).includes('monitoreo_alertas')) {
      throw new ForbiddenException('No tienes acceso al Monitoreo de alertas. Pídele a administración que lo agregue a tu perfil.');
    }
    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
