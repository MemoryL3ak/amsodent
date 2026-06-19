import { Module } from '@nestjs/common';
import { ActividadesController } from './actividades.controller';
import { ActividadesService } from './actividades.service';
import { CalendarApiService } from './calendar-api.service';

@Module({
  controllers: [ActividadesController],
  providers: [ActividadesService, CalendarApiService],
})
export class ActividadesModule {}
