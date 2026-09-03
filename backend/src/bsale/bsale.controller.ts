import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { BsaleService } from './bsale.service';
import { BsaleCron } from './bsale.cron';
import { AdminGuard } from '../auth/admin.guard';

// Integración Bsale (catálogo y stock): SOLO administradores — vive dentro
// del módulo Inventario, que ya es admin-only.
@Controller('bsale')
@UseGuards(AdminGuard)
export class BsaleController {
  constructor(
    private bsale: BsaleService,
    private cron: BsaleCron,
  ) {}

  // Configuración + última corrida, para la tarjeta del módulo Inventario.
  @Get('estado')
  async estado() {
    return { ...(await this.bsale.estado()), automatica: this.cron.estado() };
  }

  // Diferencias de catálogo de la última corrida (Bsale vs catálogo interno).
  @Get('diferencias')
  diferencias() {
    return this.bsale.diferencias();
  }

  // Sincronización manual (además de la automática del cron).
  @Post('sincronizar')
  sincronizar(@Req() req: any) {
    const usuario = (req?.user?.email || '').toString().trim().toLowerCase() || undefined;
    return this.bsale.sincronizar({ usuario });
  }
}
