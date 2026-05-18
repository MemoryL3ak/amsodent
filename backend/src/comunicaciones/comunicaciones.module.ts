import { Module } from '@nestjs/common';
import { ComunicacionesController } from './comunicaciones.controller';
import { ComunicacionesService } from './comunicaciones.service';
import { ComunicacionesCronService } from './comunicaciones.cron';
import { SupabaseModule } from '../supabase/supabase.module';
import { GoogleAuthModule } from '../google-auth/google-auth.module';
import { PlantillasModule } from '../plantillas/plantillas.module';

@Module({
  imports: [SupabaseModule, GoogleAuthModule, PlantillasModule],
  controllers: [ComunicacionesController],
  providers: [ComunicacionesService, ComunicacionesCronService],
  exports: [ComunicacionesService],
})
export class ComunicacionesModule {}
