import { Module } from '@nestjs/common';
import { MercadopublicoController } from './mercadopublico.controller';
import { MercadopublicoService } from './mercadopublico.service';
import { MercadopublicoCron } from './mercadopublico.cron';
import { MpColaService } from './mp-cola.service';

@Module({
  controllers: [MercadopublicoController],
  providers: [MercadopublicoService, MercadopublicoCron, MpColaService],
  // El cron se exporta para que la exploración automática (LicitacionesModule)
  // pueda cederle el paso a las 23:00: ambos usan la misma API y correr los
  // dos a la vez la satura (12 + 6 conexiones, con colapso medido en 24).
  // (2026-10-21) El servicio y la cola se exportan para el robot y para que
  // LicitacionesService encole diagnósticos y verificaciones.
  exports: [MercadopublicoCron, MercadopublicoService, MpColaService],
})
export class MercadopublicoModule {}
