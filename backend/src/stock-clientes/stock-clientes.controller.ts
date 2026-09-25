import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StockClientesService, rolDeToken } from './stock-clientes.service';
import { ExploradorService } from './explorador.service';
import { PedidosFlujoService } from './pedidos-flujo.service';
import { WebpayService } from './webpay.service';
import { StockPortalGuard } from './stock-clientes.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('stock-clientes')
export class StockClientesController {
  constructor(
    private stockClientes: StockClientesService,
    private explorador: ExploradorService,
    private pedidosFlujo: PedidosFlujoService,
    private webpay: WebpayService,
  ) {}

  // ============================================================
  // Público — acceso del cliente al portal
  // ============================================================

  // Verifica si el RUT existe en el portal y si ya aceptó el acuerdo.
  // El frontend usa esto para decidir el flujo: directo al portal o acuerdo
  // + razón social primero.
  @Post('verificar-rut')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async verificarRut(@Body() body: { rut: string }) {
    return await this.stockClientes.verificarRut(body?.rut);
  }

  // Login del cliente con RUT + contraseña. El correo es opcional: se usa
  // cuando el RUT tiene varios usuarios (2026-09-16).
  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(
    @Req() req: any,
    @Body() body: { rut: string; password: string; email?: string },
  ) {
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.ip ||
      null;
    return await this.stockClientes.login({ ...body, ip });
  }

