import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { MAX_BYTES, RepositorioService } from './repositorio.service';

// Ver y descargar: cualquier usuario con sesión (la descarga de fichas ofrece
// sumar documentos del repositorio al ZIP). Subir, editar y eliminar: SOLO
// administradores (2026-11-06, pedido de Ariel: «todos pueden ver el
// repositorio pero solo admin puede subir y editar»; antes también podía
// quien tuviera el módulo «repositorio» en su perfil).
const PuedeGestionar = AdminGuard;
const email = (req: any) => String(req?.user?.email || '').trim().toLowerCase() || null;

@Controller('repositorio')
@UseGuards(AuthGuard)
export class RepositorioController {
  constructor(private repositorio: RepositorioService) {}

  @Get()
  listar() {
    return this.repositorio.listar();
  }

  @Get(':id/url')
  url(@Param('id', ParseIntPipe) id: number) {
    return this.repositorio.url(id);
  }

  @Post()
  @UseGuards(PuedeGestionar)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  crear(@Body() body: any, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.repositorio.crear(body, file, email(req));
  }

  @Put(':id')
  @UseGuards(PuedeGestionar)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: any, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.repositorio.actualizar(id, body, file, email(req));
  }

  @Delete(':id')
  @UseGuards(PuedeGestionar)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.repositorio.eliminar(id);
  }
}
