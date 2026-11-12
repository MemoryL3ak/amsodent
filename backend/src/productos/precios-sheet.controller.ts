import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuloGuard } from '../auth/modulo.guard';
import { PreciosSheetService } from './precios-sheet.service';
import { PreciosCambiosService } from './precios-cambios.service';

// (2026-11-12) Actualización de precios y envío al Google Sheet «Lista de
// Precios»: entra el admin o quien tenga «actualizar_precios» en su perfil.
// Simular no escribe nada; el costo solo lo ve y lo cambia quien además puede
// ver costos (admin o «ver_costos»).
@Controller('precios-sheet')
@UseGuards(AuthGuard, ModuloGuard('actualizar_precios', 'Actualización de precios'))
export class PreciosSheetController {
  constructor(
    private precios: PreciosSheetService,
    private preciosCambios: PreciosCambiosService,
  ) {}

  private verCostos(req: any) {
    return this.preciosCambios.puedeVerCostos(String(req?.user?.id || ''));
  }

  private usuario(req: any) {
    return String(req?.user?.email || '').trim().toLowerCase() || null;
  }

  @Get('estado')
  async estado(@Req() req: any, @Query('forzar') forzar?: string) {
    return { ...(await this.precios.estado(forzar === '1')), ver_costos: await this.verCostos(req) };
  }

  @Get('productos')
  async productos(@Req() req: any) {
    return this.precios.productosParaEditar(await this.verCostos(req));
  }

  @Get('cambios')
  async cambios(@Req() req: any, @Query('limite') limite?: string) {
    return this.precios.cambios(Number(limite) || 200, await this.verCostos(req));
  }

  @Get('envios')
  envios() {
    return this.precios.envios();
  }

  @Post('precios/simular')
  async simularPrecios(@Body() body: any, @Req() req: any) {
    return this.precios.simularPrecios(body?.cambios, await this.verCostos(req));
  }

  @Post('precios/guardar')
  async guardarPrecios(@Body() body: any, @Req() req: any) {
    return this.precios.guardarPrecios(body?.cambios, this.usuario(req), await this.verCostos(req));
  }

  @Post('nivelar/simular')
  async simularNivelacion(@Body() body: any, @Req() req: any) {
    return this.precios.nivelar({ campos: body?.campos, agregar: body?.agregar, simular: true, verCostos: await this.verCostos(req) });
  }

  @Post('nivelar')
  async nivelar(@Body() body: any, @Req() req: any) {
    return this.precios.nivelar({ campos: body?.campos, agregar: body?.agregar, simular: false, huella: String(body?.huella || ''), usuario: this.usuario(req), verCostos: await this.verCostos(req) });
  }

  @Post('reintentar')
  reintentar() {
    return this.precios.reintentar();
  }
}
