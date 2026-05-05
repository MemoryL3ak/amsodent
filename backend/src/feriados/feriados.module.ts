import { Module } from '@nestjs/common';
import { FeriadosController } from './feriados.controller';
import { FeriadosService } from './feriados.service';

@Module({
  controllers: [FeriadosController],
  providers: [FeriadosService],
  exports: [FeriadosService],
})
export class FeriadosModule {}
