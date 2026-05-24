import { Module } from '@nestjs/common';
import { CorreosController } from './correos.controller';
import { CorreosService } from './correos.service';
import { GmailApiService } from './gmail-api.service';
import { FirmasService } from './firmas.service';
import { MailingsModule } from '../mailings/mailings.module';

@Module({
  imports: [MailingsModule],
  controllers: [CorreosController],
  providers: [CorreosService, GmailApiService, FirmasService],
  exports: [CorreosService, FirmasService],
})
export class CorreosModule {}
