import { Body, Controller, Get, Headers, Param, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TiendaWebService } from './tienda-web.service';
import { claveValida } from './tienda-web.logica';

/* Integración con la tienda web amsodentmedical.cl (2026-11-26).
   NO lleva AuthGuard: quien llama es el servidor de la tienda, sin sesión de
   Supabase. Se protege con una clave compartida en la cabecera
   `Authorization: Bearer <TIENDA_WEB_API_KEY>` (comparación en tiempo
   constante). Sin TIENDA_WEB_API_KEY el endpoint queda CERRADO. */
@Controller('tienda-web')
export class TiendaWebController {
  constructor(private tienda: TiendaWebService) {}

  private autenticar(authorization: string | undefined) {
    const esperada = (process.env.TIENDA_WEB_API_KEY || '').trim();
    if (esperada.length < 32) throw new ServiceUnavailableException('La integración con la tienda web no está habilitada en el servidor.');
    const m = /^Bearer\s+(.+)$/i.exec(String(authorization || '').trim());
    if (!m || !claveValida(m[1].trim(), esperada)) throw new UnauthorizedException('Clave de integración inválida.');
  }

  // Un pedido pagado de la tienda → su boleta o factura en Bsale (idempotente por N° de pedido).
  @Post('pedidos')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  recibir(@Headers('authorization') authorization: string | undefined, @Body() body: any) {
    this.autenticar(authorization);
    return this.tienda.recibir(body);
  }

  // Estado de un pedido ya enviado (para conciliar desde la tienda).
  @Get('pedidos/:pedido')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  estado(@Headers('authorization') authorization: string | undefined, @Param('pedido') pedido: string) {
    this.autenticar(authorization);
    return this.tienda.estado(pedido);
  }
}
