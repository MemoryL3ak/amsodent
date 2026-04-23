import { Module } from '@nestjs/common';
import { SorteoController } from './sorteo.controller';
import { SorteoService } from './sorteo.service';

@Module({
  controllers: [SorteoController],
  providers: [SorteoService],
})
export class SorteoModule {}
