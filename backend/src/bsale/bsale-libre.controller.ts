import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { BsaleLibreService } from './bsale-libre.service';

// Guías y facturas libres en Bsale (sin orden de compra de por medio), desde
// el módulo Facturación. Exige sesión; el rol lo decide el servicio.
@Controller('bsale/libre')
@UseGuards(AuthGuard)
export class BsaleLibreController {
  constructor(private libre: BsaleLibreService) {}

  // Listas para armar el documento: formas de pago, tipos de traslado, modo.
  @Get('opciones')
  opciones(@Req() req: any) {
    return this.libre.opciones(String(req?.user?.id || ''));
  }

  // Clientes del sistema que calzan con lo escrito (RUT o nombre).
  @Get('clientes')
  clientes(@Req() req: any, @Query('q') q: string) {
    return this.libre.buscarClientes(String(req?.user?.id || ''), String(q || ''));
  }

  // El cliente de un RUT como lo verá Bsale (existente o nuevo).
  @Get('cliente')
  cliente(@Req() req: any, @Query('rut') rut: string) {
    return this.libre.cliente(String(req?.user?.id || ''), String(rut || ''));
  }

  // Productos del catálogo que calzan (SKU o nombre), con sus listas.
  @Get('productos')
  productos(@Req() req: any, @Query('q') q: string) {
    return this.libre.buscarProductos(String(req?.user?.id || ''), String(q || ''));
  }

  // Cliente y líneas de una cotización, para armar su boleta, factura o guía.
  @Get('desde-cotizacion')
  desdeCotizacion(@Req() req: any, @Query('id') id: string) {
    return this.libre.desdeCotizacion(String(req?.user?.id || ''), id);
  }

  // Simula (simular: true) o emite el documento armado a mano.
  @Post('emitir')
  emitir(@Req() req: any, @Body() body: any) {
    return this.libre.emitir({ id: String(req?.user?.id || ''), email: String(req?.user?.email || '').trim().toLowerCase() }, body);
  }
}
