import { Module } from '@nestjs/common';
import { BsaleController } from './bsale.controller';
import { BsaleService } from './bsale.service';
import { BsaleCron } from './bsale.cron';
import { BsaleFacturacionController } from './bsale-facturacion.controller';
import { BsaleFacturacionService } from './bsale-facturacion.service';
import { BsaleDespachosController } from './bsale-despachos.controller';
import { BsaleDespachosService } from './bsale-despachos.service';
import { BsaleLibreController } from './bsale-libre.controller';
import { BsaleLibreService } from './bsale-libre.service';
import { BsaleProductosService } from './bsale-productos.service';
import { BsaleAnulacionesController } from './bsale-anulaciones.controller';
import { BsaleAnulacionesService } from './bsale-anulaciones.service';
import { BsaleEstadosService } from './bsale-estados.service';
import { LicitacionesModule } from '../licitaciones/licitaciones.module';

@Module({
  // LicitacionesModule: la guía emitida en Bsale se registra en Trazabilidad con
  // el mismo servicio que una subida a mano (y avisa al vendedor igual).
  imports: [LicitacionesModule],
  controllers: [BsaleController, BsaleFacturacionController, BsaleDespachosController, BsaleLibreController, BsaleAnulacionesController],
  providers: [BsaleService, BsaleCron, BsaleFacturacionService, BsaleDespachosService, BsaleLibreService, BsaleProductosService, BsaleAnulacionesService, BsaleEstadosService],
  // Productos: un producto nuevo con SKU (o al que se le asigna uno) se crea en Bsale.
  exports: [BsaleProductosService],
})
export class BsaleModule {}
