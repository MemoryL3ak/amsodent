import { Module } from '@nestjs/common';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';
import { CajaGuard } from './caja.guard';

// Apertura y cierre de caja de la sala de ventas (2026-11-05).
@Module({
  controllers: [CajaController],
  providers: [CajaService, CajaGuard],
})
export class CajaModule {}
