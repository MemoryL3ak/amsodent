import { Module } from '@nestjs/common';
import { BsaleModule } from '../bsale/bsale.module';
import { MailingsModule } from '../mailings/mailings.module';
import { GestionComprasController } from './gestion-compras.controller';
import { QuiebresStockController } from './quiebres-stock.controller';
import { GestionComprasService } from './gestion-compras.service';
import { GestionComprasExtrasService } from './gestion-compras-extras.service';
import { MovimientoProductosService } from './movimiento-productos.service';

@Module({
  // BsaleModule: lo despachado sale de las guías leídas en Bsale (BsaleService).
  // MailingsModule (2026-11-09): correo al vendedor al declarar un quiebre de stock.
  imports: [BsaleModule, MailingsModule],
  controllers: [GestionComprasController, QuiebresStockController],
  providers: [GestionComprasService, GestionComprasExtrasService, MovimientoProductosService],
})
export class GestionComprasModule {}
