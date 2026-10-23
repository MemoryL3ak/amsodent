import {
  Controller, Get, Post, Put,
  Body, Param, Query, ParseIntPipe, UseGuards, Req,
} from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { InventarioGuard } from './inventario.guard';

// (2026-10-14) Antes todo el módulo era solo admin. Ahora LEE quien tenga el
// módulo `inventario` en sus permisos efectivos (ventas lo ve sin KPIs ni
// acciones); mover stock, el mínimo y la carga masiva siguen siendo solo admin.
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
  movimientos(@Query('productoId') productoId?: string, @Query('limit') limit?: string) {
    return this.inventario.movimientos(
      productoId ? Number(productoId) : undefined,
      limit ? Number(limit) : undefined,
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
  cargaMasiva(@Body() body: { rows?: any[]; motivo?: string }, @Req() req: any) {
    return this.inventario.cargaMasiva(body?.rows || [], (req?.user?.email || '').toLowerCase(), body?.motivo);
  }
}
