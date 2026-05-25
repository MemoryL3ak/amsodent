import { Body, Controller, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private chat: ChatService) {}

  // Solo admin puede limpiar todas las salas.
  @Post('limpiar-todas-salas')
  @UseGuards(AdminGuard)
  limpiarTodasSalas() {
    return this.chat.limpiarTodasSalas();
  }

  // Llamado tras agregar miembros a una sala — crea notificaciones para
  // los recién invitados. Cualquier usuario autenticado puede invocar este
  // endpoint (la invitación misma ya pasó por RLS de chat_sala_miembros).
  @Post('notificar-invitacion')
  @UseGuards(AuthGuard)
  notificarInvitacion(
    @Req() req: any,
    @Body() body: { sala_id?: string; emails?: string[] },
  ) {
    const salaId = String(body?.sala_id || '').trim();
    const emails = Array.isArray(body?.emails) ? body.emails : [];
    if (!salaId) throw new BadRequestException('Falta sala_id.');
    if (emails.length === 0) return { ok: true, creadas: 0 };
    const invitadoPor = String(req?.user?.email || '').trim().toLowerCase();
    return this.chat.notificarInvitacionSala(salaId, emails, invitadoPor);
  }

  // Notificación genérica del chat (ej. sala eliminada). El frontend usa
  // este endpoint cuando ya tiene la lista de destinatarios.
  @Post('notificar-evento')
  @UseGuards(AuthGuard)
  notificarEvento(
    @Body()
    body: {
      tipo?: string;
      mensaje?: string;
      emails?: string[];
      link?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const tipo = String(body?.tipo || '').trim();
    const mensaje = String(body?.mensaje || '').trim();
    const emails = Array.isArray(body?.emails) ? body.emails : [];
    if (!tipo || !mensaje) {
      throw new BadRequestException('Faltan tipo y/o mensaje.');
    }
    return this.chat.notificarEvento({
      tipo,
      mensaje,
      emails,
      link: body?.link,
      metadata: body?.metadata,
    });
  }
}
