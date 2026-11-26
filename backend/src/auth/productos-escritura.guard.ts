import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { permisosEfectivos, soloVeProductos } from './permisos';

/* Guard de ESCRITURA del catálogo de productos (2026-11-26).
   Nació con el permiso «productos_ver» (pedido de Ariel: «el usuario de sala
   de venta, agregar el módulo de productos (lectura)»): quien solo puede VER
   el catálogo no crea, edita, carga ni elimina productos, aunque llame a la
   ruta directamente. Para el resto no cambia nada: crear y editar productos
   sigue como estaba (lo gobiernan el rol y las pantallas). Va después de
   AuthGuard, que ya dejó `request.user`. */
@Injectable()
export class ProductosEscrituraGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request?.user?.id;
    if (!userId) throw new UnauthorizedException('Token no proporcionado');
    const client = this.supabase.getClient();
    const { data: perfil, error } = await client
      .from('profiles')
      .select('rol, permission_profile_id')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new UnauthorizedException('No se pudo verificar el perfil del usuario');
    let permisosPerfil: any = null;
    if (perfil?.permission_profile_id) {
      const { data: asignado } = await client
        .from('permission_profiles')
        .select('permisos')
        .eq('id', perfil.permission_profile_id)
        .maybeSingle();
      permisosPerfil = asignado?.permisos ?? null;
    }
    const rol = String(perfil?.rol || '').trim().toLowerCase();
    if (soloVeProductos(rol, permisosEfectivos(rol, permisosPerfil))) {
      throw new ForbiddenException('Tu perfil solo permite ver los productos. Pídele a administración el permiso para crear o editar.');
    }
    return true;
  }
}
