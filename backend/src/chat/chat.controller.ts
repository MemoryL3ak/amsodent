import { Body, Controller, Param, Post, Req, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private chat: ChatService) {}

  // Reenvía un mensaje de la sala General al grupo de WhatsApp configurado.
  // Fire-and-forget desde el frontend: nunca bloquea el envío del chat.
  @Post('whatsapp')
  @UseGuards(AuthGuard)
  whatsapp(
    @Req() req: any,
    @Body() body: { autor?: string; texto?: string; tipo?: string; adjunto_url?: string; file_name?: string },
  ) {
    return this.chat.enviarWhatsApp({
      autor: body?.autor || String(req?.user?.email || ''),
      texto: body?.texto,
      tipo: body?.tipo,
      adjunto_url: body?.adjunto_url,
      file_name: body?.file_name,
    });
  }

  /* Webhook de Green API: mensajes que llegan al grupo de WhatsApp.
     NO lleva AuthGuard porque quien llama es Green API, que no tiene sesión de
     Supabase; se protege con un secreto compartido en la propia URL, que es lo
     que su panel permite configurar. Sin `WHATSAPP_WEBHOOK_SECRET` el endpoint
     queda cerrado: es preferible a dejar abierta una vía para escribir en el
     chat de la empresa.

     Responde 200 siempre que el mensaje se haya procesado o descartado a
     propósito; si devolviera error, Green API reintentaría en bucle. */
  @Post('whatsapp/entrante/:secreto')
  async whatsappEntrante(@Param('secreto') secreto: string, @Body() body: any) {
    const esperado = (process.env.WHATSAPP_WEBHOOK_SECRET || '').trim();
    if (!esperado) throw new UnauthorizedException('El webhook de WhatsApp no está habilitado en el servidor.');
    if (String(secreto || '') !== esperado) throw new UnauthorizedException('Secreto inválido.');
    try {
      return await this.chat.recibirWhatsApp(body);
    } catch (e: any) {
      // Un fallo nuestro no debe provocar reintentos infinitos de Green API.
      return { ok: false, motivo: String(e?.message || e).slice(0, 200) };
    }
  }

  // Solo admin puede limpiar todas las salas.
  @Post('limpiar-todas-salas')
  @UseGuards(AdminGuard)
  limpiarTodasSalas() {
    return this.chat.limpiarTodasSalas();
  }

  // Un admin puede eliminar CUALQUIER mensaje. Los propios se borran directo
  // desde el frontend vía RLS (que solo permite borrar lo de uno); esta ruta
  // cubre los ajenos con la service role.
  @Post('eliminar-mensaje')
  @UseGuards(AdminGuard)
  eliminarMensaje(@Body() body: { id?: string }) {
    const id = String(body?.id || '').trim();
    if (!id) throw new BadRequestException('Falta el id del mensaje.');
    return this.chat.eliminarMensaje(id);
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
