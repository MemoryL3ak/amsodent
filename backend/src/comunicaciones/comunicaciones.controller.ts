import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseIntPipe,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ComunicacionesService } from './comunicaciones.service';

@Controller('cotizaciones/:id/comunicaciones')
@UseGuards(AuthGuard)
export class ComunicacionesController {
  constructor(private readonly service: ComunicacionesService) {}

  // Listado del historial.
  @Get()
  listar(@Param('id', ParseIntPipe) licitacionId: number) {
    return this.service.listar(licitacionId);
  }

  // Respuestas: lee los hilos de Gmail correspondientes y devuelve los
  // mensajes recibidos (los que no envió el vendedor).
  @Get('respuestas')
  respuestas(@Param('id', ParseIntPipe) licitacionId: number) {
    return this.service.obtenerRespuestas(licitacionId);
  }

  // Marcar un mensaje específico como leído en Gmail.
  @Post(':comunicacionId/respuestas/:gmailMessageId/leida')
  marcarLeida(
    @Param('id', ParseIntPipe) licitacionId: number,
    @Param('comunicacionId', ParseIntPipe) comunicacionId: number,
    @Param('gmailMessageId') gmailMessageId: string,
  ) {
    return this.service.marcarRespuestaLeida(licitacionId, comunicacionId, gmailMessageId);
  }

  // Envío (o programación). multipart/form-data porque puede traer adjuntos.
  // Hasta 10 archivos. El nodemailer/gmail tienen límite ~25MB total.
  @Post()
  @UseInterceptors(FilesInterceptor('files', 10))
  enviar(
    @Param('id', ParseIntPipe) licitacionId: number,
    @Req() req: Request & { user: any },
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any,
  ) {
    const enviadoPor = (req.user?.email || '').toLowerCase();
    return this.service.enviar({
      licitacionId,
      enviadoPor,
      para: body?.para,
      cc: body?.cc,
      bcc: body?.bcc,
      asunto: String(body?.asunto || ''),
      cuerpoHtml: String(body?.cuerpo_html || body?.cuerpoHtml || ''),
      cuerpoTexto: body?.cuerpo_texto || body?.cuerpoTexto || undefined,
      programadoPara: body?.programado_para || body?.programadoPara || null,
      files: files || [],
      plantillaCodigo: body?.plantilla_codigo || body?.plantillaCodigo || null,
      triggerOrigen: 'manual',
    });
  }

  // Cancelar un programado.
  @Delete(':comunicacionId')
  cancelar(
    @Param('id', ParseIntPipe) licitacionId: number,
    @Param('comunicacionId', ParseIntPipe) comunicacionId: number,
  ) {
    return this.service.cancelarProgramado(licitacionId, comunicacionId);
  }

  // Disparar plantillas automáticas para esta cotización + trigger.
  // Llamado típicamente desde el frontend después de subir la primera OC.
  // Idempotente del lado del consumidor: si no quedan plantillas activas, devuelve enviados=0.
  @Post('trigger')
  disparar(
    @Param('id', ParseIntPipe) licitacionId: number,
    @Body() body: { trigger: 'adjudicacion_oc' | 'proximo_vencer' },
  ) {
    if (!body?.trigger) {
      return { enviados: 0, omitidos: 0, error: 'trigger requerido' };
    }
    return this.service.dispararPorTrigger({ licitacionId, trigger: body.trigger });
  }
}
