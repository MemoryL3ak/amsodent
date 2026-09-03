import { Module } from '@nestjs/common';
import { BsaleController } from './bsale.controller';
import { BsaleService } from './bsale.service';
import { BsaleCron } from './bsale.cron';

@Module({
  controllers: [BsaleController],
  providers: [BsaleService, BsaleCron],
})
export class BsaleModule {}
