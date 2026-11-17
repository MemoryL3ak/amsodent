import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CostosRecepcionService } from './costos-recepcion.service';
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
    private costos: CostosRecepcionService,
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

  /* (2026-11-17) Costos por confirmar: productos cuya última recepción de stock
     llegó con un costo mayor al que tienen. Solo para quien puede ver costos. */
  @Get('costos-recepcion')
  async costosRecepcion(@Req() req: any) {
    if (!(await this.verCostos(req))) return { listo: true, con_decision: true, mensaje: null, alertas: [], sin_permiso: true };
    return this.costos.pendientes();
  }

  // Decide una alerta: «definitiva» cambia el costo del producto; «momentanea» lo mantiene.
  @Post('costos-recepcion/resolver')
  async resolverCostoRecepcion(@Body() body: any, @Req() req: any) {
    if (!(await this.verCostos(req))) throw new ForbiddenException('Tu perfil no permite cambiar el costo (falta «Ver el costo de los productos»).');
    return this.costos.resolver(body, this.usuario(req));
  }
}
