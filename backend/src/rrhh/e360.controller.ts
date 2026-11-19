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
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RrhhService } from './rrhh.service';
import { E360Service } from './e360.service';

/* ============================================================================
   Evaluación 360° — API
   ----------------------------------------------------------------------------
   · /rrhh/e360/**     → panel de RR.HH. (AdminGuard): ciclos, matriz,
     objetivos, seguimiento y resultados.
   · /rrhh/mi/e360/**  → portal del trabajador (AuthGuard): sus formularios y
     su informe. La ficha se resuelve por el correo del token; los ids que
     llegan por parámetro se validan contra esa ficha en el servicio.
============================================================================ */

@Controller('rrhh')
export class E360Controller {
  constructor(
    private e360: E360Service,
    private rrhh: RrhhService,
  ) {}

  private emailDe(req: any): string {
    return String(req?.user?.email || '').trim().toLowerCase();
  }

  private async miFicha(req: any) {
    const emp = await this.rrhh.empleadoPorEmail(this.emailDe(req));
    if (!emp) throw new ForbiddenException('No tienes una ficha de trabajador registrada en RR.HH.');
    return emp;
  }

  // ==========================================================================
  // PORTAL DEL TRABAJADOR
  // ==========================================================================
  @UseGuards(AuthGuard)
  @Get('mi/e360')
  async misDatos(@Req() req: any) {
    return this.e360.misDatos(await this.miFicha(req));
  }

  @UseGuards(AuthGuard)
  @Get('mi/e360/formularios/:id')
  async miFormulario(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.e360.miFormulario(await this.miFicha(req), id);
  }

  @UseGuards(AuthGuard)
  @Put('mi/e360/formularios/:id')
  async guardarMiFormulario(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.e360.guardarMiFormulario(await this.miFicha(req), id, body);
  }

  @UseGuards(AuthGuard)
  @Get('mi/e360/informes/:cicloId')
  async miResultado(@Req() req: any, @Param('cicloId', ParseIntPipe) cicloId: number) {
    return this.e360.miResultado(await this.miFicha(req), cicloId);
  }

  @UseGuards(AuthGuard)
  @Post('mi/e360/informes/:cicloId/acuse')
  async acusar(@Req() req: any, @Param('cicloId', ParseIntPipe) cicloId: number, @Body() body: any) {
    return this.e360.acusar(await this.miFicha(req), cicloId, body?.comentario);
  }

  @UseGuards(AuthGuard)
  @Get('mi/e360/equipo/:cicloId/:empleadoId')
  async resultadoDeMiEquipo(
    @Req() req: any,
    @Param('cicloId', ParseIntPipe) cicloId: number,
    @Param('empleadoId', ParseIntPipe) empleadoId: number,
  ) {
    return this.e360.resultadoDeMiEquipo(await this.miFicha(req), cicloId, empleadoId);
  }

  // ==========================================================================
  // CICLOS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('e360/ciclos')
  listarCiclos() {
    return this.e360.listarCiclos();
  }

  @UseGuards(AdminGuard)
  @Post('e360/ciclos')
  guardarCiclo(@Req() req: any, @Body() body: any) {
    return this.e360.guardarCiclo(body, this.emailDe(req));
  }

  @UseGuards(AdminGuard)
  @Get('e360/ciclos/:id')
  detalleCiclo(@Param('id', ParseIntPipe) id: number) {
    return this.e360.detalleCiclo(id);
  }

  @UseGuards(AdminGuard)
  @Delete('e360/ciclos/:id')
  eliminarCiclo(@Param('id', ParseIntPipe) id: number) {
    return this.e360.eliminarCiclo(id);
  }

  @UseGuards(AdminGuard)
  @Post('e360/ciclos/:id/duplicar')
  duplicarCiclo(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.e360.duplicarCiclo(id, this.emailDe(req));
  }

  @UseGuards(AdminGuard)
  @Put('e360/ciclos/:id/estado')
  cambiarEstado(@Param('id', ParseIntPipe) id: number, @Body() body: { estado?: string }) {
    return this.e360.cambiarEstado(id, String(body?.estado || ''));
  }

  // Recordatorio en la campana a quienes tienen formularios sin enviar.
  // Con `simular` solo devuelve a quiénes les llegaría.
  @UseGuards(AdminGuard)
  @Post('e360/ciclos/:id/recordar')
  recordar(@Param('id', ParseIntPipe) id: number, @Body() body: { simular?: boolean }) {
    return this.e360.recordar(id, Boolean(body?.simular));
  }

  // ==========================================================================
  // PARTICIPANTES Y MATRIZ (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Put('e360/ciclos/:id/participantes')
  definirParticipantes(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { empleado_ids?: any[]; forzar?: boolean },
  ) {
    return this.e360.definirParticipantes(id, body?.empleado_ids || [], Boolean(body?.forzar));
  }

  // Simulación: qué evaluaciones se agregarían, sin guardar.
  @UseGuards(AdminGuard)
  @Post('e360/ciclos/:id/matriz/sugerir')
  sugerirMatriz(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.e360.sugerirMatriz(id, body);
  }

  @UseGuards(AdminGuard)
  @Post('e360/ciclos/:id/matriz/generar')
  generarMatriz(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.e360.generarMatriz(id, body);
  }

  @UseGuards(AdminGuard)
  @Post('e360/ciclos/:id/asignaciones')
  crearAsignacion(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.e360.crearAsignacion(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('e360/asignaciones/:id')
  eliminarAsignacion(@Param('id', ParseIntPipe) id: number, @Query('forzar') forzar?: string) {
    return this.e360.eliminarAsignacion(id, forzar === '1');
  }

  @UseGuards(AdminGuard)
  @Put('e360/asignaciones/:id/reabrir')
  reabrirAsignacion(@Param('id', ParseIntPipe) id: number) {
    return this.e360.reabrirAsignacion(id);
  }

  // ==========================================================================
  // OBJETIVOS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Post('e360/ciclos/:id/objetivos')
  guardarObjetivo(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.e360.guardarObjetivo(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('e360/objetivos/:id')
  eliminarObjetivo(@Param('id', ParseIntPipe) id: number) {
    return this.e360.eliminarObjetivo(id);
  }

  // ==========================================================================
  // RESULTADOS (admin)
  // ==========================================================================
  @UseGuards(AdminGuard)
  @Get('e360/ciclos/:id/resultados')
  resultados(@Param('id', ParseIntPipe) id: number) {
    return this.e360.resultados(id);
  }

  @UseGuards(AdminGuard)
  @Get('e360/ciclos/:id/resultados/:empleadoId')
  resultadoDe(
    @Param('id', ParseIntPipe) id: number,
    @Param('empleadoId', ParseIntPipe) empleadoId: number,
  ) {
    return this.e360.resultadoDe(id, empleadoId);
  }

  @UseGuards(AdminGuard)
  @Put('e360/ciclos/:id/resultados/:empleadoId/cierre')
  guardarCierre(
    @Param('id', ParseIntPipe) id: number,
    @Param('empleadoId', ParseIntPipe) empleadoId: number,
    @Body() body: any,
  ) {
    return this.e360.guardarCierre(id, empleadoId, body);
  }
}
