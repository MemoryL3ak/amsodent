import { Module } from '@nestjs/common';
import { StockClientesController } from './stock-clientes.controller';
import { StockClientesService } from './stock-clientes.service';
import { ExploradorService } from './explorador.service';
import { PedidosFlujoService } from './pedidos-flujo.service';
import { WebpayService } from './webpay.service';
import { OfertasPortalService } from './ofertas-portal.service';
import { OfertasPortalController } from './ofertas-portal.controller';
import { PortalModulosService } from './portal-modulos.service';
import { ExploradorProductosService } from './explorador-productos.service';
import { MailingsModule } from '../mailings/mailings.module';
import { CorreosModule } from '../correos/correos.module';
import { LicitacionesModule } from '../licitaciones/licitaciones.module';
import { ProductosModule } from '../productos/productos.module';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  // ProductosModule: crear productos transitorios desde el explorador (2026-10-07).
  imports: [MailingsModule, CorreosModule, LicitacionesModule, ProductosModule],
  controllers: [StockClientesController, OfertasPortalController],
  providers: [StockClientesService, ExploradorService, PedidosFlujoService, WebpayService, OfertasPortalService, PortalModulosService, ExploradorProductosService, AuthGuard, AdminGuard],
  exports: [StockClientesService, PedidosFlujoService],
})
export class StockClientesModule {}
