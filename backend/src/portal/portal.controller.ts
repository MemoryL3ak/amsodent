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

  @Get('cotizacion')
  @UseGuards(PortalGuard)
  getCotizacion(@Req() req: any) {
    return this.portalService.getCotizacion(Number(req.portal.licitacion_id));
  }

  @Get('documentos')
  @UseGuards(PortalGuard)
  getDocumentos(@Req() req: any) {
    return this.portalService.getDocumentos(Number(req.portal.licitacion_id));
  }

  @Get('documentos/signed-url')
  @UseGuards(PortalGuard)
  getSignedUrl(@Req() req: any, @Query('docId', ParseIntPipe) docId: number) {
    return this.portalService.getSignedUrlDoc(Number(req.portal.licitacion_id), docId);
  }

  @Post('documentos')
  @UseGuards(PortalGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { tipo?: string; numero?: string; descripcion?: string },
  ) {
    return this.portalService.uploadDocumento(
      Number(req.portal.licitacion_id),
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
