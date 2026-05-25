import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private supabase: SupabaseService) {}

  // Borra todos los mensajes de TODAS las salas (incluida la General).
  // Las salas y miembros se mantienen — solo limpia el historial.
  async limpiarTodasSalas() {
    const { data, error } = await this.supabase
      .getClient()
      .from('chat_mensajes')
      .delete()
      .gt('created_at', '1900-01-01') // condición trivialmente cierta para borrar todo
      .select('id');
    if (error) throw new BadRequestException(error.message);
    const eliminados = (data || []).length;
    this.logger.warn(`Chat limpiado completo: ${eliminados} mensajes eliminados.`);
    return { ok: true, eliminados };
  }

  // Genera notificaciones para los usuarios recién agregados a una sala.
  // Llamado desde el frontend cuando se agregan miembros — usa service_role
  // para bypassar RLS de la tabla notificaciones.
  async notificarInvitacionSala(
    salaId: string,
    emails: string[],
    invitadoPor: string,
  ) {
    const client = this.supabase.getClient();
    const limpios = (emails || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean);
    if (limpios.length === 0) return { ok: true, creadas: 0 };

    // Traer el nombre de la sala para que la notificación sea informativa
    const { data: sala } = await client
      .from('chat_salas')
      .select('nombre')
      .eq('id', salaId)
      .maybeSingle();
    const nombreSala = sala?.nombre || 'una sala de chat';

    // Nombre de quien invita (si hay perfil)
    const invitador = String(invitadoPor || '').trim().toLowerCase();
    let nombreInvitador = invitador;
    if (invitador) {
      const { data: p } = await client
        .from('profiles')
        .select('nombre')
        .ilike('email', invitador)
        .maybeSingle();
      nombreInvitador = p?.nombre || invitador;
    }

    const rows = limpios.map((user_email) => ({
      user_email,
      tipo: 'chat_invitacion',
      mensaje: `${nombreInvitador} te agregó a la sala "${nombreSala}".`,
      link: `/bitacora-cotizaciones`,
      metadata: { sala_id: salaId },
    }));
    const { error } = await client.from('notificaciones').insert(rows);
    if (error) {
      this.logger.error(`No se pudo notificar invitación: ${error.message}`);
      // No bloqueamos — la invitación ya quedó en chat_sala_miembros
    }
    return { ok: true, creadas: rows.length };
  }
}
