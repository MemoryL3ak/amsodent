import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { BsaleModule } from '../bsale/bsale.module';
import { PreciosCambiosService } from './precios-cambios.service';
import { PreciosSheetController } from './precios-sheet.controller';
import { PreciosSheetService } from './precios-sheet.service';
import { PreciosSheetCron } from './precios-sheet.cron';

@Module({
  // BsaleModule: los productos con SKU se crean también en Bsale (2026-10-03).
  imports: [BsaleModule],
  // (2026-11-12) Actualización de precios y envío al Google Sheet «Lista de Precios».
  controllers: [ProductosController, PreciosSheetController],
  providers: [ProductosService, PreciosCambiosService, PreciosSheetService, PreciosSheetCron],
  // El explorador de precios crea productos transitorios con el mismo servicio (2026-10-07).
  exports: [ProductosService],
})
export class ProductosModule {}
