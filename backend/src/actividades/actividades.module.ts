import { Module } from '@nestjs/common';
import { ActividadesController } from './actividades.controller';
import { ActividadesService } from './actividades.service';
import { CalendarApiService } from './calendar-api.service';
import { CalendarSyncCron } from './calendar-sync.cron';

@Module({
  controllers: [ActividadesController],
  providers: [ActividadesService, CalendarApiService, CalendarSyncCron],
})
export class ActividadesModule {}
