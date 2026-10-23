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
import { BsaleImpresionService } from './bsale-impresion.service';
import { BsaleClientesService } from './bsale-clientes.service';
import { LicitacionesModule } from '../licitaciones/licitaciones.module';
import { CorreosModule } from '../correos/correos.module';

@Module({
  // LicitacionesModule: la guía emitida en Bsale se registra en Trazabilidad con
  // el mismo servicio que una subida a mano (y avisa al vendedor igual).
  // CorreosModule: guía, factura y boleta se envían solas al cliente (2026-10-07).
  imports: [LicitacionesModule, CorreosModule],
  controllers: [BsaleController, BsaleFacturacionController, BsaleDespachosController, BsaleLibreController, BsaleAnulacionesController],
  providers: [BsaleService, BsaleCron, BsaleFacturacionService, BsaleDespachosService, BsaleLibreService, BsaleProductosService, BsaleAnulacionesService, BsaleEstadosService, BsaleImpresionService, BsaleClientesService],
  // Productos: un producto nuevo con SKU (o al que se le asigna uno) se crea en Bsale.
  // BsaleService: Gestión de compras lee lo despachado por producto (2026-10-16).
  // BsaleClientesService: los giros de la ficha del cliente van al `activity` de Bsale (2026-10-23).
  exports: [BsaleProductosService, BsaleService, BsaleClientesService],
})
export class BsaleModule {}
