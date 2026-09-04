import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
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

  // Venta total emitida en Bsale en un rango (comparativo del Panel de Indicadores).
  @Get('ventas')
  ventas(@Query('desde') desde: string, @Query('hasta') hasta: string) {
    return this.bsale.ventas(String(desde || ''), String(hasta || ''));
  }

  // Guía de despacho emitida en Bsale (por número): ítems + referencias,
  // para el cruce guía↔OC de Trazabilidad.
  @Get('guia')
  guia(@Query('numero') numero: string) {
    return this.bsale.guiaDespacho(String(numero || ''));
  }

  // Sincronización manual (además de la automática del cron). Responde al
  // tiro con { iniciado: true }; el avance se sigue por GET /bsale/estado.
  @Post('sincronizar')
  sincronizar(@Req() req: any) {
    const usuario = (req?.user?.email || '').toString().trim().toLowerCase() || undefined;
    return this.bsale.iniciar({ usuario });
  }
}
