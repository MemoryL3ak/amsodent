import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MailingsService } from './mailings.service';
import { LimitadorAperturas, esTokenApertura } from '../comunidad/mailing-aperturas';

// 1×1 GIF transparente (43 bytes) — la respuesta cuando el cliente del
// destinatario carga el tracking pixel. Sin auth: cualquiera con el token
// puede gatillar la apertura, pero es necesario porque el cliente de correo
// no envía el token de Bearer.
const TRANSPARENT_GIF_B64 =
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF = Buffer.from(TRANSPARENT_GIF_B64, 'base64');

/* (2026-11-26) El píxel responde SIEMPRE su imagen: con un token que no existe,
   con la base caída o cuando alguien lo golpea de más. Por eso queda fuera del
   tope general de peticiones (que respondería 429 y dejaría una imagen rota en
   el correo; además los correos de Gmail llegan todos desde las mismas
   direcciones de Google) y lleva su propio freno, que solo decide si la carga
   llega o no a la base: ver LimitadorAperturas. */
@SkipThrottle()
@Controller('mailings/track')
export class MailingsTrackController {
  private limitador = new LimitadorAperturas();

  constructor(private mailingsService: MailingsService) {}

  @Get('open')
  async trackOpen(
    @Query('t') token: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const userAgent =
      typeof req?.headers?.['user-agent'] === 'string'
        ? String(req.headers['user-agent'])
        : '';
    try {
      const ip = String(req?.ip || req?.socket?.remoteAddress || '');
      if (esTokenApertura(token) && this.limitador.permitir(ip, token)) {
        await this.mailingsService.registrarApertura(token, userAgent);
      }
    } catch (_) {
      // No interrumpimos la respuesta del pixel si el registro falla.
    }
    res.set('Content-Type', 'image/gif');
    res.set('Content-Length', String(GIF.length));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.status(200).send(GIF);
  }
}
