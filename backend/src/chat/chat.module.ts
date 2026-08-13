import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService],
  // Exportado para los avisos automáticos de otros módulos (ej. Licitaciones
  // publica en la sala General cuando alguien toma una postulación).
  exports: [ChatService],
})
export class ChatModule {}
