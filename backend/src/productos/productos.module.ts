import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { BsaleModule } from '../bsale/bsale.module';
import { PreciosCambiosService } from './precios-cambios.service';
import { PreciosSheetController } from './precios-sheet.controller';
import { PreciosSheetService } from './precios-sheet.service';
import { PreciosSheetCron } from './precios-sheet.cron';
import { CostosRecepcionService } from './costos-recepcion.service';

@Module({
  // BsaleModule: los productos con SKU se crean también en Bsale (2026-10-03).
  imports: [BsaleModule],
  // (2026-11-12) Actualización de precios y envío al Google Sheet «Lista de Precios».
  controllers: [ProductosController, PreciosSheetController],
  // (2026-11-17) Costos por confirmar tras una recepción de stock con costo mayor.
  providers: [ProductosService, PreciosCambiosService, PreciosSheetService, PreciosSheetCron, CostosRecepcionService],
  // El explorador de precios crea productos transitorios con el mismo servicio (2026-10-07).
  exports: [ProductosService],
})
export class ProductosModule {}
