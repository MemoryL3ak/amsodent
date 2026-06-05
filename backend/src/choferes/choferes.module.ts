import { Module } from '@nestjs/common';
import { ChoferesController } from './choferes.controller';
import { ChoferesService } from './choferes.service';
import { ChoferPortalGuard } from './choferes.guard';
import { MailingsModule } from '../mailings/mailings.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [MailingsModule],
  controllers: [ChoferesController],
  providers: [ChoferesService, ChoferPortalGuard, AdminGuard],
  exports: [ChoferesService],
})
export class ChoferesModule {}
