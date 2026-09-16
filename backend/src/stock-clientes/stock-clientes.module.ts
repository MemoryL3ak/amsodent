import { Module } from '@nestjs/common';
import { StockClientesController } from './stock-clientes.controller';
import { StockClientesService } from './stock-clientes.service';
import { ExploradorService } from './explorador.service';
import { PedidosFlujoService } from './pedidos-flujo.service';
import { WebpayService } from './webpay.service';
import { MailingsModule } from '../mailings/mailings.module';
import { CorreosModule } from '../correos/correos.module';
import { LicitacionesModule } from '../licitaciones/licitaciones.module';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [MailingsModule, CorreosModule, LicitacionesModule],
  controllers: [StockClientesController],
  providers: [StockClientesService, ExploradorService, PedidosFlujoService, WebpayService, AuthGuard, AdminGuard],
  exports: [StockClientesService, PedidosFlujoService],
})
export class StockClientesModule {}
