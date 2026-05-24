import { Controller, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
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
}
