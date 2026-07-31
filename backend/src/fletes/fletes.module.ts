import { Module } from '@nestjs/common';
import { FletesController } from './fletes.controller';
import { FletesService } from './fletes.service';

@Module({
  controllers: [FletesController],
  providers: [FletesService],
})
export class FletesModule {}
