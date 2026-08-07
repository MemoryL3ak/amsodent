import { Module } from '@nestjs/common';
import { MercadopublicoController } from './mercadopublico.controller';
import { MercadopublicoService } from './mercadopublico.service';

@Module({
  controllers: [MercadopublicoController],
  providers: [MercadopublicoService],
})
export class MercadopublicoModule {}
