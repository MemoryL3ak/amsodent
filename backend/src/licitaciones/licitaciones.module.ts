import { Module } from '@nestjs/common';
import { LicitacionesController } from './licitaciones.controller';
import { LicitacionesService } from './licitaciones.service';
import { MpExploracionCron } from './mp-exploracion.cron';
import { EquivalenciasCron } from './equivalencias.cron';
import { FacturasVencidasCron } from './facturas-vencidas.cron';
import { MailingsModule } from '../mailings/mailings.module';
import { MercadopublicoModule } from '../mercadopublico/mercadopublico.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  // MercadopublicoModule: la exploración automática le cede el paso a la
  // sincronización de las 23:00 (misma API, cuota compartida).
  // ChatModule: aviso en la sala General (y WhatsApp) al tomar una postulación.
  imports: [MailingsModule, MercadopublicoModule, ChatModule],
  controllers: [LicitacionesController],
  providers: [LicitacionesService, MpExploracionCron, EquivalenciasCron, FacturasVencidasCron],
  exports: [LicitacionesService],
})
export class LicitacionesModule {}
