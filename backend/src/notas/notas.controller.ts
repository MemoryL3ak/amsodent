import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NotasService } from './notas.service';

/* (2026-11-27) Notas adhesivas del panel lateral derecho. Son personales:
   basta con estar conectado (equipo interno) y cada quien solo llega a las
   suyas — el servicio filtra siempre por el id del usuario del token. */
@Controller('notas')
@UseGuards(AuthGuard)
export class NotasController {
  constructor(private notas: NotasService) {}

  @Get()
  listar(@Req() req: any) {
    return this.notas.listar(this.notas.idUsuario(req));
  }

  @Post()
  crear(@Body() body: any, @Req() req: any) {
    return this.notas.crear(this.notas.idUsuario(req), body);
  }

  @Post('orden')
  ordenar(@Body() body: any, @Req() req: any) {
    return this.notas.ordenar(this.notas.idUsuario(req), body?.ids);
  }

  @Put(':id')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.notas.actualizar(this.notas.idUsuario(req), id, body);
  }

  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.notas.eliminar(this.notas.idUsuario(req), id);
  }
}
