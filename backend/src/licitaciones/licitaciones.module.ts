import { Module } from '@nestjs/common';
import { LicitacionesController } from './licitaciones.controller';
import { LicitacionesService } from './licitaciones.service';

@Module({
  controllers: [LicitacionesController],
  providers: [LicitacionesService],
})
export class LicitacionesModule {}
