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
import { EventosService } from './eventos.service';
import { AuthGuard } from '../auth/auth.guard';

function extractIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
}

@Controller('eventos')
export class EventosController {
  constructor(private eventosService: EventosService) {}

  // PÚBLICO (sin AuthGuard) — lo usa el portal /evento
  @Post('registrar')
  registrar(@Body() body: any, @Req() req: any) {
    const ip = extractIp(req);
    const userAgent = String(req.headers?.['user-agent'] || '');
    return this.eventosService.registrar(body, ip, userAgent);
  }

  // ADMIN: listado de inscritos
  @Get('inscripciones')
  @UseGuards(AuthGuard)
  listar() {
    return this.eventosService.listar();
  }

  // ADMIN: eliminar una inscripción
  @Delete('inscripciones/:id')
  @UseGuards(AuthGuard)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.eventosService.eliminar(id);
  }

  // ADMIN: reenviar el correo de confirmación
  @Post('inscripciones/:id/reenviar')
  @UseGuards(AuthGuard)
  reenviar(@Param('id', ParseIntPipe) id: number) {
    return this.eventosService.reenviarConfirmacion(id);
  }

  // ADMIN: catálogo de eventos (Santiago / Viña del Mar) con sus rutas públicas
  @Get('catalogo')
  @UseGuards(AuthGuard)
  listarEventos() {
    return this.eventosService.listarEventos();
  }

  // ADMIN: invitaciones (agregar correos → se envía el correo de inscripción)
  @Get('invitaciones')
  @UseGuards(AuthGuard)
  listarInvitaciones() {
    return this.eventosService.listarInvitaciones();
  }

  @Post('invitaciones')
  @UseGuards(AuthGuard)
  agregarInvitaciones(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.eventosService.agregarInvitaciones(body || {}, email);
  }

  @Post('invitaciones/:id/reenviar')
  @UseGuards(AuthGuard)
  reenviarInvitacion(@Param('id', ParseIntPipe) id: number) {
    return this.eventosService.reenviarInvitacion(id);
  }

  @Delete('invitaciones/:id')
  @UseGuards(AuthGuard)
  eliminarInvitacion(@Param('id', ParseIntPipe) id: number) {
    return this.eventosService.eliminarInvitacion(id);
  }
}
