import { Module } from '@nestjs/common';
import { CampanasMargenController } from './campanas-margen.controller';
import { CampanasMargenService } from './campanas-margen.service';

/* (2026-11-05) Un solo módulo de campañas: el de las campañas por producto con
   precio fijo (CampanasController/CampanasService, tablas product_campaigns)
   se eliminó a pedido de Ariel. Queda Campañas de margen, que ahora también
   lleva las ofertas del portal del cliente (canal) y el cupo de unidades. */
@Module({
  controllers: [CampanasMargenController],
  providers: [CampanasMargenService],
  // El portal del cliente lee de aquí sus ofertas (OfertasPortalService).
  exports: [CampanasMargenService],
})
export class CampanasModule {}
