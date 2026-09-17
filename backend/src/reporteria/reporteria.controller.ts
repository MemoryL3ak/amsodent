import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ReporteriaService } from './reporteria.service';
import type { ConfigConstructor } from './reporteria.service';
import { AdminGuard } from '../auth/admin.guard';

/* Reportería (2026-09-17) — SOLO ADMIN, como Análisis Mercado Público: el
   módulo consulta cualquier tabla del negocio, así que no es asignable por
   perfil. El SQL libre además está confinado a solo lectura por la función
   `reporteria_sql` (migración 20260917). */
@Controller('reporteria')
@UseGuards(AdminGuard)
export class ReporteriaController {
  constructor(private reporteria: ReporteriaService) {}

  // Catálogo de tablas y columnas (las recomendadas van primero, con
  // descripción del negocio).
  @Get('catalogo')
  catalogo() {
    return this.reporteria.catalogo();
  }

  // Constructor visual: config estructurada → SQL seguro → resultados.
  @Post('consulta')
  consulta(@Body() body: ConfigConstructor) {
    return this.reporteria.ejecutarConstructor(body);
  }

  // SQL libre de solo lectura.
  @Post('sql')
  sql(@Body() body: { consulta?: string }) {
    return this.reporteria.ejecutarSQL(String(body?.consulta || ''));
  }

  // Reportes guardados.
  @Get('reportes')
  listar() {
    return this.reporteria.listarGuardados();
  }

  @Post('reportes')
  guardar(@Req() req: any, @Body() body: any) {
    return this.reporteria.guardarReporte(body, (req?.user?.email || '').toLowerCase());
  }

  @Delete('reportes/:id')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.reporteria.eliminarReporte(id);
  }
}
