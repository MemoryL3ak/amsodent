import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Valida token + verifica que el perfil tenga rol 'admin'.
// Usar en endpoints sólo accesibles para administradores (sorteo, mailings, etc.).
@Injectable()
export class AdminGuard implements CanActivate {
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
    if (rol !== 'admin' && rol !== 'administrador') {
      throw new ForbiddenException(
        'Acceso restringido a administradores.',
      );
    }

    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
