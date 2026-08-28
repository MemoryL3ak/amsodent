import { Module } from '@nestjs/common';
import { ComunidadController } from './comunidad.controller';
import { ComunidadService } from './comunidad.service';
import { MailingsModule } from '../mailings/mailings.module';

@Module({
  imports: [MailingsModule],
  controllers: [ComunidadController],
  providers: [ComunidadService],
})
export class ComunidadModule {}
