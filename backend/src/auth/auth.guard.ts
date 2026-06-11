import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('AuthGuard');

  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token no proporcionado');
    }

    const token = authHeader.split(' ')[1];

    let user: any = null;
    let error: any = null;
    try {
      const res = await this.supabase.getClient().auth.getUser(token);
      user = res?.data?.user ?? null;
      error = res?.error ?? null;
    } catch (e: any) {
      error = e;
    }

    if (error || !user) {
      // DIAGNÓSTICO TEMPORAL: imprime la causa real del rechazo (sin exponer el
      // token ni las keys). Sirve para distinguir token vencido vs error de red
      // vs apikey inválida en el backend desplegado. Quitar una vez resuelto.
      const proyecto = (process.env.SUPABASE_URL || '')
        .replace(/^https?:\/\//, '')
        .slice(0, 24);
      const serviceKeyLen = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().length;
      this.logger.warn(
        `[diag] 401 getUser · proyecto=${proyecto} · serviceKeyLen=${serviceKeyLen} · ` +
          `tokenLen=${(token || '').length} · errName=${error?.name || '-'} · ` +
          `errStatus=${error?.status ?? '-'} · errMsg=${error?.message || '(getUser sin user)'}`,
      );
      throw new UnauthorizedException('Token inválido o expirado');
    }

    request.user = user;
    request.accessToken = token;
    return true;
  }
}
