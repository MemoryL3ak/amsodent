import { Module } from '@nestjs/common';
import { MarcajesController } from './marcajes.controller';
import { MarcajesService } from './marcajes.service';

@Module({
  controllers: [MarcajesController],
  providers: [MarcajesService],
  exports: [MarcajesService],
})
export class MarcajesModule {}
