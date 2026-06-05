import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ChoferesService } from './choferes.service';

// Valida el token del portal del chofer (chofer_id + rut + nombre). El portal
// no usa Supabase Auth: el token lo emite ChoferesService al hacer login.
@Injectable()
export class ChoferPortalGuard implements CanActivate {
  constructor(private choferesService: ChoferesService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token del portal no proporcionado.');
    }
    const token = authHeader.split(' ')[1];
    const payload = this.choferesService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Sesión del portal inválida o expirada.');
    }
    request.choferPortal = payload; // { chofer_id, rut, nombre, exp }
    return true;
  }
}
