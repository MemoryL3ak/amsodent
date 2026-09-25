import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosEfectivos } from '../auth/permisos';

/* Reportería (2026-09-24): deja de ser solo admin. Entra quien tenga el
   módulo `reporteria` en su perfil de permisos (o sea admin). El guard deja
   el rol en `request.userRol` para que el service recorte lo que cada uno
   puede ver: las tablas crudas y el SQL libre siguen siendo solo admin, y
   las columnas de costo/margen solo salen para los roles con permiso. */
@Injectable()
export class ReporteriaGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token no proporcionado');
    }
    const token = authHeader.split(' ')[1];
    const client = this.supabase.getClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) throw new UnauthorizedException('Token inválido o expirado');

    /* Los permisos NO viven en `profiles`: la tabla solo guarda el rol y el
       `permission_profile_id`, y la lista de modulos esta en el perfil
       apuntado (permission_profiles.permisos). Pedirle `permisos` a profiles
       hacia fallar la consulta con "column profiles.permisos does not exist",
       y como un error aca se traduce en 401, la Reporteria quedaba cerrada
       para todos, admin incluido. Se resuelve igual que en auth.service. */
    const { data: perfil, error: errPerfil } = await client
      .from('profiles')
      .select('rol, permission_profile_id')
      .eq('id', user.id)
      .maybeSingle();
    if (errPerfil) throw new UnauthorizedException('No se pudo verificar el perfil del usuario');

    const rol = String(perfil?.rol || '').trim().toLowerCase();

    let permisosPerfil: any = null;
    if (perfil?.permission_profile_id) {
      // Si la tabla de perfiles aun no existe, se cae a los permisos del rol.
      const { data: asignado } = await client
        .from('permission_profiles')
        .select('permisos')
        .eq('id', perfil.permission_profile_id)
        .maybeSingle();
      permisosPerfil = asignado?.permisos ?? null;
    }
    const permisos = permisosEfectivos(rol, permisosPerfil);
    if (!esRolAdmin(rol) && !permisos.includes('reporteria')) {
      throw new ForbiddenException('No tienes acceso al módulo de Reportería. Pídele a administración que lo agregue a tu perfil.');
    }

    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
