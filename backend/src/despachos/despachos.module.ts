import { Module } from '@nestjs/common';
import { DespachosController } from './despachos.controller';
import { DespachosService } from './despachos.service';

@Module({
  controllers: [DespachosController],
  providers: [DespachosService],
})
export class DespachosModule {}
