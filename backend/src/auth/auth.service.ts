import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { permisosEfectivos } from './permisos';

@Injectable()
export class AuthService {
  constructor(private supabase: SupabaseService) {}

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase
      .getClient()
      .auth.signInWithPassword({ email, password });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    return {
      user: data.user,
      session: data.session,
    };
  }

  async getProfile(userId: string) {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);

    // Permisos efectivos: perfil asignado o, en su defecto, por rol.
    let permisosPerfil: any = null;
    let perfilNombre: string | null = null;
    if (data?.permission_profile_id) {
      try {
        const { data: perfil } = await client
          .from('permission_profiles')
          .select('nombre, permisos')
          .eq('id', data.permission_profile_id)
          .maybeSingle();
        if (perfil) {
          permisosPerfil = perfil.permisos;
          perfilNombre = perfil.nombre;
        }
      } catch { /* tabla puede no existir aún */ }
    }
    return {
      ...data,
      permisos: permisosEfectivos(data?.rol, permisosPerfil),
      perfil_nombre: perfilNombre,
    };
  }

  async createUser(body: {
    email: string;
    password: string;
    nombre: string;
    rol: string;
  }) {
    const client = this.supabase.getClient();

    const { data: authData, error: authError } =
      await client.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      });

    if (authError) throw new BadRequestException(authError.message);

    const { error: profileError } = await client.from('profiles').insert({
      id: authData.user.id,
      email: body.email,
      nombre: body.nombre,
      rol: body.rol,
    });

    if (profileError) throw new BadRequestException(profileError.message);

    return { user: authData.user };
  }
}
