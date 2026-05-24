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
}
