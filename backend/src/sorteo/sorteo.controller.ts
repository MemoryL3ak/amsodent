import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { SorteoService } from './sorteo.service';
import { SorteoAccessGuard } from '../auth/sorteo-access.guard';

function extractIp(req: any): string {
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    ''
  );
}

@Controller('sorteo')
export class SorteoController {
  constructor(private sorteoService: SorteoService) {}

  // ───────── PÚBLICO (sin guard): lo usa la landing /sorteo/:slug ─────────

  // Sorteo abierto más reciente (destino de /sorteo sin slug).
  @Get('publico/activo')
  publicoActivo() {
    return this.sorteoService.publicoActivo();
  }

  @Get('publico/:slug')
  publico(@Param('slug') slug: string) {
    return this.sorteoService.publico(slug);
  }

  @Post('registrar')
  registrar(@Body() body: any, @Req() req: any) {
    const ip = extractIp(req);
    const userAgent = String(req.headers?.['user-agent'] || '');
    return this.sorteoService.registrar(body, ip, userAgent);
  }

  // ───────── ADMIN: sorteos (campañas) ─────────

  @Get('sorteos')
  @UseGuards(SorteoAccessGuard)
  listarSorteos() {
    return this.sorteoService.listarSorteos();
  }

  @Post('sorteos')
  @UseGuards(SorteoAccessGuard)
  crearSorteo(@Body() body: any, @Req() req: any) {
    return this.sorteoService.crearSorteo(body, req.user?.id);
  }

  @Put('sorteos/:id')
  @UseGuards(SorteoAccessGuard)
  actualizarSorteo(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.sorteoService.actualizarSorteo(id, body);
  }

  @Delete('sorteos/:id')
  @UseGuards(SorteoAccessGuard)
  eliminarSorteo(@Param('id', ParseIntPipe) id: number) {
    return this.sorteoService.eliminarSorteo(id);
  }

  // ───────── ADMIN: participantes ─────────

  // Sin sorteo_id devuelve todos (lo usa "Importar de Sorteo" en Comunicaciones).
  @Get('participantes')
  @UseGuards(SorteoAccessGuard)
  listar(@Query('sorteo_id') sorteoId?: string) {
    const id = Number(sorteoId);
    return this.sorteoService.listarParticipantes(Number.isFinite(id) && id > 0 ? id : null);
  }

  @Post('sortear')
  @UseGuards(SorteoAccessGuard)
  sortear(@Body() body: any) {
    return this.sorteoService.sortearGanador(Number(body?.sorteo_id));
  }

  @Post('reset-ganadores')
  @UseGuards(SorteoAccessGuard)
  resetGanadores(@Body() body: any) {
    return this.sorteoService.resetGanadores(Number(body?.sorteo_id));
  }

  @Delete('participantes/:id')
  @UseGuards(SorteoAccessGuard)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.sorteoService.eliminarParticipante(id);
  }
}
