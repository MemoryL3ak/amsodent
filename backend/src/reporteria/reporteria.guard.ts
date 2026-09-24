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

    const { data: perfil, error: errPerfil } = await client
      .from('profiles')
      .select('rol, permisos')
      .eq('id', user.id)
      .maybeSingle();
    if (errPerfil) throw new UnauthorizedException('No se pudo verificar el perfil del usuario');

    const rol = String(perfil?.rol || '').trim().toLowerCase();
    const permisos = permisosEfectivos(rol, perfil?.permisos);
    if (!esRolAdmin(rol) && !permisos.includes('reporteria')) {
      throw new ForbiddenException('No tienes acceso al módulo de Reportería. Pídele a administración que lo agregue a tu perfil.');
    }

    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
