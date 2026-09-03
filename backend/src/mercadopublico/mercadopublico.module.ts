import { Module } from '@nestjs/common';
import { MercadopublicoController } from './mercadopublico.controller';
import { MercadopublicoService } from './mercadopublico.service';
import { MercadopublicoCron } from './mercadopublico.cron';
import { MailingsModule } from '../mailings/mailings.module';

@Module({
  // MailingsModule: correo SMTP del aviso de adjudicación ganada.
  imports: [MailingsModule],
  controllers: [MercadopublicoController],
  providers: [MercadopublicoService, MercadopublicoCron],
  // El cron se exporta para que la exploración automática (LicitacionesModule)
  // pueda cederle el paso a las 23:00: ambos usan la misma API y correr los
  // dos a la vez la satura (12 + 6 conexiones, con colapso medido en 24).
  exports: [MercadopublicoCron],
})
export class MercadopublicoModule {}
