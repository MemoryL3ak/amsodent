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

  // PÚBLICO (sin AuthGuard) — lo usa la landing /sorteo
  @Post('registrar')
  registrar(@Body() body: any, @Req() req: any) {
    const ip = extractIp(req);
    const userAgent = String(req.headers?.['user-agent'] || '');
    return this.sorteoService.registrar(body, ip, userAgent);
  }

  // ADMIN: listado de participantes
  @Get('participantes')
  @UseGuards(SorteoAccessGuard)
  listar() {
    return this.sorteoService.listarParticipantes();
  }

  // ADMIN: elegir un ganador aleatorio
  @Post('sortear')
  @UseGuards(SorteoAccessGuard)
  sortear() {
    return this.sorteoService.sortearGanador();
  }

  // ADMIN: limpiar flag ganador (para volver a sortear)
  @Post('reset-ganadores')
  @UseGuards(SorteoAccessGuard)
  resetGanadores() {
    return this.sorteoService.resetGanadores();
  }

  // ADMIN: eliminar un participante puntual
  @Delete('participantes/:id')
  @UseGuards(SorteoAccessGuard)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.sorteoService.eliminarParticipante(id);
  }
}
