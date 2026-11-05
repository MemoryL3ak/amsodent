import { Module } from '@nestjs/common';
import { RepositorioController } from './repositorio.controller';
import { RepositorioService } from './repositorio.service';
import { RepositorioCron } from './repositorio.cron';

// Repositorio de documentos de la empresa con su vigencia (2026-11-05).
@Module({
  controllers: [RepositorioController],
  providers: [RepositorioService, RepositorioCron],
})
export class RepositorioModule {}
