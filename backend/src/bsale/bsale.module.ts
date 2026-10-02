import { Module } from '@nestjs/common';
import { BsaleController } from './bsale.controller';
import { BsaleService } from './bsale.service';
import { BsaleCron } from './bsale.cron';
import { BsaleFacturacionController } from './bsale-facturacion.controller';
import { BsaleFacturacionService } from './bsale-facturacion.service';

@Module({
  controllers: [BsaleController, BsaleFacturacionController],
  providers: [BsaleService, BsaleCron, BsaleFacturacionService],
})
export class BsaleModule {}
