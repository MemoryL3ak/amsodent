import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { MailingsService } from './mailings.service';
import { AdminGuard } from '../auth/admin.guard';
import { SupabaseService } from '../supabase/supabase.service';

const FLYER_CID = 'flyer-amsodent';

type SorteoMailingDto = {
  asunto?: string;
  cuerpoHtml?: string;
  // Filtros sobre sorteo_participantes:
  soloAceptaron?: boolean; // default true → only acepta_comunicaciones=true
  tipoPerfil?: 'estudiante' | 'egresado' | null;
  especialidades?: string[]; // si vacío, ninguno
  emailsExtra?: string[]; // correos adicionales pegados manualmente
};

@Controller('mailings')
@UseGuards(AdminGuard)
export class MailingsController {
  constructor(
    private mailingsService: MailingsService,
    private supabase: SupabaseService,
  ) {}

  @Post('sorteo')
  async enviarASorteo(@Body() body: SorteoMailingDto) {
    const asunto = String(body?.asunto || '').trim();
    const cuerpoHtml = String(body?.cuerpoHtml || '').trim();
    if (!asunto) throw new BadRequestException('Falta el asunto.');
    if (!cuerpoHtml) throw new BadRequestException('Falta el cuerpo del correo.');

    let query = this.supabase
      .getClient()
      .from('sorteo_participantes')
      .select('email, acepta_comunicaciones, tipo_perfil, especialidad');

    const soloAceptaron = body?.soloAceptaron !== false; // default true
    if (soloAceptaron) {
      query = query.eq('acepta_comunicaciones', true);
    }
    if (body?.tipoPerfil === 'estudiante' || body?.tipoPerfil === 'egresado') {
      query = query.eq('tipo_perfil', body.tipoPerfil);
    }
    if (Array.isArray(body?.especialidades) && body.especialidades.length > 0) {
      query = query.in('especialidad', body.especialidades);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const correosDB = (data || [])
      .map((r: any) => String(r?.email || '').trim().toLowerCase())
      .filter(Boolean);

    const correosExtra = Array.isArray(body?.emailsExtra)
      ? body.emailsExtra.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
      : [];

    const destinatarios = Array.from(new Set([...correosDB, ...correosExtra]));

    const result = await this.mailingsService.sendBulkBCC({
      destinatarios,
      asunto,
      cuerpoHtml,
    });

    return result;
  }

  // Envío genérico a destinatarios pegados a mano (sin filtros sobre DB).
  // Acepta JSON puro o multipart con:
  //   * campo `flyer`     → imagen (PNG/JPG) embebida inline (cid:flyer-amsodent)
  //   * campo `attachment`→ archivo descargable (PDF, etc.) como adjunto regular
  // Si el `cuerpoHtml` ya contiene la referencia `cid:flyer-amsodent` (porque
  // el frontend armó él mismo el HTML enriquecido), no se hace auto-inyección.
  @Post('custom')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'flyer', maxCount: 1 },
      { name: 'attachment', maxCount: 1 },
    ]),
  )
  async enviarCustom(
    @Body() body: any,
    @Req() req: any,
    @UploadedFiles()
    files?: { flyer?: Express.Multer.File[]; attachment?: Express.Multer.File[] },
  ) {
    const flyer = files?.flyer?.[0];
    const attachment = files?.attachment?.[0];

    const asunto = String(body?.asunto || '').trim();
    let cuerpoHtml = String(body?.cuerpoHtml || '').trim();
    const remitenteNombre = body?.remitenteNombre ? String(body.remitenteNombre) : undefined;
    const flyerPosicion = String(body?.flyerPosicion || 'arriba'); // "arriba" | "abajo"

    if (!asunto) throw new BadRequestException('Falta el asunto.');

    // Destinatarios pueden venir como array (JSON) o como string JSON / CSV (multipart).
    let destinatarios: string[] = [];
    if (Array.isArray(body?.destinatarios)) {
      destinatarios = body.destinatarios;
    } else if (typeof body?.destinatarios === 'string') {
      const raw = body.destinatarios.trim();
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) destinatarios = parsed;
      } catch {
        destinatarios = raw.split(/[\s,;\n]+/);
      }
    }
    destinatarios = destinatarios
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean);

    // Flyer inline (imagen): valida y embebe como CID.
    let inlineAttachments: any[] | undefined;
    if (flyer) {
      const mime = String(flyer.mimetype || '').toLowerCase();
      if (!mime.startsWith('image/')) {
        throw new BadRequestException(
          'El flyer debe ser una imagen (PNG/JPEG). Si subiste un PDF, convertilo a imagen antes.',
        );
      }
      // Sólo auto-inyectamos el <img> si el cuerpo NO referencia ya el CID.
      if (!cuerpoHtml.includes(`cid:${FLYER_CID}`)) {
        const imgTag = `<img src="cid:${FLYER_CID}" alt="" style="max-width:100%; height:auto; display:block; margin:0 auto;" />`;
        if (flyerPosicion === 'abajo') {
          cuerpoHtml = `${cuerpoHtml || ''}<br/>${imgTag}`;
        } else {
          cuerpoHtml = `${imgTag}${cuerpoHtml ? `<br/>${cuerpoHtml}` : ''}`;
        }
      }
      inlineAttachments = [
        {
          filename: flyer.originalname || 'flyer.png',
          content: flyer.buffer,
          contentType: mime,
          cid: FLYER_CID,
        },
      ];
    }

    // Adjunto regular (PDF u otro): viaja como attachment descargable.
    let attachments: Array<{ filename: string; content: Buffer; contentType?: string }> | undefined;
    if (attachment) {
      attachments = [
        {
          filename: attachment.originalname || 'documento',
          content: attachment.buffer,
          contentType: String(attachment.mimetype || 'application/octet-stream'),
        },
      ];
    }

    if (!cuerpoHtml.trim()) throw new BadRequestException('Falta el cuerpo del correo.');

    // conTracking: por defecto true (envío individual con pixel por persona).
    // Si el cliente manda explícitamente "false" → modo BCC rápido sin tracking.
    const conTrackingRaw = body?.conTracking;
    const conTracking =
      conTrackingRaw === false ||
      conTrackingRaw === 'false' ||
      conTrackingRaw === '0'
        ? false
        : true;

    return this.mailingsService.sendBulkBCC({
      destinatarios,
      asunto,
      cuerpoHtml,
      remitenteNombre,
      inlineAttachments,
      attachments,
      conTracking,
      creadoPor: req?.user?.email || null,
    });
  }

  // Lista de envíos (para historial/admin)
  @Get('envios')
  async listarEnvios() {
    return this.mailingsService.listarEnvios(100);
  }

  // Detalle de un envío con los destinatarios y su estado de apertura.
  @Get('envios/:id')
  async detalleEnvio(@Param('id', ParseIntPipe) id: number) {
    const detalle = await this.mailingsService.getEnvioDetalle(id);
    if (!detalle) throw new BadRequestException(`Envío ${id} no encontrado.`);
    return detalle;
  }

  @Delete('envios/:id')
  async eliminarEnvio(@Param('id', ParseIntPipe) id: number) {
    return this.mailingsService.eliminarEnvio(id);
  }

  // Emails que abrieron el último envío (para cruzar con sorteo / clientes)
  @Get('aperturas/ultimo-envio')
  async aperturasUltimoEnvio() {
    return this.mailingsService.getEmailsAbiertosDelUltimoEnvio();
  }

  // Para preview de cantidad antes de enviar.
  @Post('sorteo/preview')
  async previewSorteo(@Body() body: SorteoMailingDto) {
    let query = this.supabase
      .getClient()
      .from('sorteo_participantes')
      .select('email', { count: 'exact', head: false });

    const soloAceptaron = body?.soloAceptaron !== false;
    if (soloAceptaron) query = query.eq('acepta_comunicaciones', true);
    if (body?.tipoPerfil === 'estudiante' || body?.tipoPerfil === 'egresado') {
      query = query.eq('tipo_perfil', body.tipoPerfil);
    }
    if (Array.isArray(body?.especialidades) && body.especialidades.length > 0) {
      query = query.in('especialidad', body.especialidades);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const desdeDB = new Set(
      (data || [])
        .map((r: any) => String(r?.email || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const extra = (body?.emailsExtra || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean);
    extra.forEach((e) => desdeDB.add(e));

    return { total: desdeDB.size };
  }
}
