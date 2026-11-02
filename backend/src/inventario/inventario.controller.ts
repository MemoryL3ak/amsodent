import {
  Controller, Get, Post, Put,
  Body, Param, Query, ParseIntPipe, UseGuards, Req,
} from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { InventarioGuard } from './inventario.guard';
import { InventarioTrasladosGuard } from './inventario-traslados.guard';

// (2026-10-14) Antes todo el módulo era solo admin. Ahora LEE quien tenga el
// módulo `inventario` en sus permisos efectivos (ventas lo ve sin KPIs ni
// acciones); mover stock, el mínimo y la carga masiva siguen siendo solo admin.
// (2026-11-02) Sucursales: el mantenedor es solo admin; crear, recibir y
// anular traslados lo hace admin o quien tenga «inventario_traslados» en su
// perfil (InventarioTrasladosGuard, que lee lo que dejó InventarioGuard).
@Controller('inventario')
@UseGuards(AuthGuard, InventarioGuard)
export class InventarioController {
  constructor(private inventario: InventarioService) {}

  // (2026-10-22) Sin admin ni «ver_costos» el resumen viene sin `costo`
  // (InventarioGuard deja request.verCostos).
  @Get('resumen')
  resumen(@Req() req: any) {
    return this.inventario.resumen(req?.verCostos === true);
  }

  @Get('movimientos')
  movimientos(
    @Query('productoId') productoId?: string,
    @Query('limit') limit?: string,
    @Query('sucursalId') sucursalId?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.inventario.movimientos(
      productoId ? Number(productoId) : undefined,
      limit ? Number(limit) : undefined,
      { sucursalId: sucursalId ? Number(sucursalId) : undefined, tipo },
    );
  }

  @Post('movimientos')
  @UseGuards(AdminGuard)
  registrar(@Body() body: any, @Req() req: any) {
    return this.inventario.registrarMovimiento(body, (req?.user?.email || '').toLowerCase());
  }

  @Put('stock-minimo/:productoId')
  @UseGuards(AdminGuard)
  stockMinimo(@Param('productoId', ParseIntPipe) productoId: number, @Body() body: any) {
    return this.inventario.actualizarStockMinimo(productoId, body?.stockMinimo);
  }

  @Post('carga-masiva')
  @UseGuards(AdminGuard)
  cargaMasiva(@Body() body: { rows?: any[]; motivo?: string; sucursalId?: number }, @Req() req: any) {
    return this.inventario.cargaMasiva(
      body?.rows || [],
      (req?.user?.email || '').toLowerCase(),
      body?.motivo,
      body?.sucursalId ? Number(body.sucursalId) : undefined,
    );
  }

  /* ------------------------------------------------------------ sucursales */

  // `listo: false` = falta la migración 20261102: el front esconde sucursales
  // y traslados y el módulo sigue como antes (un solo stock).
  @Get('sucursales')
  async sucursales(@Req() req: any) {
    const listo = await this.inventario.sucursalesListo();
    const sucursales = listo ? await this.inventario.listarSucursales() : [];
    return {
      listo,
      sucursales,
      principal_id: sucursales.find((s) => s.es_principal)?.id ?? sucursales[0]?.id ?? null,
      puede_trasladar: req?.esAdmin === true || (Array.isArray(req?.permisos) && req.permisos.includes('inventario_traslados')),
    };
  }

  // Resumen por sucursal (stock, unidades, valorización) para el mantenedor.
  @Get('sucursales/resumen')
  resumenSucursales(@Req() req: any) {
    return this.inventario.resumenSucursales(req?.verCostos === true);
  }

  @Post('sucursales')
  @UseGuards(AdminGuard)
  crearSucursal(@Body() body: any) {
    return this.inventario.crearSucursal(body || {});
  }

  @Put('sucursales/:id')
  @UseGuards(AdminGuard)
  editarSucursal(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.inventario.editarSucursal(id, body || {});
  }

  /* ------------------------------------------------------------- traslados */

  @Get('traslados')
  traslados(@Query('estado') estado?: string, @Query('limit') limit?: string) {
    return this.inventario.traslados({ estado, limit: limit ? Number(limit) : undefined });
  }

  @Get('traslados/:id')
  traslado(@Param('id', ParseIntPipe) id: number) {
    return this.inventario.trasladoPorId(id);
  }

  @Post('traslados')
  @UseGuards(InventarioTrasladosGuard)
  crearTraslado(@Body() body: any, @Req() req: any) {
    return this.inventario.crearTraslado(body || {}, (req?.user?.email || '').toLowerCase());
  }

  @Post('traslados/:id/recibir')
  @UseGuards(InventarioTrasladosGuard)
  recibirTraslado(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.inventario.recibirTraslado(id, body || {}, (req?.user?.email || '').toLowerCase());
  }

  @Post('traslados/:id/anular')
  @UseGuards(InventarioTrasladosGuard)
  anularTraslado(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.inventario.anularTraslado(id, body || {}, (req?.user?.email || '').toLowerCase());
  }
}
