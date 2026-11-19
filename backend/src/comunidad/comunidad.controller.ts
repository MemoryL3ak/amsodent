import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Query,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ComunidadService } from './comunidad.service';
import { ComunidadMailingService } from './comunidad-mailing.service';
import { RastreoService } from './rastreo.service';
import { AuthGuard } from '../auth/auth.guard';
import { ModuloGuard } from '../auth/modulo.guard';

function extractIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
}

/* (2026-11-17) Las rutas de administración exigen el módulo «Comunidad» (el
   administrador lo tiene siempre). Antes bastaba con estar autenticado y solo
   el menú las escondía; ahora la lista trae además a las personas de sorteos
   y eventos y las clínicas rastreadas. */
const Comunidad = ModuloGuard('comunidad', 'Comunidad Amsodent');
const correoDe = (req: any) => String(req?.user?.email || '').trim().toLowerCase() || null;

@Controller('comunidad')
export class ComunidadController {
  constructor(
    private comunidad: ComunidadService,
    private rastreo: RastreoService,
    private mailing: ComunidadMailingService,
  ) {}

  // PÚBLICO (sin AuthGuard) — lo usa el portal /comunidad (destino del QR)
  @Post('registrar')
  registrar(@Body() body: any, @Req() req: any) {
    const ip = extractIp(req);
    const userAgent = String(req.headers?.['user-agent'] || '');
    return this.comunidad.registrar(body, ip, userAgent);
  }

  // ADMIN: URL pública del portal (para el QR del submódulo)
  @Get('portal')
  @UseGuards(AuthGuard, Comunidad)
  portal() {
    return this.comunidad.portalInfo();
  }

  // ADMIN: la comunidad completa (formulario del QR + sorteos + eventos + clínicas rastreadas), con su categoría
  @Get('registros')
  @UseGuards(AuthGuard, Comunidad)
  listar() {
    return this.comunidad.listar();
  }

  // ADMIN: guardar la categoría de una o más filas ({ refs, categoria })
  @Put('registros/categoria')
  @UseGuards(AuthGuard, Comunidad)
  categorizar(@Req() req: any, @Body() body: { refs?: string[]; categoria?: string }) {
    return this.comunidad.categorizar(body, correoDe(req));
  }

  // ADMIN: eliminar un registro
  @Delete('registros/:id')
  @UseGuards(AuthGuard, Comunidad)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.comunidad.eliminar(id);
  }

  // ADMIN: reenviar el correo de bienvenida
  @Post('registros/:id/reenviar')
  @UseGuards(AuthGuard, Comunidad)
  reenviar(@Param('id', ParseIntPipe) id: number) {
    return this.comunidad.reenviarBienvenida(id);
  }

  /* ── Rastreo de clínicas dentales en Google Maps (2026-11-17) ──
     Buscar y leer contactos no guardan nada; guardar es el paso real. */
  @Get('rastreo/estado')
  @UseGuards(AuthGuard, Comunidad)
  rastreoEstado() {
    return this.rastreo.estado();
  }

  @Post('rastreo/buscar')
  @UseGuards(AuthGuard, Comunidad)
  rastreoBuscar(@Body() body: { region?: string; comuna?: string }) {
    return this.rastreo.buscar(body);
  }

  @Post('rastreo/contactos')
  @UseGuards(AuthGuard, Comunidad)
  rastreoContactos(@Body() body: { sitios?: { place_id?: string; url?: string }[] }) {
    return this.rastreo.contactos(body);
  }

  @Post('rastreo/guardar')
  @UseGuards(AuthGuard, Comunidad)
  rastreoGuardar(@Req() req: any, @Body() body: any) {
    return this.rastreo.guardar(body, correoDe(req));
  }

  /* ── Mailing a la comunidad (2026-11-19) ──
     Simular no envía ni registra nada; la prueba va solo a quien redacta;
     enviar despacha en segundo plano y el avance se consulta en `envios`.
     Los tres aceptan una imagen opcional (campo `imagen`). */
  @Post('mailing/simular')
  @UseGuards(AuthGuard, Comunidad)
  @UseInterceptors(FileInterceptor('imagen'))
  mailingSimular(@Body() body: any, @UploadedFile() imagen?: Express.Multer.File) {
    return this.mailing.simular(body, imagen);
  }

  @Post('mailing/prueba')
  @UseGuards(AuthGuard, Comunidad)
  @UseInterceptors(FileInterceptor('imagen'))
  mailingPrueba(@Req() req: any, @Body() body: any, @UploadedFile() imagen?: Express.Multer.File) {
    return this.mailing.prueba(body, imagen, correoDe(req));
  }

  @Post('mailing/enviar')
  @UseGuards(AuthGuard, Comunidad)
  @UseInterceptors(FileInterceptor('imagen'))
  mailingEnviar(@Req() req: any, @Body() body: any, @UploadedFile() imagen?: Express.Multer.File) {
    return this.mailing.enviar(body, imagen, correoDe(req));
  }

  @Get('mailing/envios')
  @UseGuards(AuthGuard, Comunidad)
  mailingEnvios() {
    return this.mailing.envios();
  }

  @Get('mailing/envios/:id')
  @UseGuards(AuthGuard, Comunidad)
  mailingEnvio(@Param('id', ParseIntPipe) id: number) {
    return this.mailing.envio(id);
  }

  @Get('mailing/bajas')
  @UseGuards(AuthGuard, Comunidad)
  mailingBajas() {
    return this.mailing.bajas();
  }

  @Post('mailing/bajas')
  @UseGuards(AuthGuard, Comunidad)
  mailingDarDeBaja(@Req() req: any, @Body() body: { correo?: string }) {
    return this.mailing.darDeBaja(String(body?.correo || ''), correoDe(req));
  }

  @Post('mailing/bajas/reactivar')
  @UseGuards(AuthGuard, Comunidad)
  mailingReactivar(@Body() body: { correo?: string }) {
    return this.mailing.reactivar(String(body?.correo || ''));
  }

  // PÚBLICO — el enlace «date de baja» de los correos. El correo viaja firmado:
  // consultar solo lo muestra (enmascarado); la baja exige el botón (POST), así
  // los filtros de correo que abren los enlaces no dan de baja a nadie.
  @Get('baja')
  bajaConsultar(@Query('c') c?: string, @Query('f') f?: string) {
    return this.mailing.consultarBaja(c, f);
  }

  @Post('baja')
  bajaConfirmar(@Body() body: { c?: string; f?: string }) {
    return this.mailing.confirmarBaja(body?.c, body?.f);
  }
}
