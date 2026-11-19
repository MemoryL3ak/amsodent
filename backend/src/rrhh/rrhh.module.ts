import { Module } from '@nestjs/common';
import { RrhhController } from './rrhh.controller';
import { RrhhService } from './rrhh.service';
import { E360Controller } from './e360.controller';
import { E360Service } from './e360.service';

@Module({
  controllers: [RrhhController, E360Controller],
  providers: [RrhhService, E360Service],
  exports: [RrhhService],
})
export class RrhhModule {}
