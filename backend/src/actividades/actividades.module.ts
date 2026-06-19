import { Module } from '@nestjs/common';
import { ActividadesController } from './actividades.controller';
import { ActividadesService } from './actividades.service';

@Module({
  controllers: [ActividadesController],
  providers: [ActividadesService],
})
export class ActividadesModule {}
