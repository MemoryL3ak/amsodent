import { Module } from '@nestjs/common';
import { StockClientesController } from './stock-clientes.controller';
import { StockClientesService } from './stock-clientes.service';
import { ExploradorService } from './explorador.service';
import { PedidosFlujoService } from './pedidos-flujo.service';
import { WebpayService } from './webpay.service';
import { OfertasPortalService } from './ofertas-portal.service';
import { PortalModulosService } from './portal-modulos.service';
import { ExploradorProductosService } from './explorador-productos.service';
import { InventarioPortalService } from './inventario-portal.service';
import { RecepcionPortalService } from './recepcion-portal.service';
import { MailingsModule } from '../mailings/mailings.module';
import { CorreosModule } from '../correos/correos.module';
import { LicitacionesModule } from '../licitaciones/licitaciones.module';
import { ProductosModule } from '../productos/productos.module';
import { CampanasModule } from '../campanas/campanas.module';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  // ProductosModule: crear productos transitorios desde el explorador (2026-10-07).
  // CampanasModule: las ofertas del portal son campañas de margen de canal «portal» (2026-11-05).
  imports: [MailingsModule, CorreosModule, LicitacionesModule, ProductosModule, CampanasModule],
  controllers: [StockClientesController],
  providers: [StockClientesService, ExploradorService, PedidosFlujoService, WebpayService, OfertasPortalService, PortalModulosService, ExploradorProductosService, InventarioPortalService, RecepcionPortalService, AuthGuard, AdminGuard],
  exports: [StockClientesService, PedidosFlujoService],
})
export class StockClientesModule {}
