import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ChoferesService } from './choferes.service';
import { ChoferPortalGuard } from './choferes.guard';
import { AdminGuard } from '../auth/admin.guard';

function ipDe(req: any): string | null {
  return (
    req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    req?.ip ||
    null
  );
}

// IMPORTANTE: las rutas literales se declaran ANTES de cualquier `:id` para que
// Nest no las confunda. El módulo es admin-only (AdminGuard) salvo el portal
// del chofer (ChoferPortalGuard) y los endpoints públicos de login/recuperación.
@Controller('choferes')
export class ChoferesController {
  constructor(private choferes: ChoferesService) {}

  // ── Portal del chofer (público / token propio) ───────────────────────
  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Req() req: any, @Body() body: { rut: string; password: string }) {
    return this.choferes.login({ ...body, ip: ipDe(req) });
  }

  @Post('recuperacion')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async recuperacion(@Req() req: any, @Body() body: any) {
    return this.choferes.solicitarRecuperacion({
      ...body,
      ip: ipDe(req),
      user_agent: req?.headers?.['user-agent'] || null,
    });
  }

  @UseGuards(ChoferPortalGuard)
  @Post('cambiar-clave')
  async cambiarClave(@Req() req: any, @Body() body: { password_nueva: string }) {
    return this.choferes.cambiarClave(req.choferPortal.chofer_id, body?.password_nueva);
  }

  @UseGuards(ChoferPortalGuard)
  @Get('mis-viajes')
  async misViajes(@Req() req: any, @Query('estado') estado?: string) {
    return this.choferes.misViajes(req.choferPortal.chofer_id, estado);
  }

  @UseGuards(ChoferPortalGuard)
  @Get('mis-viajes/:id')
  async miViaje(@Req() req: any, @Param('id') id: string) {
    return this.choferes.obtenerMiViaje(req.choferPortal.chofer_id, id);
  }

  @UseGuards(ChoferPortalGuard)
  @Put('mis-viajes/:id/estado')
  async cambiarEstadoMiViaje(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { estado: string; lat?: number; lng?: number; nota?: string },
  ) {
    return this.choferes.cambiarEstadoViaje(req.choferPortal.chofer_id, id, body);
  }

  @UseGuards(ChoferPortalGuard)
  @Post('mis-viajes/:id/foto')
  @UseInterceptors(FileInterceptor('file'))
  async subirFotoMiViaje(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.choferes.subirFotoViaje(
      req.choferPortal.chofer_id,
      id,
      file,
      `chofer:${req.choferPortal.chofer_id}`,
    );
  }

  @UseGuards(ChoferPortalGuard)
  @Post('posicion')
  async registrarPosicion(@Req() req: any, @Body() body: any) {
    return this.choferes.registrarPosicion(req.choferPortal.chofer_id, body);
  }

  @UseGuards(ChoferPortalGuard)
  @Post('presencia/detener')
  async detenerPresencia(@Req() req: any) {
    return this.choferes.detenerPresencia(req.choferPortal.chofer_id);
  }

  // ── Admin: guías internas + viajes + tracking ────────────────────────
  @UseGuards(AdminGuard)
  @Get('guias-disponibles')
  async guiasDisponibles() {
    return this.choferes.listarGuiasInternasDisponibles();
  }

  @UseGuards(AdminGuard)
  @Get('despachos/pendientes')
  async despachosPendientes() {
    return this.choferes.listarDespachosPendientes();
  }

  @UseGuards(AdminGuard)
  @Get('viajes')
  async listarViajes(@Query('chofer_id') choferId?: string, @Query('estado') estado?: string) {
    return this.choferes.listarViajes({ chofer_id: choferId, estado });
  }

  @UseGuards(AdminGuard)
  @Post('viajes')
  async crearViaje(@Req() req: any, @Body() body: any) {
    return this.choferes.crearViaje(body, req?.user?.email || null);
  }

  @UseGuards(AdminGuard)
  @Get('viajes/:id')
  async obtenerViaje(@Param('id') id: string) {
    return this.choferes.obtenerViaje(id);
  }

  @UseGuards(AdminGuard)
  @Get('viajes/:id/recorrido')
  async recorridoViaje(@Param('id') id: string) {
    return this.choferes.recorridoViaje(id);
  }

  @UseGuards(AdminGuard)
  @Put('viajes/:id/estado')
  async cambiarEstadoViaje(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { estado: string; nota?: string },
  ) {
    return this.choferes.cambiarEstadoViajeAdmin(
      id,
      body?.estado,
      body?.nota || '',
      req?.user?.email || null,
    );
  }

  @UseGuards(AdminGuard)
  @Put('viajes/:id')
  async actualizarViaje(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.choferes.actualizarViaje(id, body, req?.user?.email || null);
  }

  @UseGuards(AdminGuard)
  @Post('viajes/:id/cancelar')
  async cancelarViaje(@Req() req: any, @Param('id') id: string) {
    return this.choferes.cancelarViaje(id, req?.user?.email || null);
  }

  @UseGuards(AdminGuard)
  @Get('tracking/snapshot')
  async snapshot() {
    return this.choferes.snapshotMapa();
  }

  @UseGuards(AdminGuard)
  @Get('estadisticas')
  async estadisticas(
    @Query('dias') dias?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.choferes.estadisticasChoferes({ dias, desde, hasta });
  }

  // ── Admin: accesos y recuperaciones ──────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('accesos')
  async listarAccesos() {
    return this.choferes.listarChoferes();
  }

  @UseGuards(AdminGuard)
  @Post('accesos/habilitar')
  async habilitarAcceso(
    @Req() req: any,
    @Body() body: { chofer_id?: string; rut?: string; password: string; vigencia: string },
  ) {
    return this.choferes.habilitarAcceso({ ...body, adminEmail: req?.user?.email || null });
  }

  @UseGuards(AdminGuard)
  @Post('accesos/deshabilitar')
  async deshabilitarAcceso(@Body() body: { chofer_id?: string; rut?: string }) {
    return this.choferes.deshabilitarAcceso(body);
  }

  @UseGuards(AdminGuard)
  @Post('accesos/regenerar-clave')
  async regenerarClave(
    @Req() req: any,
    @Body()
    body: {
      chofer_id?: string;
      rut?: string;
      password: string;
      reenviar_correo?: boolean;
      recuperacion_id?: number;
    },
  ) {
    return this.choferes.regenerarClave({ ...body, adminEmail: req?.user?.email || null });
  }

  @UseGuards(AdminGuard)
  @Get('recuperaciones')
  async listarRecuperaciones(@Query('estado') estado?: string) {
    return this.choferes.listarRecuperaciones(estado);
  }

  @UseGuards(AdminGuard)
  @Put('recuperaciones/:id/resolver')
  async resolverRecuperacion(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.choferes.resolverRecuperacion(id, req?.user?.email || null);
  }

  // ── Admin: CRUD de choferes ──────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get()
  async listarChoferes() {
    return this.choferes.listarChoferes();
  }

  @UseGuards(AdminGuard)
  @Post()
  async crearChofer(@Body() body: any) {
    return this.choferes.crearChofer(body);
  }

  @UseGuards(AdminGuard)
  @Put(':id')
  async actualizarChofer(@Param('id') id: string, @Body() body: any) {
    return this.choferes.actualizarChofer(id, body);
  }

  @UseGuards(AdminGuard)
  @Post(':id/desactivar')
  async desactivarChofer(@Param('id') id: string) {
    return this.choferes.desactivarChofer(id);
  }
}
