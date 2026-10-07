import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';
import { MonitoreoAlertasController } from './monitoreo-alertas.controller';
import { MonitoreoAlertasService } from './monitoreo-alertas.service';
import { MonitoreoAlertasGuard } from './monitoreo-alertas.guard';

@Module({
  controllers: [NotificacionesController, MonitoreoAlertasController],
  providers: [NotificacionesService, MonitoreoAlertasService, MonitoreoAlertasGuard],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
