import { Module } from '@nestjs/common';
import { RrhhController } from './rrhh.controller';
import { RrhhService } from './rrhh.service';

@Module({
  controllers: [RrhhController],
  providers: [RrhhService],
  exports: [RrhhService],
})
export class RrhhModule {}
