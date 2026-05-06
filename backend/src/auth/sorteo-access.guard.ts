import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Valida token + verifica que el perfil tenga rol 'admin' o 'ventas_especial'.
// Usar en endpoints de Sorteo: admin tiene acceso completo, ventas_especial
// también puede gestionar el sorteo (las demás secciones permanecen restringidas
// por sus propios guards).
@Injectable()
export class SorteoAccessGuard implements CanActivate {
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

    if (error || !user) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const { data: perfil, error: errPerfil } = await client
      .from('profiles')
      .select('rol')
      .eq('id', user.id)
      .maybeSingle();

    if (errPerfil) {
      throw new UnauthorizedException('No se pudo verificar el rol del usuario');
    }

    const rol = String(perfil?.rol || '').trim().toLowerCase();
    const permitido = rol === 'admin' || rol === 'administrador' || rol === 'ventas_especial';
    if (!permitido) {
      throw new ForbiddenException(
        'Acceso restringido al sorteo.',
      );
    }

    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
