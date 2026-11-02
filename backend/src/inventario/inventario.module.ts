import { Module } from '@nestjs/common';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';

@Module({
  controllers: [InventarioController],
  providers: [InventarioService],
  // (2026-11-02) BsaleModule: la sincronización de stock escribe por acá
  // (aplicarStockExterno), así cae en la sucursal principal y queda en el libro.
  exports: [InventarioService],
})
export class InventarioModule {}
