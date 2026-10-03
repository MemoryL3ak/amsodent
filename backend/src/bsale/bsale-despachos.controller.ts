import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { BsaleDespachosService } from './bsale-despachos.service';

// Guías de despacho y órdenes (notas de venta) en Bsale, desde el módulo
// Facturación. Exige sesión; el rol lo decide el servicio (BSALE_EMISION_ROLES).
@Controller('bsale/despachos')
@UseGuards(AuthGuard)
export class BsaleDespachosController {
  constructor(private despachos: BsaleDespachosService) {}

  // Órdenes de compra de cotizaciones adjudicadas y abiertas.
  @Get('pendientes')
  pendientes(@Req() req: any) {
    return this.despachos.pendientes(String(req?.user?.id || ''));
  }

  // Borrador de la guía (qué falta por despachar según Bsale). No escribe nada.
  @Post('guia/preparar')
  prepararGuia(@Req() req: any, @Body() body: { licitacion_id: number; oc_doc_id: number }) {
    return this.despachos.prepararGuia(String(req?.user?.id || ''), Number(body?.licitacion_id), Number(body?.oc_doc_id));
  }

  // Emite la guía (o la simula con `simular: true`).
  @Post('guia/emitir')
  emitirGuia(@Req() req: any, @Body() body: any) {
    return this.despachos.emitirGuia({ id: String(req?.user?.id || ''), email: String(req?.user?.email || '').trim().toLowerCase() }, body);
  }

  // Borrador de la orden (nota de venta). No escribe nada.
  @Post('orden/preparar')
  prepararOrden(@Req() req: any, @Body() body: { licitacion_id: number; oc_doc_id: number }) {
    return this.despachos.prepararOrden(String(req?.user?.id || ''), Number(body?.licitacion_id), Number(body?.oc_doc_id));
  }

  // Registra la orden en Bsale (o la simula).
  @Post('orden/emitir')
  emitirOrden(@Req() req: any, @Body() body: any) {
    return this.despachos.emitirOrden({ id: String(req?.user?.id || ''), email: String(req?.user?.email || '').trim().toLowerCase() }, body);
  }
}
