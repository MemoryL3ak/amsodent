import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';
import { ProductosService } from './productos.service';
import { BsaleModule } from '../bsale/bsale.module';

@Module({
  // BsaleModule: los productos con SKU se crean también en Bsale (2026-10-03).
  imports: [BsaleModule],
  controllers: [ProductosController],
  providers: [ProductosService],
})
export class ProductosModule {}
