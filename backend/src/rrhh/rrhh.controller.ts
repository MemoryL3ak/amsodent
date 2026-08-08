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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RrhhService } from './rrhh.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Recursos Humanos — API
   ----------------------------------------------------------------------------
   Dos superficies:
   · /rrhh/**      → administración (AdminGuard): fichas, contratos,
     liquidaciones, evaluaciones, reportes.
   · /rrhh/mi/**   → portal del trabajador (AuthGuard): SOLO sus propios datos,
     resueltos por el email del token — nunca se acepta un id por parámetro.
============================================================================ */

@Controller('rrhh')
export class RrhhController {
  constructor(
    private rrhh: RrhhService,
    private supabase: SupabaseService,
  ) {}

  private emailDe(req: any): string {
    return String(req?.user?.email || '').trim().toLowerCase();
  }

  // Ficha del trabajador autenticado; 404 controlado si no está registrado.
  private async miFicha(req: any) {
    const email = this.emailDe(req);
    const emp = await this.rrhh.empleadoPorEmail(email);
    if (!emp) {
      throw new ForbiddenException('No tienes una ficha de trabajador registrada en RR.HH.');
    }
    return emp;
  }

  // ==========================================================================
  // PORTAL DEL TRABAJADOR (cualquier usuario autenticado, solo lo suyo)
  // ==========================================================================
  @UseGuards(AuthGuard)
  @Get('mi/ficha')
  async miFichaCompleta(@Req() req: any) {
    const emp = await this.miFicha(req);
    const ficha = await this.rrhh.fichaCompleta(Number(emp.id));
    // El portal solo ve los documentos marcados como visibles.
    ficha.documentos = (ficha.documentos || []).filter((d: any) => d.visible_trabajador !== false);
    // Y solo las liquidaciones ya emitidas (no los borradores de RR.HH.).
    ficha.liquidaciones = (ficha.liquidaciones || []).filter((l: any) => l.estado !== 'borrador');
    ficha.evaluaciones = (ficha.evaluaciones || []).filter((e: any) => e.estado !== 'borrador');
    ficha.contratos = (ficha.contratos || []).filter((c: any) => c.estado !== 'borrador');
    return ficha;
  }

  @UseGuards(AuthGuard)
  @Post('mi/solicitudes')
  async crearMiSolicitud(@Req() req: any, @Body() body: any) {
    const emp = await this.miFicha(req);
    return this.rrhh.crearSolicitud({ ...body, empleado_id: emp.id });
  }

  @UseGuards(AuthGuard)
  @Post('mi/firmar')
  async firmarPropio(@Req() req: any, @Body() body: any) {
    const emp = await this.miFicha(req);
    // Verifica que el documento a firmar sea efectivamente suyo.
    const tipo = String(body?.documento_tipo || '');
    const docId = Number(body?.documento_id);
    const tabla =
      tipo === 'contrato'
        ? 'rrhh_contratos'
        : tipo === 'liquidacion'
          ? 'rrhh_liquidaciones'
          : tipo === 'evaluacion'
            ? 'rrhh_evaluaciones'
            : tipo === 'documento'
              ? 'rrhh_documentos'
              : null;
    if (!tabla || !docId) throw new BadRequestException('Documento a firmar inválido.');
    const { data } = await this.supabase
      .getClient()
      .from(tabla)
      .select('empleado_id')
      .eq('id', docId)
      .maybeSingle();
    if (!data || Number(data.empleado_id) !== Number(emp.id)) {
      throw new ForbiddenException('Ese documento no te pertenece.');
    }
    return this.rrhh.firmar(
      { ...body, empleado_id: emp.id },
      {
        email: this.emailDe(req),
        nombre: `${emp.nombre} ${emp.apellidos || ''}`.trim(),
        rut: emp.rut,
        ip: req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() || req?.ip,
        userAgent: req?.headers?.['user-agent'],
      },
    );
  }

  // URL firmada de un archivo propio (liquidación, contrato o documento).
  @UseGuards(AuthGuard)
  @Get('mi/archivo')
  async miArchivo(@Req() req: any, @Query('bucket') bucket: string, @Query('path') path: string) {
    const emp = await this.miFicha(req);
    const ruta = String(path || '');
    // Los archivos del trabajador viven bajo <empleado_id>/… en el bucket rrhh.
    if (!ruta.startsWith(`${emp.id}/`)) {
      throw new ForbiddenException('Ese archivo no te pertenece.');
    }
    return this.rrhh.urlFirmada(bucket || 'rrhh', ruta);
  }

