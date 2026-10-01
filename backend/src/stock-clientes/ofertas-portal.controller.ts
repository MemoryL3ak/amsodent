import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OfertasPortalService } from './ofertas-portal.service';

// Lado plataforma de las ofertas del portal. Verlas, cualquiera con sesión
// (la bandeja de pedidos las nombra); crearlas o cambiarlas baja el precio de
// productos, categorías o marcas enteras para los clientes: solo admin.
// La vitrina que ve el cliente va por /stock-clientes/ofertas, con la sesión
// del portal.
@Controller('ofertas-portal')
@UseGuards(AuthGuard)
export class OfertasPortalController {
  constructor(private ofertas: OfertasPortalService) {}

  @Get()
  listar() {
    return this.ofertas.listar();
  }

  @Post('simular')
  @UseGuards(AdminGuard)
  simular(@Body() body: any) {
    return this.ofertas.simular(body);
  }

  @Post()
  @UseGuards(AdminGuard)
  crear(@Body() body: any, @Req() req: any) {
    return this.ofertas.crear(body, String(req?.user?.email || '').toLowerCase() || null);
  }

  @Put(':id/activa')
  @UseGuards(AdminGuard)
  activar(@Param('id', ParseIntPipe) id: number, @Body() body: { activa?: boolean }) {
    return this.ofertas.activar(id, body?.activa !== false);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.ofertas.actualizar(id, body);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.ofertas.eliminar(id);
  }
}
