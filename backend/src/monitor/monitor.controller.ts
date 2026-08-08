import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { MonitorService } from './monitor.service';

@Controller('monitor')
export class MonitorController {
  constructor(private monitor: MonitorService) {}

  // Consulta del panel (solo admin). El "en vivo" llega por Realtime directo
  // desde Supabase; esto es la carga inicial y los filtros.
  @Get('logs')
  @UseGuards(AdminGuard)
  listar(
    @Query('nivel') nivel?: string,
    @Query('origen') origen?: string,
    @Query('tipo') tipo?: string,
    @Query('buscar') buscar?: string,
    @Query('limite') limite?: string,
  ) {
    return this.monitor.listar({ nivel, origen, tipo, buscar, limite: Number(limite) });
  }

  @Get('stats')
  @UseGuards(AdminGuard)
  stats() {
    return this.monitor.stats();
  }

  @Get('trafico')
  @UseGuards(AdminGuard)
  trafico(@Query('horas') horas?: string) {
    return this.monitor.trafico(Number(horas) || 24);
  }

  // Semáforo de dependencias (Supabase, SMTP, Mercado Público) + versión.
  @Get('salud')
  @UseGuards(AdminGuard)
  salud() {
    return this.monitor.estadoSalud();
  }

  // Errores agrupados por huella (vista "Problemas").
  @Get('issues')
  @UseGuards(AdminGuard)
  issues(@Query('estado') estado?: string) {
    return this.monitor.listarIssues(estado);
  }

  @Post('issues/:id/estado')
  @UseGuards(AdminGuard)
  cambiarEstado(@Param('id') id: string, @Body() body: { estado?: string }) {
    return this.monitor.cambiarEstadoIssue(Number(id), String(body?.estado || ''));
  }

  // Errores JS capturados en el navegador / app móvil. Requiere sesión para
  // que nadie externo pueda inundar la tabla.
  @Post('frontend')
  @UseGuards(AuthGuard)
  frontend(
    @Req() req: any,
    @Body()
    body: {
      mensaje?: string;
      stack?: string;
      ruta?: string;
      origen?: string;
      metadata?: Record<string, any>;
    },
  ) {
    this.monitor.registrar({
      nivel: 'error',
      origen: body?.origen === 'movil' ? 'movil' : 'frontend',
      tipo: 'frontend',
      ruta: String(body?.ruta || ''),
      mensaje: String(body?.mensaje || 'Error sin mensaje'),
      stack: body?.stack ? String(body.stack) : undefined,
      usuario_id: req.user?.id,
      usuario_email: req.user?.email,
      ip: req.ip,
      user_agent: req.headers?.['user-agent'],
      metadata: body?.metadata,
    });
    return { ok: true };
  }
}
