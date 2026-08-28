import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ComunidadService } from './comunidad.service';
import { AuthGuard } from '../auth/auth.guard';

function extractIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
}

@Controller('comunidad')
export class ComunidadController {
  constructor(private comunidad: ComunidadService) {}

  // PÚBLICO (sin AuthGuard) — lo usa el portal /comunidad (destino del QR)
  @Post('registrar')
  registrar(@Body() body: any, @Req() req: any) {
    const ip = extractIp(req);
    const userAgent = String(req.headers?.['user-agent'] || '');
    return this.comunidad.registrar(body, ip, userAgent);
  }

  // ADMIN: URL pública del portal (para el QR del submódulo)
  @Get('portal')
  @UseGuards(AuthGuard)
  portal() {
    return this.comunidad.portalInfo();
  }

  // ADMIN: listado de registros
  @Get('registros')
  @UseGuards(AuthGuard)
  listar() {
    return this.comunidad.listar();
  }

  // ADMIN: eliminar un registro
  @Delete('registros/:id')
  @UseGuards(AuthGuard)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.comunidad.eliminar(id);
  }

  // ADMIN: reenviar el correo de bienvenida
  @Post('registros/:id/reenviar')
  @UseGuards(AuthGuard)
  reenviar(@Param('id', ParseIntPipe) id: number) {
    return this.comunidad.reenviarBienvenida(id);
  }
}
