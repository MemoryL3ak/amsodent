import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { MercadopublicoService } from './mercadopublico.service';
import { MercadopublicoCron } from './mercadopublico.cron';
import { AdminGuard } from '../auth/admin.guard';

// Benchmark de postulaciones vs Mercado Público: SOLO administradores.
@Controller('mercado-publico')
@UseGuards(AdminGuard)
export class MercadopublicoController {
  constructor(
    private mpService: MercadopublicoService,
    private cron: MercadopublicoCron,
  ) {}

  // Configuración disponible (ticket / RUT empresa) para la UI.
  @Get('estado')
  estado() {
    return { ...this.mpService.estado(), automatica: this.cron.estado() };
  }

  // Resultados guardados (mp_resultados + datos de la cotización interna).
  //
  // `desde` (ISO) devuelve SOLO las fichas consultadas después de ese instante.
  // Lo usa la sincronización para refrescar el panel entre tandas: la carga
  // completa pesa 6 MB hoy (24 MB proyectados con el catálogo entero), así que
  // pedirla cada 45 s era inviable y por eso la pantalla se quedaba quieta
  // varios minutos. El delta de una tanda son ~12 fichas, unos 90 KB.
  @Get('resultados')
  resultados(@Query('desde') desde?: string) {
    return this.mpService.resultados(desde);
  }

  // Consulta la API oficial para los procesos aún sin resultado final.
  // body opcional: { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD', lote: n }
  // (el frontend sincroniza en tandas chicas y refresca entre cada una)
  @Post('sincronizar')
  sincronizar(@Body() body: any) {
    return this.mpService.sincronizar(body || {});
  }
}
