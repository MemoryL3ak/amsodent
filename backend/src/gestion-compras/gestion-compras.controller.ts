import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { GestionComprasGuard } from './gestion-compras.guard';
import { GestionComprasService } from './gestion-compras.service';
import { GestionComprasExtrasService, MAX_BYTES_RESPALDO } from './gestion-compras-extras.service';

const email = (req: any) => String(req?.user?.email || '').trim().toLowerCase();

// Gestión de compras (2026-10-16): cotizaciones adjudicadas vs. stock y lo que falta comprar.
@Controller('gestion-compras')
@UseGuards(AuthGuard, GestionComprasGuard)
export class GestionComprasController {
  constructor(
    private gestion: GestionComprasService,
    private extras: GestionComprasExtrasService,
  ) {}

  @Get()
  resumen(@Query('desde') desde?: string) {
    return this.gestion.resumen(desde);
  }

  /* (2026-11-06) Proveedores por producto: deja exactamente los elegidos. */
  @Put('proveedores')
  asignar(@Body() body: any, @Req() req: any) {
    return this.extras.asignar(body, email(req));
  }

  // Alta rápida de un proveedor sin salir de Gestión de compras.
  @Post('proveedores')
  crearProveedor(@Body() body: any, @Req() req: any) {
    return this.extras.crearProveedor(body, email(req));
  }

  /* (2026-11-06) Quiebres de stock: declarar (con respaldo opcional), bajar el respaldo y quitar. */
  @Post('quiebres')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES_RESPALDO } }))
  declararQuiebre(@Body() body: any, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    return this.gestion.declararQuiebre(body, file, email(req));
  }

  @Get('quiebres/:id/respaldo')
  respaldo(@Param('id', ParseIntPipe) id: number) {
    return this.extras.urlRespaldo(id);
  }

  @Post('quiebres/:id/quitar')
  async quitar(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return { quitados: await this.extras.resolver([id], 'manual', email(req)) };
  }
}
