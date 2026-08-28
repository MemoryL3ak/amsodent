import {
  Controller, Get, Post, Put,
  Body, Param, Query, ParseIntPipe, UseGuards, Req,
} from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

// TODO el módulo es solo admin (pedido 2026-08-28): también la lectura, no
// solo la escritura — el inventario expone costos y valorización. La ruta y
// el menú del frontend ya lo restringen; este guard cierra la API.
@Controller('inventario')
@UseGuards(AuthGuard, AdminGuard)
export class InventarioController {
  constructor(private inventario: InventarioService) {}

  @Get('resumen')
  resumen() {
    return this.inventario.resumen();
  }

  @Get('movimientos')
  movimientos(@Query('productoId') productoId?: string, @Query('limit') limit?: string) {
    return this.inventario.movimientos(
      productoId ? Number(productoId) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('movimientos')
  registrar(@Body() body: any, @Req() req: any) {
    return this.inventario.registrarMovimiento(body, (req?.user?.email || '').toLowerCase());
  }

  @Put('stock-minimo/:productoId')
  stockMinimo(@Param('productoId', ParseIntPipe) productoId: number, @Body() body: any) {
    return this.inventario.actualizarStockMinimo(productoId, body?.stockMinimo);
  }

  @Post('carga-masiva')
  cargaMasiva(@Body() body: { rows?: any[]; motivo?: string }, @Req() req: any) {
    return this.inventario.cargaMasiva(body?.rows || [], (req?.user?.email || '').toLowerCase(), body?.motivo);
  }
}
