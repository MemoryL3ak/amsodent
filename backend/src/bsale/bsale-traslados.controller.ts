import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { InventarioGuard } from '../inventario/inventario.guard';
import { InventarioTrasladosGuard } from '../inventario/inventario-traslados.guard';
import { BsaleTrasladosService } from './bsale-traslados.service';

// (2026-11-02) Sucursales y guía de traslado interno en Bsale para el
// inventario. Mismos permisos que los traslados: lee quien ve el Inventario;
// prepara y emite un admin o quien tenga «inventario_traslados» en su perfil;
// el mantenedor de sucursales (crear/editar/importar) es solo admin.
@Controller('bsale/traslados')
@UseGuards(AuthGuard, InventarioGuard)
export class BsaleTrasladosController {
  constructor(private traslados: BsaleTrasladosService) {}

  // Sucursales de la cuenta de Bsale (para asociarlas en el mantenedor).
  @Get('oficinas')
  oficinas() {
    return this.traslados.oficinas();
  }

  // Trae las sucursales de Bsale al mantenedor (crea, enlaza y actualiza). Solo admin.
  @Post('oficinas/importar')
  @UseGuards(AdminGuard)
  importar() {
    return this.traslados.importarSucursales();
  }

  // Crea una sucursal acá y, con crear_en_bsale, también en Bsale. Solo admin.
  @Post('sucursales')
  @UseGuards(AdminGuard)
  crearSucursal(@Body() body: any) {
    return this.traslados.crearSucursal(body || {});
  }

  // Edita una sucursal acá y, con actualizar_bsale, también en Bsale. Solo admin.
  @Put('sucursales/:id')
  @UseGuards(AdminGuard)
  editarSucursal(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.traslados.editarSucursal(id, body || {});
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
