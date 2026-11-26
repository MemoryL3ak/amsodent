import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ModuloGuard } from '../auth/modulo.guard';
import { PostventaService } from './postventa.service';

/* (2026-11-26) Postventa, lado plataforma: entra el administrador o quien
   tenga «postventa» entre sus permisos (perfil o rol). Qué solicitudes ve
   cada uno lo decide el servicio (responsable, quien la registró, o todas con
   «Ver todas las cotizaciones»). Las rutas del portal del cliente van aparte,
   en postventa-portal.controller.ts, con el guard del portal. */
@Controller('postventa')
@UseGuards(AuthGuard, ModuloGuard('postventa', 'Postventa'))
export class PostventaController {
  constructor(private postventa: PostventaService) {}

  @Get('contexto')
  async contexto(@Req() req: any) {
    return this.postventa.contexto(await this.postventa.usuario(req));
  }

  @Get('clientes')
  clientes(@Query('q') q?: string) {
    return this.postventa.buscarClientes(q || '');
  }

  @Get('cotizaciones')
  cotizaciones(@Query('rut') rut?: string) {
    return this.postventa.cotizacionesDeCliente(rut || '');
  }

  @Get('cotizaciones/:id')
  cotizacion(@Param('id', ParseIntPipe) id: number) {
    return this.postventa.cotizacionParaSolicitud(id);
  }

  @Put('gestiones/:id/documento')
  async asociarDocumento(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.postventa.asociarDocumento(id, await this.postventa.usuario(req), body || {});
  }

  @Get()
  async listar(@Req() req: any) {
    return this.postventa.listar(await this.postventa.usuario(req));
  }

  @Post()
  async crear(@Body() body: any, @Req() req: any) {
    return this.postventa.crear(await this.postventa.usuario(req), body || {});
  }

  @Get(':id')
  async detalle(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.postventa.detalle(id, await this.postventa.usuario(req));
  }

  @Post(':id/tomar')
  async tomar(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.postventa.tomar(id, await this.postventa.usuario(req));
  }

  @Post(':id/comentario')
  async comentar(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.postventa.comentar(id, await this.postventa.usuario(req), body || {});
  }

  @Post(':id/accion')
  async accion(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.postventa.registrarAccion(id, await this.postventa.usuario(req), body || {});
  }

  @Post(':id/cerrar')
  async cerrar(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.postventa.cerrar(id, await this.postventa.usuario(req), body || {});
  }

  @Post(':id/reabrir')
  async reabrir(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.postventa.reabrir(id, await this.postventa.usuario(req));
  }

  @Put(':id/vendedor')
  async vendedor(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.postventa.cambiarVendedor(id, await this.postventa.usuario(req), body || {});
  }
}
