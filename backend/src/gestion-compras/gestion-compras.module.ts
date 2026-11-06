import { Module } from '@nestjs/common';
import { BsaleModule } from '../bsale/bsale.module';
import { GestionComprasController } from './gestion-compras.controller';
import { GestionComprasService } from './gestion-compras.service';
import { GestionComprasExtrasService } from './gestion-compras-extras.service';

@Module({
  // BsaleModule: lo despachado sale de las guías leídas en Bsale (BsaleService).
  imports: [BsaleModule],
  controllers: [GestionComprasController],
  providers: [GestionComprasService, GestionComprasExtrasService],
})
export class GestionComprasModule {}
