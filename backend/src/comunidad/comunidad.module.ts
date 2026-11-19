import { Module } from '@nestjs/common';
import { ComunidadController } from './comunidad.controller';
import { ComunidadService } from './comunidad.service';
import { RastreoService } from './rastreo.service';
import { ComunidadMailingService } from './comunidad-mailing.service';
import { MailingsModule } from '../mailings/mailings.module';

@Module({
  imports: [MailingsModule],
  controllers: [ComunidadController],
  providers: [ComunidadService, RastreoService, ComunidadMailingService],
})
export class ComunidadModule {}
