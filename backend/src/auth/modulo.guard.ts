import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  mixin,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosEfectivos } from './permisos';
import { errorSinPerfil } from './perfil-requerido';

/* Guard por módulo (2026-11-03): deja pasar al admin y a quien tenga `modulo`
   entre sus permisos efectivos (perfil de permisos asignado o, si no tiene,
   los del rol). Mismo cálculo que InventarioGuard / GestionComprasGuard, pero
   reutilizable: `@UseGuards(AuthGuard, ModuloGuard('proveedores', 'Proveedores'))`.
   Nació para abrir Proveedores y Órdenes de Compra por perfil (pedido de
   Ariel para Francisco): hasta entonces solo los escondía el menú y el
   backend los dejaba a cualquier usuario autenticado. */
export function ModuloGuard(modulo: string, nombre: string = modulo) {
  @Injectable()
  class ModuloGuardMixin implements CanActivate {
    constructor(public readonly supabase: SupabaseService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const client = this.supabase.getClient();

      // Si AuthGuard ya corrió viene `request.user`; si se usa solo, se valida el token.
      let user = request.user;
      if (!user) {
        const authHeader = request.headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException('Token no proporcionado');
        const token = authHeader.split(' ')[1];
        const { data, error } = await client.auth.getUser(token);
        if (error || !data?.user) throw new UnauthorizedException('Token inválido o expirado');
        user = data.user;
        request.user = user;
      }

      const { data: perfil, error: errPerfil } = await client
        .from('profiles')
        .select('rol, permission_profile_id')
        .eq('id', user.id)
        .maybeSingle();
      if (errPerfil) throw new UnauthorizedException('No se pudo verificar el perfil del usuario');
      // (2026-11-12) Solo el equipo interno: sin perfil no hay permisos base.
      if (!perfil) throw errorSinPerfil();
      const rol = String(perfil?.rol || '').trim().toLowerCase();
      let permisosPerfil: any = null;
      if (perfil?.permission_profile_id) {
        const { data: asignado } = await client
          .from('permission_profiles')
          .select('permisos')
          .eq('id', perfil.permission_profile_id)
          .maybeSingle();
        permisosPerfil = asignado?.permisos ?? null;
      }
      if (!esRolAdmin(rol) && !permisosEfectivos(rol, permisosPerfil).includes(modulo)) {
        throw new ForbiddenException(`No tienes acceso a ${nombre}. Pídele a administración que lo agregue a tu perfil.`);
      }
      request.userRol = rol;
      return true;
    }
  }
  return mixin(ModuloGuardMixin);
}
