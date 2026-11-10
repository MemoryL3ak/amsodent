import { Controller, Get, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { GestionComprasExtrasService } from './gestion-compras-extras.service';

/* (2026-11-09) Respaldo de un quiebre de stock para el VENDEDOR avisado: lo
   descarga desde la campana o la ventana flotante aunque no tenga el módulo
   Gestión de compras. Va con AuthGuard (sesión obligatoria) y el servicio
   revisa que sea vendedor o dueño de una cotización afectada, admin o tenga
   `gestion_compras`. Las demás rutas de quiebres siguen en
   GestionComprasController, detrás de GestionComprasGuard. */
@Controller('quiebres-stock')
@UseGuards(AuthGuard)
export class QuiebresStockController {
  constructor(private extras: GestionComprasExtrasService) {}

  @Get(':id/respaldo')
  respaldo(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.extras.urlRespaldoAvisado(id, req.user);
  }
}
