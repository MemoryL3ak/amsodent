import { Module } from '@nestjs/common';
import { CampanasController } from './campanas.controller';
import { CampanasService } from './campanas.service';
import { CampanasMargenController } from './campanas-margen.controller';
import { CampanasMargenService } from './campanas-margen.service';

@Module({
  controllers: [CampanasController, CampanasMargenController],
  providers: [CampanasService, CampanasMargenService],
})
export class CampanasModule {}
