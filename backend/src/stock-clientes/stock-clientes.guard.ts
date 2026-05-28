import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { StockClientesService } from './stock-clientes.service';

// Valida el token del portal de stock (rut + razon_social). Distinto al
// PortalGuard de trazabilidad: este portal no exige cotización previa.
@Injectable()
export class StockPortalGuard implements CanActivate {
  constructor(private stockClientesService: StockClientesService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token del portal no proporcionado.');
    }
    const token = authHeader.split(' ')[1];
    const payload = this.stockClientesService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Sesión del portal inválida o expirada.');
    }
    request.stockPortal = payload; // { rut, razon_social, exp }
    return true;
  }
}
