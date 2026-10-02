import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { BsaleFacturacionService } from './bsale-facturacion.service';

// Emisión de facturas en Bsale (módulo Facturación y botón en Trazabilidad).
// Exige sesión; quién puede emitir lo decide el servicio por rol
// (BSALE_EMISION_ROLES).
@Controller('bsale/facturas')
@UseGuards(AuthGuard)
export class BsaleFacturacionController {
  constructor(private facturacion: BsaleFacturacionService) {}

  // ¿Está configurado, puede este usuario y en qué modo (real o simulación)?
  @Get('estado')
  estado(@Req() req: any) {
    return this.facturacion.estado(String(req?.user?.id || ''));
  }

  // Módulo Facturación: guías que aún no tienen factura.
  @Get('pendientes')
  pendientes(@Req() req: any) {
    return this.facturacion.pendientes(String(req?.user?.id || ''));
  }

  // Módulo Facturación: historial de lo emitido desde el sistema.
  @Get('emitidas')
  emitidas(@Req() req: any) {
    return this.facturacion.emitidas(String(req?.user?.id || ''));
  }

  // Borrador de la factura a partir de las guías elegidas. No escribe nada.
  @Post('preparar')
  preparar(@Req() req: any, @Body() body: { licitacion_id: number; guia_ids: number[] }) {
    return this.facturacion.preparar(
      String(req?.user?.id || ''),
      Number(body?.licitacion_id),
      Array.isArray(body?.guia_ids) ? body.guia_ids : [],
    );
  }

  // Emite la factura. Con `simular: true` (botón "Simular") solo devuelve lo
  // que se enviaría, sin llamar a Bsale.
  @Post('emitir')
  emitir(
    @Req() req: any,
    @Body()
    body: {
      licitacion_id: number;
      guia_ids: number[];
      fecha_emision?: string;
      dias_vencimiento?: number;
      forma_pago_id?: number;
      oc_numero?: string;
      huella?: string;
      simular?: boolean;
    },
  ) {
    return this.facturacion.emitir(
      { id: String(req?.user?.id || ''), email: String(req?.user?.email || '').trim().toLowerCase() },
      body,
    );
  }
}
