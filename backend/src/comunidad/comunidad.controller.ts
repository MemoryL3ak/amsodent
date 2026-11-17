import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ComunidadService } from './comunidad.service';
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
}
