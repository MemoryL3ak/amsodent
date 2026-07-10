import {
  Controller, Post, Get, Body, Req, Query, UseGuards, UseInterceptors, UploadedFile, ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PortalService } from './portal.service';
import { PortalGuard } from './portal.guard';

@Controller('portal')
export class PortalController {
  constructor(private portalService: PortalService) {}

  // Público — login del cliente
  @Post('login')
  login(@Body() body: { rut: string; id_licitacion: string }) {
    return this.portalService.login(body?.rut, body?.id_licitacion);
  }

  // ── Endpoints autenticados con PortalGuard ───────────────────────────────

  // Historial de todas las cotizaciones del cliente (mismo RUT del token).
  @Get('cotizaciones')
  @UseGuards(PortalGuard)
  getHistorial(@Req() req: any) {
    return this.portalService.getHistorialCotizaciones(String(req.portal.rut || ''));
  }

  @Get('cotizacion')
  @UseGuards(PortalGuard)
  getCotizacion(@Req() req: any, @Query('id') id?: string) {
    // Si se pide una cotización específica del historial, se valida por RUT;
    // si no, se usa la del token (la del login).
    const licId = id ? Number(id) : Number(req.portal.licitacion_id);
    return this.portalService.getCotizacion(licId, String(req.portal.rut || ''));
  }

  @Get('documentos')
  @UseGuards(PortalGuard)
  getDocumentos(@Req() req: any, @Query('id') id?: string) {
    const licId = id ? Number(id) : Number(req.portal.licitacion_id);
    return this.portalService.getDocumentos(licId, String(req.portal.rut || ''));
  }

  @Get('documentos/signed-url')
  @UseGuards(PortalGuard)
  getSignedUrl(@Req() req: any, @Query('docId', ParseIntPipe) docId: number) {
    return this.portalService.getSignedUrlDoc(String(req.portal.rut || ''), docId);
  }

  @Post('documentos')
  @UseGuards(PortalGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { tipo?: string; numero?: string; descripcion?: string; licitacion_id?: string },
  ) {
    // Permite subir a la cotización que el cliente está viendo (validada por RUT
    // en el service); por defecto, la del token.
    const licId = body?.licitacion_id ? Number(body.licitacion_id) : Number(req.portal.licitacion_id);
    return this.portalService.uploadDocumento(
      licId,
      file,
      {
        tipo: body?.tipo,
        numero: body?.numero,
        descripcion: body?.descripcion,
      },
      String(req.portal.rut || ''),
    );
  }
}
