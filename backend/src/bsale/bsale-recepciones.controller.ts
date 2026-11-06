import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuloGuard } from '../auth/modulo.guard';
import { BsaleRecepcionesService } from './bsale-recepciones.service';

// (2026-11-06) Recepción de stock (la de Bsale): entra el admin o quien tenga
// «recepcion_stock» en su perfil. Simular no escribe; registrar crea la
// recepción en Bsale y suma el stock al inventario.
@Controller('recepciones-stock')
@UseGuards(AuthGuard, ModuloGuard('recepcion_stock', 'Recepción de stock'))
export class BsaleRecepcionesController {
  constructor(private recepciones: BsaleRecepcionesService) {}

  @Get('contexto')
  contexto() {
    return this.recepciones.contexto();
  }

  @Get('productos')
  productos(@Query('q') q?: string) {
    return this.recepciones.buscarProductos(q || '');
  }

  @Get()
  listar(@Query('limite') limite?: string) {
    return this.recepciones.listar(Number(limite) || 300);
  }

  @Get(':id')
  una(@Param('id', ParseIntPipe) id: number) {
    return this.recepciones.porId(id);
  }

  @Post('simular')
  simular(@Body() body: any) {
    return this.recepciones.simular(body || {});
  }

  @Post()
  registrar(@Body() body: any, @Req() req: any) {
    return this.recepciones.registrar(body || {}, String(req?.user?.email || '').trim().toLowerCase());
  }
}
