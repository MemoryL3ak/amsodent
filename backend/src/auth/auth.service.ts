import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

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
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
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
