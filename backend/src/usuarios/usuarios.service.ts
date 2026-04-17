import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UsuariosService {
  constructor(private supabase: SupabaseService) {}

  async getProfiles() {
    const { data, error } = await this.supabase.getClient()
      .from('profiles')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getProfilesByEmails(emails: string[]) {
    const { data, error } = await this.supabase.getClient()
      .from('profiles')
      .select('email,nombre,rol')
      .in('email', emails);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getProfilesByIds(ids: string[]) {
    const { data, error } = await this.supabase.getClient()
      .from('profiles')
      .select('id,nombre,email')
      .in('id', ids);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateProfile(id: string, body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('profiles')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteProfile(id: string) {
    const { error } = await this.supabase.getClient()
      .from('profiles')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  async resetPassword(email: string) {
    const { error } = await this.supabase.getClient()
      .auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password`,
      });
    if (error) throw new BadRequestException(error.message);
    return { sent: true };
  }

  // Sessions
  async getSessions() {
    const { data, error } = await this.supabase.getClient()
      .from('user_sessions')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getActiveSessions() {
    const { data, error } = await this.supabase.getClient()
      .from('user_sessions')
      .select('user_id, last_seen_at')
      .is('ended_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(500);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getSessionsInRange(startIso: string, endIso: string) {
    const { data, error } = await this.supabase.getClient()
      .from('user_sessions')
      .select('user_id, started_at, ended_at, last_seen_at')
      .lt('started_at', endIso)
      .or(`ended_at.is.null,ended_at.gte.${startIso}`)
      .order('started_at', { ascending: false })
      .limit(8000);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getActivityDailyInRange(from: string, to: string) {
    const { data, error } = await this.supabase.getClient()
      .from('user_activity_daily')
      .select('user_id, day, last_seen_at')
      .gte('day', from)
      .lte('day', to)
      .limit(5000);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async closeStaleSessions(staleSeconds: number) {
    const { error } = await this.supabase.getClient()
      .rpc('fn_close_stale_sessions', { p_stale_seconds: staleSeconds });
    if (error) throw new BadRequestException(error.message);
    return { closed: true };
  }

  // Activity
  async getActivityDaily(filters?: { fecha_desde?: string; fecha_hasta?: string }) {
    let query = this.supabase.getClient()
      .from('user_activity_daily')
      .select('*')
      .order('fecha', { ascending: false });

    if (filters?.fecha_desde) query = query.gte('fecha', filters.fecha_desde);
    if (filters?.fecha_hasta) query = query.lte('fecha', filters.fecha_hasta);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertActivity(body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('user_activity_daily')
      .upsert(body)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async upsertSession(body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('user_sessions')
      .upsert(body)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateSession(id: string, body: Record<string, any>) {
    const { data, error } = await this.supabase.getClient()
      .from('user_sessions')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
