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

  // Login del cliente con RUT + contraseña.
  @Post('login')
  async login(
    @Req() req: any,
    @Body() body: { rut: string; password: string },
  ) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    return await this.stockClientes.login({ ...body, ip });
  }

  // Solicitud de recuperación de clave (el cliente no está autenticado).
  @Post('recuperacion')
  async solicitarRecuperacion(@Req() req: any, @Body() body: any) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    const userAgent = req?.headers?.['user-agent'] || null;
    return await this.stockClientes.solicitarRecuperacion({
      ...body,
      ip,
      user_agent: userAgent,
    });
  }

  // Cambio de clave del cliente autenticado (incluye el cambio obligatorio
  // del primer ingreso).
  @UseGuards(StockPortalGuard)
  @Post('cambiar-clave')
  async cambiarClave(
    @Req() req: any,
    @Body() body: { password_nueva: string },
  ) {
    return await this.stockClientes.cambiarClave(
      req.stockPortal.rut,
      body?.password_nueva,
    );
  }

  // Aceptación del acuerdo de confidencialidad (cliente autenticado).
  @UseGuards(StockPortalGuard)
  @Post('aceptar-acuerdo')
  async aceptarAcuerdo(@Req() req: any) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    return await this.stockClientes.aceptarAcuerdo(req.stockPortal.rut, ip);
  }

  // ============================================================
  // Cliente autenticado con StockPortalGuard
  // ============================================================
  @UseGuards(StockPortalGuard)
  @Get('mis-productos')
  async misProductos(@Req() req: any, @Query('sucursal_id') sucursalId?: string) {
    return await this.stockClientes.listarProductos(
      req.stockPortal.rut,
      sucursalId ? Number(sucursalId) : null,
    );
  }

  @UseGuards(StockPortalGuard)
  @Get('mis-declaraciones')
  async misDeclaraciones(@Req() req: any, @Query('sucursal_id') sucursalId?: string) {
    return await this.stockClientes.listarMisDeclaraciones(
      req.stockPortal.rut,
      sucursalId ? Number(sucursalId) : null,
    );
  }

  // Sucursales del cliente (catálogos por dirección).
  @UseGuards(StockPortalGuard)
  @Get('mis-sucursales')
  async misSucursales(@Req() req: any) {
    return await this.stockClientes.listarSucursales(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Post('sucursales')
  async crearSucursal(@Req() req: any, @Body() body: any) {
    return await this.stockClientes.crearSucursal(req.stockPortal.rut, body);
  }

  @UseGuards(StockPortalGuard)
  @Put('sucursales/:id')
  async actualizarSucursal(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return await this.stockClientes.actualizarSucursal(req.stockPortal.rut, id, body);
  }

  @UseGuards(StockPortalGuard)
  @Delete('sucursales/:id')
  async eliminarSucursal(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.eliminarSucursal(req.stockPortal.rut, id);
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

  // Cotización vinculada a una solicitud (estado + datos para el PDF).
  @UseGuards(StockPortalGuard)
  @Get('mis-solicitudes/:id/cotizacion')
  async miCotizacion(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.cotizacionDeSolicitud(id, req.stockPortal.rut);
  }

  // Hilo de mensajes (cliente).
  @UseGuards(StockPortalGuard)
  @Get('mis-solicitudes/:id/mensajes')
  async misMensajes(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.listarMensajes(id, { rut: req.stockPortal.rut });
  }

  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/mensajes')
  async crearMiMensaje(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: { mensaje: string }) {
    return await this.stockClientes.crearMensaje(
      id,
      { mensaje: body?.mensaje, autorTipo: 'cliente', autorNombre: req.stockPortal.razon_social || null },
      { rut: req.stockPortal.rut },
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

  // Sucursales de un cliente (para el detalle/monitoreo admin).
  @UseGuards(AuthGuard)
  @Get('sucursales-por-rut')
  async listarSucursalesPorRut(@Query('rut') rut: string) {
    return await this.stockClientes.listarSucursalesPorRut(rut);
  }

  @UseGuards(AuthGuard)
  @Put('solicitudes/:id/estado')
  async actualizarEstadoSolicitud(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado: string },
  ) {
    return await this.stockClientes.actualizarEstadoSolicitud(id, body?.estado);
  }

  // Vincula la solicitud con la cotización creada a partir de ella.
  @UseGuards(AuthGuard)
  @Put('solicitudes/:id/vincular')
  async vincularSolicitud(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { licitacion_id: number },
  ) {
    return await this.stockClientes.vincularLicitacion(id, Number(body?.licitacion_id));
  }

  // Hilo de mensajes (equipo).
  @UseGuards(AuthGuard)
  @Get('solicitudes/:id/mensajes')
  async mensajesSolicitud(@Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.listarMensajes(id, {});
  }

  @UseGuards(AuthGuard)
  @Post('solicitudes/:id/mensajes')
  async crearMensajeEquipo(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { mensaje: string },
  ) {
    const email = (req?.user?.email || '').toLowerCase();
    return await this.stockClientes.crearMensaje(
      id,
      { mensaje: body?.mensaje, autorTipo: 'equipo', autorEmail: email, autorNombre: email },
      {},
    );
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

  // ============================================================
  // Admin — habilitación de acceso al portal y recuperaciones
  // ============================================================
  @UseGuards(AdminGuard)
  @Get('accesos')
  async listarAccesos() {
    return await this.stockClientes.listarAccesos();
  }

  // Búsqueda en el maestro de clientes para habilitar un acceso nuevo.
  @UseGuards(AdminGuard)
  @Get('accesos/buscar-cliente')
  async buscarClienteParaAcceso(@Query('q') q: string) {
    return await this.stockClientes.buscarClientesParaAcceso(q);
  }

  @UseGuards(AdminGuard)
  @Post('accesos/habilitar')
  async habilitarAcceso(
    @Req() req: any,
    @Body() body: { rut: string; password: string; vigencia: string },
  ) {
    return await this.stockClientes.habilitarAcceso({
      ...body,
      adminEmail: req?.user?.email || null,
    });
  }

  @UseGuards(AdminGuard)
  @Post('accesos/deshabilitar')
  async deshabilitarAcceso(@Body() body: { rut: string }) {
    return await this.stockClientes.deshabilitarAcceso(body?.rut);
  }

  @UseGuards(AdminGuard)
  @Post('accesos/regenerar-clave')
  async regenerarClave(
    @Req() req: any,
    @Body()
    body: {
      rut: string;
      password: string;
      reenviar_correo?: boolean;
      recuperacion_id?: number;
    },
  ) {
    return await this.stockClientes.regenerarClave({
      ...body,
      adminEmail: req?.user?.email || null,
    });
  }

  @UseGuards(AdminGuard)
  @Get('recuperaciones')
  async listarRecuperaciones(@Query('estado') estado?: string) {
    return await this.stockClientes.listarRecuperaciones(estado);
  }

  @UseGuards(AdminGuard)
  @Put('recuperaciones/:id/resolver')
  async resolverRecuperacion(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return await this.stockClientes.resolverRecuperacion(
      id,
      req?.user?.email || null,
    );
  }
}
