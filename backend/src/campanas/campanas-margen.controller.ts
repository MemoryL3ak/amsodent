import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CampanasMargenService } from './campanas-margen.service';

// Leer las campañas lo necesita cualquiera que cotice (el precio se calcula al
// armar la cotización). Crearlas o cambiarlas mueve el precio de marcas
// enteras: solo admin.
@Controller('campanas-margen')
@UseGuards(AuthGuard)
export class CampanasMargenController {
  constructor(private campanas: CampanasMargenService) {}

  @Get()
  listar() {
    return this.campanas.listar();
  }

  @Get('vigentes')
  vigentes() {
    return this.campanas.vigentes();
  }

  @Post()
  @UseGuards(AdminGuard)
  crear(@Body() body: any, @Req() req: any) {
    return this.campanas.crear(body, String(req?.user?.email || '').toLowerCase() || null);
  }

  @Put(':id/activa')
  @UseGuards(AdminGuard)
  activar(@Param('id', ParseIntPipe) id: number, @Body() body: { activa?: boolean }) {
    return this.campanas.activar(id, body?.activa !== false);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.campanas.actualizar(id, body);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.campanas.eliminar(id);
  }
}
