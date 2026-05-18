import { Module } from '@nestjs/common';
import { PlantillasController } from './plantillas.controller';
import { PlantillasService } from './plantillas.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [PlantillasController],
  providers: [PlantillasService],
  exports: [PlantillasService],
})
export class PlantillasModule {}
