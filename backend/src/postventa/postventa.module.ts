import { Module } from '@nestjs/common';
import { StockClientesModule } from '../stock-clientes/stock-clientes.module';
import { PostventaController } from './postventa.controller';
import { PostventaPortalController } from './postventa-portal.controller';
import { PostventaService } from './postventa.service';

/* (2026-11-26) Postventa: reclamos de clientes en la plataforma y en el portal.
   StockClientesModule aporta el guard del portal (StockClientesService), los
   módulos del portal por cliente (PortalModulosService) y los avisos al
   cliente (PedidosFlujoService.anotarActividad). */
@Module({
  imports: [StockClientesModule],
  controllers: [PostventaController, PostventaPortalController],
  providers: [PostventaService],
})
export class PostventaModule {}
