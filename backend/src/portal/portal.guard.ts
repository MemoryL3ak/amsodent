import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PortalService } from './portal.service';

// Valida el token del portal del cliente (RUT + id_licitacion) firmado en login.
// Distinto al AuthGuard de admin: NO valida sesión de Supabase, valida el token propio.
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(private portalService: PortalService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token del portal no proporcionado.');
    }
    const token = authHeader.split(' ')[1];
    const payload = this.portalService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Sesión del portal inválida o expirada.');
    }
    request.portal = payload; // { licitacion_id, id_licitacion, rut, exp }
    return true;
  }
}
