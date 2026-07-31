import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { FletesService } from './fletes.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('fletes')
@UseGuards(AuthGuard)
export class FletesController {
  constructor(private fletesService: FletesService) {}

  @Get('cobros')
  listarCobros(@Query('empresa') empresa?: string) {
    return this.fletesService.listarCobros(empresa);
  }

  @Post('cobros/bulk')
  bulkUpsert(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.fletesService.bulkUpsert(body, email);
  }

  @Delete('cobros')
  eliminarCobros(@Query('empresa') empresa?: string) {
    return this.fletesService.eliminarCobros(empresa);
  }

  @Get('cierres')
  listarCierres() {
    return this.fletesService.listarCierres();
  }

  @Post('cierres')
  cerrarCosteo(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.fletesService.cerrarCosteo(body, email);
  }

  @Delete('cierres/:licitacionId')
  reabrirCosteo(@Param('licitacionId') licitacionId: string) {
    return this.fletesService.reabrirCosteo(Number(licitacionId));
  }
}
