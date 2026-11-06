import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CajaGuard } from './caja.guard';
import { CajaService } from './caja.service';

// Apertura y cierre de caja de la sala de ventas (2026-11-05). Acceso: admin,
// el usuario de la tienda y los perfiles con el módulo «caja» (CajaGuard).
@Controller('caja')
@UseGuards(AuthGuard, CajaGuard)
export class CajaController {
  constructor(private caja: CajaService) {}

  @Get('estado')
  estado() {
    return this.caja.estado();
  }

  @Get('historial')
  historial(@Query('limite') limite?: string) {
    return this.caja.historial(Number(limite) || 200);
  }

  // (2026-11-06) Reporte diario: ventas por medio de pago, movimientos y saldo que debería quedar en caja.
  @Get('reporte-diario')
  reporteDiario(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.caja.reporteDiario(desde, hasta);
  }

  @Get('turnos/:id')
  turno(@Param('id', ParseIntPipe) id: number) {
    return this.caja.turno(id);
  }

  @Post('abrir')
  abrir(@Body() body: any, @Req() req: any) {
    return this.caja.abrir(body, req.cajaEmail);
  }

  @Post('movimientos')
  movimiento(@Body() body: any, @Req() req: any) {
    return this.caja.movimiento(body, req.cajaEmail);
  }

  @Delete('movimientos/:id')
  eliminarMovimiento(@Param('id', ParseIntPipe) id: number) {
    return this.caja.eliminarMovimiento(id);
  }

  @Post('cerrar')
  cerrar(@Body() body: any, @Req() req: any) {
    return this.caja.cerrar(body, req.cajaEmail);
  }
}
