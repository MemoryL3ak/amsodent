import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class NotificacionesService {
  constructor(private supabase: SupabaseService) {}

  async listar(userEmail: string, soloNoLeidas = false, limit = 50) {
    let query = this.supabase.getClient()
      .from('notificaciones')
      .select('*')
      .ilike('user_email', userEmail)
      .order('creado_at', { ascending: false })
      .limit(limit);

    if (soloNoLeidas) query = query.is('leida_at', null);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async contarNoLeidas(userEmail: string) {
    const { count, error } = await this.supabase.getClient()
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .ilike('user_email', userEmail)
      .is('leida_at', null);
    if (error) throw new BadRequestException(error.message);
    return { total: count || 0 };
  }

  async marcarLeida(id: number, userEmail: string) {
    const { error } = await this.supabase.getClient()
      .from('notificaciones')
      .update({ leida_at: new Date().toISOString() })
      .eq('id', id)
      .ilike('user_email', userEmail);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async marcarTodasLeidas(userEmail: string) {
    const { error } = await this.supabase.getClient()
      .from('notificaciones')
      .update({ leida_at: new Date().toISOString() })
      .ilike('user_email', userEmail)
      .is('leida_at', null);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
