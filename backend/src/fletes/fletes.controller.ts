import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { FletesService } from './fletes.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

// La ADMINISTRACIÓN del tarifario (CRUD, carga masiva, reajuste, config del
// despacho interno) es solo para admin. La consulta para calcular fletes en
// cotizaciones (regiones/localidades/calcular/distancia) queda para todo el
// equipo autenticado.
@Controller('fletes')
@UseGuards(AuthGuard)
export class FletesController {
  constructor(private fletesService: FletesService) {}

  @Get('tarifas')
  @UseGuards(AdminGuard)
  listarTarifas(@Query('empresa') empresa?: string) {
    return this.fletesService.listarTarifas(String(empresa || 'Starken'));
  }

  @Post('tarifas')
  @UseGuards(AdminGuard)
  crearTarifa(@Body() body: any) {
    const { empresa, ...fila } = body || {};
    return this.fletesService.crearTarifa(String(empresa || ''), fila);
  }

  @Post('tarifas/bulk')
  @UseGuards(AdminGuard)
  reemplazarTarifas(@Body() body: any) {
    return this.fletesService.reemplazarTarifas(String(body?.empresa || ''), body?.rows || []);
  }

  @Put('tarifas/:id')
  @UseGuards(AdminGuard)
  actualizarTarifa(
    @Param('id') id: string,
    @Query('empresa') empresa: string,
    @Body() body: any,
  ) {
    return this.fletesService.actualizarTarifa(String(empresa || ''), Number(id), body || {});
  }

  @Delete('tarifas/:id')
  @UseGuards(AdminGuard)
  eliminarTarifa(@Param('id') id: string, @Query('empresa') empresa: string) {
    return this.fletesService.eliminarTarifa(String(empresa || ''), Number(id));
  }

  @Get('tarifas/regiones')
  tarifasRegiones(@Query('empresa') empresa?: string) {
    return this.fletesService.tarifasRegiones(String(empresa || 'Starken'));
  }

  @Get('tarifas/localidades')
  tarifasLocalidades(@Query('region') region?: string) {
    return this.fletesService.tarifasLocalidades(String(region || ''));
  }

  @Post('tarifas/calcular')
  calcularFlete(@Body() body: any) {
    return this.fletesService.calcularFlete(body || {});
  }

  // Reajuste porcentual por courier (se aplica sobre el tarifario al calcular).
  @Get('reajuste')
  @UseGuards(AdminGuard)
  obtenerReajuste(@Query('empresa') empresa?: string) {
    return this.fletesService.obtenerReajuste(String(empresa || ''));
  }

  @Put('reajuste')
  @UseGuards(AdminGuard)
  guardarReajuste(@Body() body: any) {
    return this.fletesService.guardarReajuste(String(body?.empresa || ''), body?.porcentaje);
  }

  // Despacho interno: configuración (origen, $/km extra) y distancia en km.
  @Get('interno/config')
  @UseGuards(AdminGuard)
  internoConfig() {
    return this.fletesService.internoConfig();
  }

  @Put('interno/config')
  @UseGuards(AdminGuard)
  guardarInternoConfig(@Body() body: any) {
    return this.fletesService.guardarInternoConfig(body || {});
  }

  @Post('interno/distancia')
  distanciaInterno(@Body() body: any) {
    return this.fletesService.distanciaInterno(body || {});
  }

  @Get('interno/direcciones')
  sugerirDirecciones(@Query('q') q?: string) {
    return this.fletesService.sugerirDirecciones(String(q || ''));
  }

  @Get('cobros')
  listarCobros(@Query('empresa') empresa?: string) {
    return this.fletesService.listarCobros(empresa);
  }

  @Post('cobros/bulk')
  bulkUpsert(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.fletesService.bulkUpsert(body, email);
  }

  @Delete('cobros')
  eliminarCobros(@Query('empresa') empresa?: string) {
    return this.fletesService.eliminarCobros(empresa);
  }

  @Get('cierres')
  listarCierres() {
    return this.fletesService.listarCierres();
  }

  @Post('cierres')
  cerrarCosteo(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.fletesService.cerrarCosteo(body, email);
  }

  @Delete('cierres/:licitacionId')
  reabrirCosteo(@Param('licitacionId') licitacionId: string) {
    return this.fletesService.reabrirCosteo(Number(licitacionId));
  }
}
