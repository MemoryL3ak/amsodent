import {
  Controller, Get, Post, Delete,
  Body, Query, UseGuards,
} from '@nestjs/common';
import { MetasService } from './metas.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('metas')
@UseGuards(AuthGuard)
export class MetasController {
  constructor(private metasService: MetasService) {}

  // Metas mensuales
  @Get('mensuales')
  getMetasMensuales(@Query('periodo') periodo: string) {
    return this.metasService.getMetasMensuales(periodo);
  }

  @Post('mensuales')
  upsertMetasMensuales(@Body() body: { rows: any[] }) {
    return this.metasService.upsertMetasMensuales(body.rows);
  }

  @Delete('mensuales')
  deleteMetasMensuales(@Query('periodo') periodo: string) {
    return this.metasService.deleteMetasMensuales(periodo);
  }

  // Metas canal
  @Get('canal')
  getMetasCanal(@Query('periodo') periodo: string) {
    return this.metasService.getMetasCanal(periodo);
  }

  @Post('canal')
  upsertMetasCanal(@Body() body: { rows: any[] }) {
    return this.metasService.upsertMetasCanal(body.rows);
  }

  @Delete('canal')
  deleteMetasCanal(@Query('periodo') periodo: string) {
    return this.metasService.deleteMetasCanal(periodo);
  }

  // Metas canal partes
  @Get('canal-partes')
  getMetasCanalPartes(@Query('periodo') periodo: string) {
    return this.metasService.getMetasCanalPartes(periodo);
  }

  @Post('canal-partes')
  upsertMetasCanalPartes(@Body() body: { rows: any[] }) {
    return this.metasService.upsertMetasCanalPartes(body.rows);
  }

  @Delete('canal-partes')
  deleteMetasCanalPartes(@Query('periodo') periodo: string) {
    return this.metasService.deleteMetasCanalPartes(periodo);
  }
}
