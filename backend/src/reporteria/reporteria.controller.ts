import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ReporteriaService } from './reporteria.service';
import type { ConfigConstructor } from './reporteria.service';
import { ReporteriaGuard } from './reporteria.guard';
import { esRolAdmin } from '../auth/permisos';

/* Reportería (2026-09-17; abierta por perfil el 2026-09-24). Entra quien
   tenga el módulo `reporteria` en su perfil. Lo que ve cada uno lo decide
   el service según el rol: los usuarios arman reportes sobre las VISTAS DE
   NEGOCIO (sin SQL); las tablas crudas y el SQL libre son solo admin. El
   SQL libre además está confinado a solo lectura por la función
   `reporteria_sql` (migración 20260917). */
@Controller('reporteria')
@UseGuards(ReporteriaGuard)
export class ReporteriaController {
  constructor(private reporteria: ReporteriaService) {}

  // Catálogo: vistas de negocio (todos) + tablas crudas (solo admin).
  @Get('catalogo')
  catalogo(@Req() req: any) {
    return this.reporteria.catalogo(req?.userRol);
  }

  // Constructor visual: config estructurada → SQL seguro → resultados.
  @Post('consulta')
  consulta(@Req() req: any, @Body() body: ConfigConstructor) {
    return this.reporteria.ejecutarConstructor(body, req?.userRol);
  }

  // SQL libre de solo lectura (solo admin).
  @Post('sql')
  sql(@Req() req: any, @Body() body: { consulta?: string }) {
    if (!esRolAdmin(req?.userRol)) {
      throw new ForbiddenException('La consulta SQL libre es solo para administración.');
    }
    return this.reporteria.ejecutarSQL(String(body?.consulta || ''));
  }

  // Reportes guardados.
  @Get('reportes')
  listar() {
    return this.reporteria.listarGuardados();
  }

  @Post('reportes')
  guardar(@Req() req: any, @Body() body: any) {
    if (body?.tipo === 'sql' && !esRolAdmin(req?.userRol)) {
      throw new ForbiddenException('Solo administración puede guardar consultas SQL.');
    }
    return this.reporteria.guardarReporte(body, (req?.user?.email || '').toLowerCase());
  }

  @Delete('reportes/:id')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.reporteria.eliminarReporte(id);
  }
}