  // Solicitud de recuperación de clave (el cliente no está autenticado).
  @Post('recuperacion')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
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
      req.stockPortal.usuario_id ?? null,
    );
  }

  /* ── Usuarios del portal del propio cliente (2026-09-16) ────────────────
     Solo el rol admin del portal administra a los usuarios de su RUT; el
     asistente no puede crear ni cambiar roles. */
  @UseGuards(StockPortalGuard)
  @Get('usuarios')
  async listarUsuarios(@Req() req: any) {
    return await this.stockClientes.listarUsuariosPortal(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Post('usuarios')
  async guardarUsuario(@Req() req: any, @Body() body: any) {
    this.exigirAdminPortal(req);
    return await this.stockClientes.guardarUsuarioPortal(
      req.stockPortal.rut,
      body,
      req.stockPortal.usuario_email || 'cuenta principal',
    );
  }

  @UseGuards(StockPortalGuard)
  @Delete('usuarios/:id')
  async eliminarUsuario(@Req() req: any, @Param('id') id: string) {
    this.exigirAdminPortal(req);
    if (Number(id) === Number(req.stockPortal.usuario_id)) {
      throw new ForbiddenException('No puede eliminar su propio usuario.');
    }
    return await this.stockClientes.eliminarUsuarioPortal(req.stockPortal.rut, Number(id));
  }

  /* ── Flujo del pedido: lado del cliente (2026-09-16) ────────────────────
     Aprobar y pagar son exclusivos del rol admin del portal (punto 6). */

  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/aprobar')
  async aprobarPedido(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    this.exigirAdminPortal(req, 'Solo el administrador de la cuenta puede aprobar el pedido.');
    return await this.pedidosFlujo.aprobarComoCliente(
      id,
      req.stockPortal.usuario_email || 'cuenta principal',
      req.stockPortal.rut,
    );
  }

  /* (2026-09-24) El cliente, sobre la cotizacion que ya recibio: darla por
     buena o pedir cambios. Las dos son del administrador de la cuenta, igual
     que aprobar y pagar. */

  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/validar-cotizacion')
  async validarCotizacionCliente(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    this.exigirAdminPortal(req, 'Solo el administrador de la cuenta puede validar la cotizacion.');
    return await this.pedidosFlujo.validarComoCliente(
      id,
      req.stockPortal.usuario_email || 'cuenta principal',
      req.stockPortal.rut,
    );
  }

  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/modificar')
  async modificarPedidoCliente(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    this.exigirAdminPortal(req, 'Solo el administrador de la cuenta puede modificar el pedido.');
    return await this.pedidosFlujo.pedirModificacion(
      id,
      body || {},
      req.stockPortal.usuario_email || 'cuenta principal',
      req.stockPortal.rut,
    );
  }

  /* ── Historial de actividad de la cuenta (2026-09-24) ──────────────────
     La misma informacion para los dos lados: el cliente lo ve en su portal y
     Amsodent en la bandeja de pedidos. */

  @UseGuards(StockPortalGuard)
  @Get('mi-historial')
  async miHistorial(@Req() req: any, @Query('limite') limite?: string) {
    return await this.pedidosFlujo.historialDeCuenta(req.stockPortal.rut, Number(limite) || 120);
  }

  @UseGuards(StockPortalGuard)
  @Get('mis-avisos')
  async misAvisos(@Req() req: any) {
    return await this.pedidosFlujo.avisosSinLeer(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Post('mis-avisos/leidos')
  async marcarAvisosLeidos(@Req() req: any) {
    return await this.pedidosFlujo.marcarAvisosLeidos(req.stockPortal.rut);
  }

  /** Lado Amsodent: historial de la cuenta de un cliente, por RUT. */
  @Get('historial')
  async historialCliente(@Query('rut') rut: string, @Query('limite') limite?: string) {
    return await this.pedidosFlujo.historialDeCuenta(String(rut || '').trim(), Number(limite) || 120);
  }

  @UseGuards(StockPortalGuard)
  @Get('mis-solicitudes/:id/eventos')
  async eventosPedidoCliente(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const pedido = await this.pedidosFlujo.obtener(id);
    if (String(pedido.rut) !== String(req.stockPortal.rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    return await this.pedidosFlujo.eventosDe(id);
  }

  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/pagar')
  async pagarPedido(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: { return_url?: string }) {
    this.exigirAdminPortal(req, 'Solo el administrador de la cuenta puede pagar el pedido.');
    const base = String(process.env.PORTAL_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');
    const returnUrl = String(body?.return_url || `${base}/portal-cliente?pago=retorno`);
    return await this.pedidosFlujo.iniciarPago(id, req.stockPortal.rut, returnUrl, this.webpay);
  }

  // Punto 29: pagar con la línea de crédito, sin pasar por Webpay.
  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/pagar-credito')
  async pagarConCredito(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    this.exigirAdminPortal(req, 'Solo el administrador de la cuenta puede pagar el pedido.');
    return await this.pedidosFlujo.pagarConCredito(
      id,
      req.stockPortal.rut,
      req.stockPortal.usuario_email || 'cuenta principal',
    );
  }

  // Cupo de crédito del cliente, para mostrarlo en el portal.
  @UseGuards(StockPortalGuard)
  @Get('mi-credito')
  async miCredito(@Req() req: any) {
    return await this.pedidosFlujo.creditoDisponible(req.stockPortal.rut);
  }

  // Retorno de Webpay. Es público a propósito: quien vuelve del formulario de
  // Transbank no trae el token del portal. La verdad del pago la da Transbank
  // (se confirma contra su API), no quien llama a este endpoint.
  @Post('pagos/webpay/confirmar')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async confirmarPagoWebpay(@Body() body: { token_ws?: string; token?: string }) {
    return await this.pedidosFlujo.confirmarPago(
      String(body?.token_ws || body?.token || ''),
      this.webpay,
    );
  }

  @UseGuards(StockPortalGuard)
  @Post('mis-solicitudes/:id/sos')
  async sosPedidoCliente(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: { motivo?: string }) {
    const pedido = await this.pedidosFlujo.obtener(id);
    if (String(pedido.rut) !== String(req.stockPortal.rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    return await this.pedidosFlujo.marcarSos(id, String(body?.motivo || ''), {
      tipo: 'cliente',
      email: req.stockPortal.usuario_email || 'cuenta principal',
    });
  }

  private exigirAdminPortal(req: any, mensaje?: string) {
    if (rolDeToken(req.stockPortal) !== 'admin') {
      throw new ForbiddenException(
        mensaje || 'Solo el administrador de la cuenta puede administrar usuarios.',
      );
    }
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

  // Ubicaciones del cliente (bodega, caja, etc.) — el cliente gestiona su lista.
  @UseGuards(StockPortalGuard)
  @Get('mis-ubicaciones')
  async misUbicaciones(@Req() req: any) {
    return await this.stockClientes.listarUbicaciones(req.stockPortal.rut);
  }

  @UseGuards(StockPortalGuard)
  @Post('ubicaciones')
  async crearUbicacion(@Req() req: any, @Body() body: any) {
    return await this.stockClientes.crearUbicacion(req.stockPortal.rut, body);
  }

  @UseGuards(StockPortalGuard)
  @Put('ubicaciones/:id')
  async actualizarUbicacion(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return await this.stockClientes.actualizarUbicacion(req.stockPortal.rut, id, body);
  }

  @UseGuards(StockPortalGuard)
  @Delete('ubicaciones/:id')
  async eliminarUbicacion(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.eliminarUbicacion(req.stockPortal.rut, id);
  }

  @UseGuards(StockPortalGuard)
  @Get('mis-solicitudes')
  async misSolicitudes(@Req() req: any) {
    return await this.stockClientes.listarMisSolicitudes(req.stockPortal.rut);
  }

  // Historial de todas las cotizaciones del sistema a nombre del cliente (por RUT),
  // no solo las que nacen de una solicitud de stock.
  @UseGuards(StockPortalGuard)
  @Get('mis-cotizaciones')
  async misCotizaciones(@Req() req: any) {
    return await this.stockClientes.listarMisCotizaciones(req.stockPortal.rut);
  }

  // Detalle de una cotización del historial (productos + datos para el PDF),
  // validado por el RUT del token.
  @UseGuards(StockPortalGuard)
  @Get('mis-cotizaciones/:id')
  async miCotizacionHistorial(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return await this.stockClientes.cotizacionDeLicitacion(id, req.stockPortal.rut);
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

  // Explorador de precios dentales (2026-09-04): busca la palabra clave en
  // las tiendas dentales chilenas con API pública y devuelve precios en vivo
  // + histórico de capturas (estilo Knasta/SoloTodo).
  @UseGuards(StockPortalGuard)
  /* ── Showroom (2026-09-24) ──────────────────────────────────────────────
     Catalogo de venta al publico para el cliente del portal: lo que le
     cuesta a el, lo que le sugerimos cobrar y cuanto gana con cada producto. */
  @UseGuards(StockPortalGuard)
  @Get('showroom')
  async showroom(@Query('q') q?: string, @Query('marca') marca?: string) {
    return await this.stockClientes.catalogoShowroom({ q, marca });
  }

  @Get('explorador')
  async explorarPrecios(@Query('q') q: string) {
    return await this.explorador.buscar(q);
  }

  /* (2026-09-24) El mismo explorador, pero desde la plataforma interna. Va por
     su propia ruta con AdminGuard en vez de reutilizar la de arriba: esa la
     consume el portal del cliente y no exige sesion de la plataforma, asi que
     colgar de ella una pantalla de admin dejaria el control de acceso solo en
     el frontend. El motor de busqueda es el mismo. */
  @UseGuards(AdminGuard)
  @Get('explorador/interno')
  async explorarPreciosInterno(@Query('q') q: string) {
    return await this.explorador.buscar(q);
  }

  // Mantenedor de tiendas del explorador (2026-09-10, solo admin): permite
  // customizar las páginas que consulta el buscador de precios.
  @UseGuards(AdminGuard)
  @Get('explorador/tiendas')
  async listarTiendasExplorador() {
    return await this.explorador.listarTiendas();
  }

  @UseGuards(AdminGuard)
  @Post('explorador/tiendas')
  async guardarTiendaExplorador(@Body() body: Record<string, any>) {
    return await this.explorador.guardarTienda(body);
  }

  @UseGuards(AdminGuard)
  @Delete('explorador/tiendas/:id')
  async eliminarTiendaExplorador(@Param('id') id: string) {
    return await this.explorador.eliminarTienda(id);
  }

  @UseGuards(AdminGuard)
  @Post('explorador/tiendas/probar')
  async probarTiendaExplorador(@Body() body: Record<string, any>) {
    return await this.explorador.probarTienda(body);
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

  // (2026-09-10) Bandeja "Pedidos del Portal": todos los pedidos/solicitudes
  // del portal cliente, de cualquier cliente y origen.
  @UseGuards(AuthGuard)
  @Get('solicitudes')
  async listarSolicitudesTodas() {
    return await this.stockClientes.listarSolicitudesTodas();
  }

  // Sucursales de un cliente (para el detalle/monitoreo admin).
  @UseGuards(AuthGuard)
  @Get('sucursales-por-rut')
  async listarSucursalesPorRut(@Query('rut') rut: string) {
    return await this.stockClientes.listarSucursalesPorRut(rut);
  }

  // Gestión de sucursales desde la plataforma (admin) — el cliente ya no las crea.
  @UseGuards(AuthGuard)
  @Post('admin/sucursales')
  async adminCrearSucursal(@Body() body: any) {
    return await this.stockClientes.crearSucursal(body?.rut, body);
  }

  @UseGuards(AuthGuard)
  @Put('admin/sucursales/:id')
  async adminActualizarSucursal(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return await this.stockClientes.actualizarSucursal(body?.rut, id, body);
  }

  @UseGuards(AuthGuard)
  @Delete('admin/sucursales/:id')
  async adminEliminarSucursal(@Param('id', ParseIntPipe) id: number, @Query('rut') rut: string) {
    return await this.stockClientes.eliminarSucursal(rut, id);
  }

  // Habilita/deshabilita una sucursal para el portal del cliente.
  @UseGuards(AuthGuard)
  @Put('admin/sucursales/:id/habilitar')
  async adminHabilitarSucursal(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { rut: string; habilitada: boolean },
  ) {
    return await this.stockClientes.habilitarSucursalPortal(body?.rut, id, !!body?.habilitada);
  }

  // Ubicaciones de un cliente (para mostrarlas en el monitoreo admin).
  @UseGuards(AuthGuard)
  @Get('ubicaciones-por-rut')
  async listarUbicacionesPorRut(@Query('rut') rut: string) {
    return await this.stockClientes.listarUbicaciones(rut, true);
  }

  @UseGuards(AuthGuard)
  @Put('solicitudes/:id/estado')
  async actualizarEstadoSolicitud(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado: string },
  ) {
    return await this.stockClientes.actualizarEstadoSolicitud(id, body?.estado);
  }

  /* ── Flujo del pedido: lado de la plataforma (2026-09-16) ────────────── */

  // Punto 11: validar existencias producto por producto y emitir el link de
  // pago. Punto 12: el cliente se entera por el portal y por correo.
  @UseGuards(AuthGuard)
  @Post('solicitudes/:id/validar')
  async validarPedido(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return await this.pedidosFlujo.validarDesdePlataforma(
      id,
      body,
      (req?.user?.email || '').toLowerCase(),
    );
  }

  // Punto 14: volver un paso atrás mientras el pedido no esté pagado.
  @UseGuards(AuthGuard)
  @Post('solicitudes/:id/revertir')
  async revertirPedido(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: { motivo?: string }) {
    return await this.pedidosFlujo.revertir(id, String(body?.motivo || ''), {
      tipo: 'plataforma',
      email: (req?.user?.email || '').toLowerCase(),
    });
  }

  @UseGuards(AuthGuard)
  @Get('solicitudes/:id/eventos')
  async eventosPedido(@Param('id', ParseIntPipe) id: number) {
    return await this.pedidosFlujo.eventosDe(id);
  }

  // Punto 17: SOS — despacho comprometido en 24 hrs.
  @UseGuards(AuthGuard)
  @Post('solicitudes/:id/sos')
  async sosPedido(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: { motivo?: string; quitar?: boolean }) {
    const actor = { tipo: 'plataforma' as const, email: (req?.user?.email || '').toLowerCase() };
    return body?.quitar
      ? await this.pedidosFlujo.quitarSos(id, actor)
      : await this.pedidosFlujo.marcarSos(id, String(body?.motivo || ''), actor);
  }

  // Punto 18: KPI de tiempos de respuesta del submódulo de pedidos.
  @UseGuards(AuthGuard)
  @Get('solicitudes-kpis')
  async kpisPedidos(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return await this.pedidosFlujo.kpis(desde, hasta);
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

  /* Usuarios del portal de un RUT, administrados desde la plataforma
     (2026-09-16). El admin del cliente también los administra desde el
     portal — comparten el mismo mantenedor del servicio. */
  @UseGuards(AdminGuard)
  @Get('accesos/usuarios')
  async listarUsuariosDeAcceso(@Query('rut') rut: string) {
    return await this.stockClientes.listarUsuariosPortal(rut);
  }

  @UseGuards(AdminGuard)
  @Post('accesos/usuarios')
  async guardarUsuarioDeAcceso(@Req() req: any, @Body() body: any) {
    return await this.stockClientes.guardarUsuarioPortal(
      String(body?.rut || ''),
      body,
      req?.user?.email || 'plataforma',
    );
  }

  @UseGuards(AdminGuard)
  @Delete('accesos/usuarios/:id')
  async eliminarUsuarioDeAcceso(
    @Param('id', ParseIntPipe) id: number,
    @Query('rut') rut: string,
  ) {
    return await this.stockClientes.eliminarUsuarioPortal(rut, id);
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
