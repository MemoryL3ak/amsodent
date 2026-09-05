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
      .select('email,nombre,rol,avatar_url')
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
    // Whitelist de campos (contención auditoría 2026-09-04): solo lo que la
    // pantalla de usuarios edita. Nada de mass assignment sobre profiles.
    const PERMITIDOS = ['nombre', 'rol', 'permission_profile_id', 'avatar_url'];
    const patch: Record<string, any> = {};
    for (const k of PERMITIDOS) if (body?.[k] !== undefined) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nada que actualizar.');
    }
    const { data, error } = await this.supabase.getClient()
      .from('profiles')
      .update(patch)
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

  // ── Perfiles de permisos (RBAC configurable) ─────────────────────────────
  async listarPerfiles() {
    const { data, error } = await this.supabase.getClient()
      .from('permission_profiles')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) {
      if ((error.message || '').toLowerCase().includes('permission_profiles')) return [];
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  async crearPerfil(body: { nombre?: string; descripcion?: string; permisos?: string[] }) {
    const nombre = String(body?.nombre || '').trim();
    if (!nombre) throw new BadRequestException('El nombre del perfil es obligatorio.');
    const { data, error } = await this.supabase.getClient()
      .from('permission_profiles')
      .insert({
        nombre,
        descripcion: String(body?.descripcion || '').trim() || null,
        permisos: Array.isArray(body?.permisos) ? body.permisos : [],
      })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizarPerfil(id: string, body: { nombre?: string; descripcion?: string; permisos?: string[] }) {
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body?.nombre !== undefined) patch.nombre = String(body.nombre || '').trim();
    if (body?.descripcion !== undefined) patch.descripcion = String(body.descripcion || '').trim() || null;
    if (body?.permisos !== undefined) patch.permisos = Array.isArray(body.permisos) ? body.permisos : [];
    const { data, error } = await this.supabase.getClient()
      .from('permission_profiles')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminarPerfil(id: string) {
    const { error } = await this.supabase.getClient()
      .from('permission_profiles')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Sube la foto de perfil al bucket público "avatars" y guarda su URL pública
  // en profiles.avatar_url. Devuelve { avatar_url }.
  async subirAvatar(id: string, file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('Falta el archivo.');
    const client = this.supabase.getClient();
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const path = `profiles/${id}/${Date.now()}.${ext}`;
    const { error: upErr } = await client.storage
      .from('avatars')
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (upErr) throw new BadRequestException(upErr.message);
    const { data: pub } = client.storage.from('avatars').getPublicUrl(path);
    const avatar_url = pub?.publicUrl || null;
    const { error } = await client
      .from('profiles')
      .update({ avatar_url })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { avatar_url };
  }

  // Crea un usuario en Auth (con contraseña temporal) + su perfil. Solo admin.
  // Reemplaza la antigua Edge Function que se llamaba desde el navegador con el
  // service_role expuesto (riesgo de seguridad + CORS). Aquí el service_role
  // vive en el servidor.
  async crearUsuario(body: { email?: string; nombre?: string; rol?: string }) {
    const email = String(body?.email || '').trim().toLowerCase();
    const nombre = String(body?.nombre || '').trim();
    const rol = String(body?.rol || 'ventas').trim() || 'ventas';
    if (!email) throw new BadRequestException('El correo es obligatorio.');
    if (!nombre) throw new BadRequestException('El nombre es obligatorio.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('El correo no es válido.');
    }

    const client = this.supabase.getClient();
    const password = this.generarPasswordTemporal();

    // 1) Crear el usuario en Auth (email ya confirmado, sin enviar invitación).
    const { data: created, error: createErr } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        throw new BadRequestException('Ya existe un usuario con ese correo.');
      }
      throw new BadRequestException(createErr.message);
    }
    const userId = created?.user?.id;
    if (!userId) throw new BadRequestException('No se pudo crear el usuario.');

    // 2) Crear/actualizar el perfil. Si falla, se revierte el usuario de Auth
    //    para no dejar cuentas huérfanas.
    const { error: profErr } = await client
      .from('profiles')
      .upsert({ id: userId, email, nombre, rol }, { onConflict: 'id' });
    if (profErr) {
      await client.auth.admin.deleteUser(userId).catch(() => undefined);
      throw new BadRequestException(profErr.message);
    }

    return { id: userId, email, nombre, rol, password };
  }

  // Contraseña temporal legible (sin caracteres ambiguos como O/0, l/1).
  private generarPasswordTemporal(): string {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 10; i++) {
      out += abc[Math.floor(Math.random() * abc.length)];
    }
    return out;
  }

  async resetPassword(email: string) {
    const { error } = await this.supabase.getClient()
      .auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password`,
      });
    if (error) throw new BadRequestException(error.message);
    return { sent: true };
  }

  // Admin establece manualmente la contraseña de un usuario.
  // Usa la Admin API de Supabase (requiere SERVICE_ROLE_KEY).
  async setPasswordAdmin(userId: string, password: string) {
    if (!password || typeof password !== 'string') {
      throw new BadRequestException('Falta la contraseña.');
    }
    if (password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');
    }
    const { error } = await this.supabase.getClient().auth.admin.updateUserById(userId, {
      password,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
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
