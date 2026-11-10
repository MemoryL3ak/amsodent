import { Module } from '@nestjs/common';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';
import { LotesService } from './lotes.service';

@Module({
  controllers: [InventarioController],
  providers: [InventarioService, LotesService],
  // (2026-11-02) BsaleModule: la sincronización de stock escribe por acá
  // (aplicarStockExterno), así cae en la sucursal principal y queda en el libro.
  // (2026-11-09) LotesService: la recepción crea los lotes y las guías los descuentan.
  exports: [InventarioService, LotesService],
})
export class InventarioModule {}
