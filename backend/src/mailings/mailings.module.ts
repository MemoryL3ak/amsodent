import { Module } from '@nestjs/common';
import { MailingsController } from './mailings.controller';
import { MailingsTrackController } from './mailings-track.controller';
import { MailingsService } from './mailings.service';

@Module({
  controllers: [MailingsController, MailingsTrackController],
  providers: [MailingsService],
  exports: [MailingsService],
})
export class MailingsModule {}
