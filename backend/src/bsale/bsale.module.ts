import { Module } from '@nestjs/common';
import { BsaleController } from './bsale.controller';
import { BsaleService } from './bsale.service';
import { BsaleCron } from './bsale.cron';
import { BsaleFacturacionController } from './bsale-facturacion.controller';
import { BsaleFacturacionService } from './bsale-facturacion.service';
import { BsaleDespachosController } from './bsale-despachos.controller';
import { BsaleDespachosService } from './bsale-despachos.service';
import { LicitacionesModule } from '../licitaciones/licitaciones.module';

@Module({
  // LicitacionesModule: la guía emitida en Bsale se registra en Trazabilidad con
  // el mismo servicio que una subida a mano (y avisa al vendedor igual).
  imports: [LicitacionesModule],
  controllers: [BsaleController, BsaleFacturacionController, BsaleDespachosController],
  providers: [BsaleService, BsaleCron, BsaleFacturacionService, BsaleDespachosService],
})
export class BsaleModule {}
