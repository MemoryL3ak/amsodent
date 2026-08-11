import { Module } from '@nestjs/common';
import { MercadopublicoController } from './mercadopublico.controller';
import { MercadopublicoService } from './mercadopublico.service';
import { MercadopublicoCron } from './mercadopublico.cron';

@Module({
  controllers: [MercadopublicoController],
  providers: [MercadopublicoService, MercadopublicoCron],
})
export class MercadopublicoModule {}
