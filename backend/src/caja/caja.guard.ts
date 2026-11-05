import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { permisosDeUsuario } from '../auth/permisos';

/* Acceso a la caja (2026-11-05): los administradores, el usuario de la tienda
   (CAJA_USUARIO, por defecto ventas@amsodentmedical.cl) y los perfiles con el
   módulo «caja». Va después de AuthGuard, que deja `request.user`. */
@Injectable()
export class CajaGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.id) throw new UnauthorizedException('Token no proporcionado');
    const client = this.supabase.getClient();
    const { data: perfil, error } = await client.from('profiles').select('rol, email, permission_profile_id').eq('id', user.id).maybeSingle();
    if (error) throw new UnauthorizedException('No se pudo verificar el perfil del usuario');
    let permisosPerfil: any = null;
    if ((perfil as any)?.permission_profile_id) {
      const { data: asignado } = await client.from('permission_profiles').select('permisos').eq('id', (perfil as any).permission_profile_id).maybeSingle();
      permisosPerfil = (asignado as any)?.permisos ?? null;
    }
    const email = String(user.email || (perfil as any)?.email || '').trim().toLowerCase();
    if (!permisosDeUsuario((perfil as any)?.rol, permisosPerfil, email).includes('caja')) {
      throw new ForbiddenException('No tienes acceso a la caja. Pídele a administración que lo agregue a tu perfil.');
    }
    request.cajaEmail = email;
    return true;
  }
}
