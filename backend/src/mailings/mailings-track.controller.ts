import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { MailingsService } from './mailings.service';

// 1×1 GIF transparente (43 bytes) — la respuesta cuando el cliente del
// destinatario carga el tracking pixel. Sin auth: cualquiera con el token
// puede gatillar la apertura, pero es necesario porque el cliente de correo
// no envía el token de Bearer.
const TRANSPARENT_GIF_B64 =
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

@Controller('mailings/track')
export class MailingsTrackController {
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
    if (token) {
      try {
        await this.mailingsService.registrarApertura(token, userAgent);
      } catch (_) {
        // No interrumpimos la respuesta del pixel si el log falla.
      }
    }
    const buf = Buffer.from(TRANSPARENT_GIF_B64, 'base64');
    res.set('Content-Type', 'image/gif');
    res.set('Content-Length', String(buf.length));
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.status(200).send(buf);
  }
}
