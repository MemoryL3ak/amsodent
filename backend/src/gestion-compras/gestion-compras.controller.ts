import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { GestionComprasGuard } from './gestion-compras.guard';
import { GestionComprasService } from './gestion-compras.service';

// Gestión de compras (2026-10-16): cotizaciones adjudicadas vs. stock y lo que falta comprar.
@Controller('gestion-compras')
@UseGuards(AuthGuard, GestionComprasGuard)
export class GestionComprasController {
  constructor(private gestion: GestionComprasService) {}

  @Get()
  resumen(@Query('desde') desde?: string) {
    return this.gestion.resumen(desde);
  }
}
