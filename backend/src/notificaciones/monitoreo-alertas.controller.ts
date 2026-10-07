import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MonitoreoAlertasGuard } from './monitoreo-alertas.guard';
import { MonitoreoAlertasService } from './monitoreo-alertas.service';

// Monitoreo de alertas por vendedor y su cumplimiento (2026-10-07).
@Controller('monitoreo-alertas')
@UseGuards(MonitoreoAlertasGuard)
export class MonitoreoAlertasController {
  constructor(private monitoreo: MonitoreoAlertasService) {}

  @Get()
  resumen(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.monitoreo.monitoreo({ desde, hasta });
  }
}
