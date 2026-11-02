import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { InventarioGuard } from '../inventario/inventario.guard';
import { InventarioTrasladosGuard } from '../inventario/inventario-traslados.guard';
import { BsaleTrasladosService } from './bsale-traslados.service';

// (2026-11-02) Guía de traslado interno en Bsale para un traslado del
// inventario. Mismos permisos que los traslados: lee quien ve el Inventario;
// prepara y emite un admin o quien tenga «inventario_traslados» en su perfil.
@Controller('bsale/traslados')
@UseGuards(AuthGuard, InventarioGuard)
export class BsaleTrasladosController {
  constructor(private traslados: BsaleTrasladosService) {}

  // Sucursales de la cuenta de Bsale (para asociarlas en el mantenedor).
  @Get('oficinas')
  oficinas() {
    return this.traslados.oficinas();
  }

  // Borrador de la guía: qué iría a Bsale y qué lo impide. No escribe nada.
  @Post('preparar')
  @UseGuards(InventarioTrasladosGuard)
  preparar(@Body() body: { traslado_id: number }) {
    return this.traslados.preparar(Number(body?.traslado_id));
  }

  // Emite la guía (o la simula con `simular: true`).
  @Post('emitir')
  @UseGuards(InventarioTrasladosGuard)
  emitir(@Req() req: any, @Body() body: any) {
    return this.traslados.emitir({ id: String(req?.user?.id || ''), email: String(req?.user?.email || '').trim().toLowerCase() }, body || {});
  }
}
