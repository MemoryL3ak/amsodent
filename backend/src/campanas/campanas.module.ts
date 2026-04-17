import { Module } from '@nestjs/common';
import { CampanasController } from './campanas.controller';
import { CampanasService } from './campanas.service';

@Module({
  controllers: [CampanasController],
  providers: [CampanasService],
})
export class CampanasModule {}
