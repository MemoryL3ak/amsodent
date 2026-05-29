import { Module } from '@nestjs/common';
import { StockClientesController } from './stock-clientes.controller';
import { StockClientesService } from './stock-clientes.service';
import { MailingsModule } from '../mailings/mailings.module';
import { CorreosModule } from '../correos/correos.module';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [MailingsModule, CorreosModule],
  controllers: [StockClientesController],
  providers: [StockClientesService, AuthGuard, AdminGuard],
  exports: [StockClientesService],
})
export class StockClientesModule {}
