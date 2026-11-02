import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/* (2026-11-02) Traslados entre sucursales: crear, recibir y anular los hace
   un administrador o quien tenga «inventario_traslados» en sus permisos
   efectivos. Va SIEMPRE después de InventarioGuard (guard de la clase), que
   ya validó el token y dejó request.esAdmin y request.permisos: este solo
   decide con eso. */
@Injectable()
export class InventarioTrasladosGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const permisos: unknown = request.permisos;
    if (request.esAdmin === true || (Array.isArray(permisos) && permisos.includes('inventario_traslados'))) return true;
    throw new ForbiddenException(
      'Mover stock entre sucursales requiere el permiso «Inventario: traslados entre sucursales» en tu perfil (o ser administrador).',
    );
  }
}
