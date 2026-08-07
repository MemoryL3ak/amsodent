import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { MercadopublicoService } from './mercadopublico.service';
import { AdminGuard } from '../auth/admin.guard';

// Benchmark de postulaciones vs Mercado Público: SOLO administradores.
@Controller('mercado-publico')
@UseGuards(AdminGuard)
export class MercadopublicoController {
  constructor(private mpService: MercadopublicoService) {}

  // Configuración disponible (ticket / RUT empresa) para la UI.
  @Get('estado')
  estado() {
    return this.mpService.estado();
  }

  // Resultados guardados (mp_resultados + datos de la cotización interna).
  @Get('resultados')
  resultados() {
    return this.mpService.resultados();
  }

  // Consulta la API oficial para los procesos aún sin resultado final.
  // body opcional: { desde: 'YYYY-MM-DD', hasta: 'YYYY-MM-DD', lote: n }
  // (el frontend sincroniza en tandas chicas y refresca entre cada una)
  @Post('sincronizar')
  sincronizar(@Body() body: any) {
    return this.mpService.sincronizar(body || {});
  }
}
