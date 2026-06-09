import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Valida token de "Mi Correo" (el buzón). El buzón está habilitado para TODOS
// los roles: cada usuario conecta y ve su propia casilla. Solo se exige estar
// autenticado y tener perfil.
@Injectable()
export class BuzonGuard implements CanActivate {
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

    request.user = user;
    request.userRol = rol;
    request.accessToken = token;
    return true;
  }
}