  // ==========================================================================
  // EMPLEADOS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('empleados')
  listarEmpleados(
    @Query('estado') estado?: string,
    @Query('area') area?: string,
    @Query('q') q?: string,
  ) {
    return this.rrhh.listarEmpleados({ estado, area, q });
  }

  @UseGuards(AdminGuard)
  @Get('empleados/:id')
  fichaCompleta(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.fichaCompleta(id);
  }

  @UseGuards(AdminGuard)
  @Post('empleados')
  crearEmpleado(@Body() body: any) {
    return this.rrhh.crearEmpleado(body);
  }

  @UseGuards(AdminGuard)
  @Put('empleados/:id')
  actualizarEmpleado(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.rrhh.actualizarEmpleado(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('empleados/:id')
  eliminarEmpleado(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.eliminarEmpleado(id);
  }

  // Jornada pactada del trabajador (para calcular atrasos).
  @UseGuards(AdminGuard)
  @Put('empleados/:id/jornadas')
  guardarJornadas(@Param('id', ParseIntPipe) id: number, @Body() body: { jornadas?: any[] }) {
    return this.rrhh.guardarJornadas(id, Array.isArray(body?.jornadas) ? body.jornadas : []);
  }

  // ==========================================================================
  // CONTRATOS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('contratos')
  listarContratos(@Query('empleado_id') empleadoId?: string, @Query('estado') estado?: string) {
    return this.rrhh.listarContratos(empleadoId ? Number(empleadoId) : undefined, { estado });
  }

  @UseGuards(AdminGuard)
  @Post('contratos')
  crearContrato(@Req() req: any, @Body() body: any) {
    return this.rrhh.crearContrato(body, this.emailDe(req));
  }

  @UseGuards(AdminGuard)
  @Put('contratos/:id')
  actualizarContrato(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.rrhh.actualizarContrato(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('contratos/:id')
  eliminarContrato(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.eliminarContrato(id);
  }

  // ==========================================================================
  // LIQUIDACIONES (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('liquidaciones')
  listarLiquidaciones(
    @Query('empleado_id') empleadoId?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.rrhh.listarLiquidaciones({
      empleado_id: empleadoId ? Number(empleadoId) : undefined,
      periodo,
      estado,
    });
  }

  // Cálculo en vivo para el formulario (no guarda nada).
  @UseGuards(AdminGuard)
  @Post('liquidaciones/calcular')
  calcular(@Body() body: any) {
    return this.rrhh.previsualizarLiquidacion(body);
  }

  @UseGuards(AdminGuard)
  @Post('liquidaciones')
  guardarLiquidacion(@Req() req: any, @Body() body: any) {
    return this.rrhh.guardarLiquidacion(body, this.emailDe(req));
  }

  // Genera las liquidaciones del período para todos los activos.
  @UseGuards(AdminGuard)
  @Post('liquidaciones/generar')
  generarMasivo(@Req() req: any, @Body() body: { periodo?: string }) {
    return this.rrhh.generarLiquidacionesMasivas(String(body?.periodo || ''), this.emailDe(req));
  }

  @UseGuards(AdminGuard)
  @Put('liquidaciones/:id/estado')
  cambiarEstado(@Param('id', ParseIntPipe) id: number, @Body() body: { estado?: string }) {
    return this.rrhh.cambiarEstadoLiquidacion(id, String(body?.estado || ''));
  }

  @UseGuards(AdminGuard)
  @Delete('liquidaciones/:id')
  eliminarLiquidacion(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.eliminarLiquidacion(id);
  }

  // ==========================================================================
  // SOLICITUDES (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('solicitudes')
  listarSolicitudes(
    @Query('empleado_id') empleadoId?: string,
    @Query('estado') estado?: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.rrhh.listarSolicitudes({
      empleado_id: empleadoId ? Number(empleadoId) : undefined,
      estado,
      tipo,
    });
  }

  @UseGuards(AdminGuard)
  @Post('solicitudes')
  crearSolicitud(@Body() body: any) {
    return this.rrhh.crearSolicitud(body);
  }

  @UseGuards(AdminGuard)
  @Put('solicitudes/:id/resolver')
  resolverSolicitud(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado?: string; comentario?: string },
  ) {
    return this.rrhh.resolverSolicitud(id, body, this.emailDe(req));
  }

  @UseGuards(AdminGuard)
  @Delete('solicitudes/:id')
  eliminarSolicitud(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.eliminarSolicitud(id);
  }

  // ==========================================================================
  // EVALUACIONES (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('evaluaciones')
  listarEvaluaciones(
    @Query('empleado_id') empleadoId?: string,
    @Query('periodo') periodo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.rrhh.listarEvaluaciones({
      empleado_id: empleadoId ? Number(empleadoId) : undefined,
      periodo,
      estado,
    });
  }

  @UseGuards(AdminGuard)
  @Post('evaluaciones')
  async guardarEvaluacion(@Req() req: any, @Body() body: any) {
    let nombre = '';
    try {
      const { data } = await this.supabase
        .getClient()
        .from('profiles')
        .select('nombre')
        .ilike('email', this.emailDe(req))
        .maybeSingle();
      nombre = data?.nombre || '';
    } catch {
      /* sin nombre — no bloquea */
    }
    return this.rrhh.guardarEvaluacion(body, { email: this.emailDe(req), nombre });
  }

  @UseGuards(AdminGuard)
  @Delete('evaluaciones/:id')
  eliminarEvaluacion(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.eliminarEvaluacion(id);
  }

  // ==========================================================================
  // DOCUMENTOS Y FIRMAS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('documentos')
  listarDocumentos(@Query('empleado_id') empleadoId: string) {
    return this.rrhh.listarDocumentos(Number(empleadoId));
  }

  @UseGuards(AdminGuard)
  @Post('documentos')
  crearDocumento(@Req() req: any, @Body() body: any) {
    return this.rrhh.crearDocumento(body, this.emailDe(req));
  }

  @UseGuards(AdminGuard)
  @Delete('documentos/:id')
  eliminarDocumento(@Param('id', ParseIntPipe) id: number) {
    return this.rrhh.eliminarDocumento(id);
  }

  @UseGuards(AdminGuard)
  @Get('firmas')
  listarFirmas(@Query('tipo') tipo: string, @Query('documento_id') docId: string) {
    return this.rrhh.listarFirmas(String(tipo || ''), Number(docId));
  }

  // Firma hecha por RR.HH. en representación del proceso (ej. firma empresa).
  @UseGuards(AdminGuard)
  @Post('firmas')
  firmarAdmin(@Req() req: any, @Body() body: any) {
    return this.rrhh.firmar(body, {
      email: this.emailDe(req),
      nombre: body?.firmante_nombre,
      rut: body?.firmante_rut,
      ip: req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() || req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
  }

  // ==========================================================================
  // REPORTES (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('tablero')
  tablero() {
    return this.rrhh.tablero();
  }

  @UseGuards(AdminGuard)
  @Get('asistencia')
  asistencia(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('email') email?: string,
  ) {
    return this.rrhh.reporteAsistencia({ desde, hasta, email });
  }

  @UseGuards(AdminGuard)
  @Get('libro-remuneraciones')
  libro(@Query('periodo') periodo: string) {
    return this.rrhh.libroRemuneraciones(String(periodo || ''));
  }

  // ==========================================================================
  // ARCHIVOS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Post('storage/upload')
  @UseInterceptors(FileInterceptor('file'))
  subirArchivo(@UploadedFile() file: Express.Multer.File, @Query('path') path: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Falta el archivo.');
    return this.rrhh.subirArchivo(path, file.buffer, file.mimetype);
  }

  @UseGuards(AdminGuard)
  @Get('storage/signed-url')
  urlFirmada(@Query('bucket') bucket: string, @Query('path') path: string) {
    return this.rrhh.urlFirmada(bucket, path);
  }

  @UseGuards(AdminGuard)
  @Delete('storage/file')
  eliminarArchivo(@Query('bucket') bucket: string, @Query('path') path: string) {
    return this.rrhh.eliminarArchivo(bucket, path);
  }
}
