import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StockPortalGuard } from '../stock-clientes/stock-clientes.guard';
import { PortalModulosService } from '../stock-clientes/portal-modulos.service';
import { PostventaService } from './postventa.service';

/* (2026-11-26) Postventa en el portal del cliente (/portal-cliente): el
   cliente envía una solicitud y sigue su estado. Todas las rutas van con el
   guard del portal (token propio) y con el módulo «postventa» de la cuenta
   (Módulos del portal por cliente; encendido por defecto). El RUT sale del
   token, nunca del cuerpo. La ven el administrador y el asistente de la cuenta. */
@Controller('postventa-portal')
@UseGuards(StockPortalGuard)
export class PostventaPortalController {
  constructor(
    private postventa: PostventaService,
    private modulos: PortalModulosService,
  ) {}

  @Get('mis-solicitudes')
  async misSolicitudes(@Req() req: any) {
    await this.modulos.exigir(req.stockPortal.rut, 'postventa');
    return this.postventa.portalListar(req.stockPortal.rut);
  }

  @Get('opciones')
  async opciones(@Req() req: any) {
    await this.modulos.exigir(req.stockPortal.rut, 'postventa');
    return this.postventa.portalOpciones(req.stockPortal.rut);
  }

  @Get('cotizaciones/:id/productos')
  async productos(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    await this.modulos.exigir(req.stockPortal.rut, 'postventa');
    return this.postventa.portalProductos(req.stockPortal.rut, id);
  }

  // Además del tope por usuario del servicio (10 en 24 horas), un freno por IP.
  @Post('solicitudes')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async crear(@Req() req: any, @Body() body: any) {
    await this.modulos.exigir(req.stockPortal.rut, 'postventa');
    return this.postventa.portalCrear(req.stockPortal, body || {});
  }
}
