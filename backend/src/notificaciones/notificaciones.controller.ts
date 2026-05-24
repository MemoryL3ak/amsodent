import { Body, Controller, Get, Post, Param, ParseIntPipe, Req, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NotificacionesService } from './notificaciones.service';

@Controller('notificaciones')
@UseGuards(AuthGuard)
export class NotificacionesController {
  constructor(private notif: NotificacionesService) {}

  @Get()
  listar(@Req() req: any, @Query('soloNoLeidas') soloNoLeidas?: string) {
    const email = String(req.user?.email || '').toLowerCase();
    return this.notif.listar(email, soloNoLeidas === 'true', 50);
  }

  @Get('unread-count')
  contar(@Req() req: any) {
    const email = String(req.user?.email || '').toLowerCase();
    return this.notif.contarNoLeidas(email);
  }

  @Post(':id/leer')
  marcar(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const email = String(req.user?.email || '').toLowerCase();
    return this.notif.marcarLeida(id, email);
  }

  @Post('leer-todas')
  marcarTodas(@Req() req: any) {
    const email = String(req.user?.email || '').toLowerCase();
    return this.notif.marcarTodasLeidas(email);
  }

  @Post(':id/snooze')
  snooze(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { horas?: number },
  ) {
    const email = String(req.user?.email || '').toLowerCase();
    return this.notif.snooze(id, email, Number(body?.horas) || 2);
  }
}
