import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StockClientesService } from './stock-clientes.service';
import { StockPortalGuard } from './stock-clientes.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('stock-clientes')
export class StockClientesController {
  constructor(private stockClientes: StockClientesService) {}

  // ============================================================
  // Público — acceso del cliente al portal
  // ============================================================

  // Verifica si el RUT existe en el portal y si ya aceptó el acuerdo.
  // El frontend usa esto para decidir el flujo: directo al portal o acuerdo
  // + razón social primero.
  @Post('verificar-rut')
  async verificarRut(@Body() body: { rut: string }) {
    return await this.stockClientes.verificarRut(body?.rut);
  }

  @Post('acceso')
  async acceso(
    @Req() req: any,
    @Body()
    body: {
      rut: string;
      razon_social?: string;
      email?: string;
      telefono?: string;
      acepto_acuerdo: boolean;
    },
  ) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    return await this.stockClientes.acceso({ ...body, ip });
  }

  // ============================================================
  // Cliente autenticado con StockPortalGuard
  // ============================================================
  @UseGuards(StockPortalGuard)
  @Get('mis-productos')
  async misProductos(@Req() req: any) {
    return await this.stockClientes.listarProductos(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Get('mis-declaraciones')
  async misDeclaraciones(@Req() req: any) {
    return await this.stockClientes.listarMisDeclaraciones(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Get('mis-solicitudes')
  async misSolicitudes(@Req() req: any) {
    return await this.stockClientes.listarMisSolicitudes(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Post('declaracion')
  async crearDeclaracion(@Req() req: any, @Body() body: any) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    const userAgent = req?.headers?.['user-agent'] || null;
    return await this.stockClientes.crearDeclaracion(req.stockPortal, body, {
      ip,
      user_agent: userAgent,
    });
  }

  @UseGuards(StockPortalGuard)
  @Post('solicitud-cotizacion')
  async crearSolicitudCotizacion(@Req() req: any, @Body() body: any) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    const userAgent = req?.headers?.['user-agent'] || null;
    return await this.stockClientes.crearSolicitudCotizacion(
      req.stockPortal,
      body,
      { ip, user_agent: userAgent },
    );
  }

  // Búsqueda en el catálogo Amsodent para agregar productos a una solicitud
  // de cotización (ayuda de autocompletado en el portal del cliente).
  @UseGuards(StockPortalGuard)
  @Get('catalogo')
  async buscarCatalogo(@Query('q') q: string, @Query('limit') limit?: string) {
    return await this.stockClientes.buscarCatalogo(
      q,
      limit ? Number(limit) : undefined,
    );
  }

  // ============================================================
  // Admin — dashboard, clientes y configuración de destinatarios
  // ============================================================
  @UseGuards(AuthGuard)
  @Get('declaraciones')
  async listarDeclaraciones(
    @Query('rut') rut?: string,
    @Query('razon_social') razonSocial?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('solo_alertas') soloAlertas?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.stockClientes.listarDeclaraciones({
      rut,
      razonSocial,
      desde,
      hasta,
      soloAlertas: soloAlertas === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @UseGuards(AuthGuard)
  @Get('clientes')
  async listarClientes() {
    return await this.stockClientes.listarClientesPortal();
  }

  @UseGuards(AuthGuard)
  @Get('clientes-con-declaraciones')
  async listarClientesConDeclaraciones() {
    return await this.stockClientes.listarClientesConDeclaraciones();
  }

  @UseGuards(AuthGuard)
  @Get('solicitudes-por-rut')
  async listarSolicitudesPorRut(@Query('rut') rut: string) {
    return await this.stockClientes.listarSolicitudesPorRut(rut);
  }

  @UseGuards(AuthGuard)
  @Put('solicitudes/:id/estado')
  async actualizarEstadoSolicitud(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado: string },
  ) {
    return await this.stockClientes.actualizarEstadoSolicitud(id, body?.estado);
  }

  // Datos de contacto del cliente (correo/teléfono) para comunicarse desde el
  // dashboard. Se resuelven contra el maestro de clientes.
  @UseGuards(AuthGuard)
  @Get('contacto')
  async obtenerContacto(@Query('rut') rut: string) {
    return await this.stockClientes.obtenerContactoCliente(rut);
  }

  // Envía un correo de redacción libre al cliente (comunicación admin → cliente).
  @UseGuards(AuthGuard)
  @Post('comunicar')
  async comunicar(
    @Req() req: any,
    @Body()
    body: {
      rut?: string;
      para?: string;
      cc?: string[];
      asunto: string;
      mensaje: string;
    },
  ) {
    return await this.stockClientes.enviarComunicacionCliente({
      ...body,
      userId: req?.user?.id,
    });
  }

  @UseGuards(AuthGuard)
  @Get('destinatarios')
  async listarDestinatarios() {
    return await this.stockClientes.listarDestinatarios();
  }

  @UseGuards(AdminGuard)
  @Post('destinatarios')
  async crearDestinatario(@Body() body: any) {
    return await this.stockClientes.upsertDestinatario(body);
  }

  @UseGuards(AdminGuard)
  @Put('destinatarios/:id')
  async actualizarDestinatario(
    @Param('id', ParseIntPipe) _id: number,
    @Body() body: any,
  ) {
    return await this.stockClientes.upsertDestinatario(body);
  }

  @UseGuards(AdminGuard)
  @Delete('destinatarios/:id')
  async eliminarDestinatario(@Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.eliminarDestinatario(id);
  }
}
