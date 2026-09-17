import { Module } from '@nestjs/common';
import { ReporteriaController } from './reporteria.controller';
import { ReporteriaService } from './reporteria.service';

@Module({
  controllers: [ReporteriaController],
  providers: [ReporteriaService],
})
export class ReporteriaModule {}
