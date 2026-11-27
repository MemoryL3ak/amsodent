import { Module } from '@nestjs/common';
import { NotasController } from './notas.controller';
import { NotasService } from './notas.service';

/* (2026-11-27) Notas adhesivas personales (panel lateral derecho). */
@Module({
  controllers: [NotasController],
  providers: [NotasService],
})
export class NotasModule {}
