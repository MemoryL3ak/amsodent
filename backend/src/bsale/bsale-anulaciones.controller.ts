import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { BsaleAnulacionesService } from './bsale-anulaciones.service';

// Anulación de facturas y boletas con nota de crédito en Bsale, desde el
// módulo Facturación. Exige sesión; el rol lo decide el servicio.
@Controller('bsale/anulaciones')
@UseGuards(AuthGuard)
export class BsaleAnulacionesController {
  constructor(private anulaciones: BsaleAnulacionesService) {}

  // El documento a anular (por id de Bsale, documento del sistema o tipo + N°) y si se puede.
  @Get('preparar')
  preparar(@Req() req: any, @Query() q: any) {
    return this.anulaciones.preparar(String(req?.user?.id || ''), {
      bsale_id: q?.bsale_id, documento_id: q?.documento_id, tipo: q?.tipo, numero: q?.numero,
    });
  }

  // Simula (simular: true) o emite la nota de crédito.
  @Post('emitir')
  emitir(@Req() req: any, @Body() body: any) {
    return this.anulaciones.emitir({ id: String(req?.user?.id || ''), email: String(req?.user?.email || '').trim().toLowerCase() }, body);
  }
}
