import { Module } from '@nestjs/common';
import { BsaleModule } from '../bsale/bsale.module';
import { TiendaWebController } from './tienda-web.controller';
import { TiendaWebService } from './tienda-web.service';

// Pedidos pagados de la tienda web amsodentmedical.cl → boleta/factura en Bsale (2026-11-26).
@Module({
  imports: [BsaleModule],
  controllers: [TiendaWebController],
  providers: [TiendaWebService],
})
export class TiendaWebModule {}
