import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class NotificacionesService {
  constructor(private supabase: SupabaseService) {}

  async listar(userEmail: string, soloNoLeidas = false, limit = 50) {
    const ahora = new Date().toISOString();
    let query = this.supabase.getClient()
      .from('notificaciones')
      .select('*')
      .ilike('user_email', userEmail)
      .order('creado_at', { ascending: false })
      .limit(limit);

    if (soloNoLeidas) {
      // Excluir las que están "snoozeadas" hacia el futuro.
      query = query
        .is('leida_at', null)
        .or(`snooze_hasta.is.null,snooze_hasta.lte.${ahora}`);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async contarNoLeidas(userEmail: string) {
    const ahora = new Date().toISOString();
    const { count, error } = await this.supabase.getClient()
      .from('notificaciones')
      .select('id', { count: 'exact', head: true })
      .ilike('user_email', userEmail)
      .is('leida_at', null)
      .or(`snooze_hasta.is.null,snooze_hasta.lte.${ahora}`);
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

  // Pospone una notificación por X horas (default 2). Mientras snooze_hasta
  // esté en el futuro, listar() y contarNoLeidas() la excluyen. Esto permite
  // que los recordatorios de correos vuelvan a saltar automáticamente cada
  // 2 horas hasta que se envíe el correo.
  async snooze(id: number, userEmail: string, horas = 2) {
    const h = Math.max(1, Math.min(72, Number(horas) || 2));
    const hasta = new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
    const { error } = await this.supabase.getClient()
      .from('notificaciones')
      .update({ snooze_hasta: hasta })
      .eq('id', id)
      .ilike('user_email', userEmail);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, snooze_hasta: hasta };
  }
}
