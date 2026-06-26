import { Module } from '@nestjs/common';
import { LicitacionesController } from './licitaciones.controller';
import { LicitacionesService } from './licitaciones.service';
import { MailingsModule } from '../mailings/mailings.module';

@Module({
  imports: [MailingsModule],
  controllers: [LicitacionesController],
  providers: [LicitacionesService],
  exports: [LicitacionesService],
})
export class LicitacionesModule {}
