import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  UseGuards,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { IaService } from './ia.service';

@Controller('ia')
export class IaController {
  constructor(private readonly ia: IaService) {}

  // Lee un documento (PDF/imagen) con la visión de Claude y devuelve sus
  // datos para precargar formularios (Trazabilidad). Disponible para todo el
  // equipo autenticado: es quien digita facturas/guías a diario.
  @Post('extraer-documento')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async extraerDocumento(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Falta el archivo a leer.');
    }
    const datos = await this.ia.extraerDocumento(file.buffer, file.mimetype || '');
    return { ok: true, datos };
  }

  @Get('estado')
  @UseGuards(AdminGuard)
  estado() {
    return { configurada: this.ia.configurada() };
  }

  // Voz natural de DamarIA: texto → audio MP3 (ElevenLabs vía backend, la
  // key nunca sale del servidor). El widget cae a la voz del navegador si
  // esto responde que no está configurado.
  @Get('voz/estado')
  @UseGuards(AdminGuard)
  vozEstado() {
    return { natural: this.ia.vozNaturalConfigurada() };
  }

  @Post('voz')
  @UseGuards(AdminGuard)
  async voz(@Body() body: { texto?: string }, @Res() res: Response) {
    const audio = await this.ia.sintetizarVoz(String(body?.texto || ''));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio);
  }

  // Recomendación estratégica de precios para el Simulador (panel Análisis
  // Mercado Público, solo admin): DamarIA interpreta la curva y el historial.
  @Post('recomendacion-precios')
  @UseGuards(AdminGuard)
  async recomendacionPrecios(@Body() body: { resumen?: any }) {
    const recomendacion = await this.ia.recomendacionPrecios(body?.resumen);
    return { ok: true, recomendacion };
  }

  // Endpoint SSE: emite eventos a medida que DamarIA piensa, consulta y
  // redacta la respuesta. El frontend lee el stream para mostrar el resumen
  // letra por letra y bajar la latencia percibida.
  @Post('consultar')
  @UseGuards(AdminGuard)
  async consultar(
    @Body()
    body: {
      pregunta?: string;
      historial?: { role?: string; content?: string }[];
      usuario?: string;
      contexto?: string;
    },
    @Res() res: Response,
  ) {
    const pregunta = String(body?.pregunta || '').trim();
    if (!pregunta) {
      throw new BadRequestException('Falta la pregunta para DamarIA.');
    }
    if (pregunta.length > 1000) {
      throw new BadRequestException('La pregunta es demasiado larga.');
    }

    // Historial de conversación (memoria): saneamos y limitamos tamaño.
    const historial = (Array.isArray(body?.historial) ? body.historial : [])
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content)
      .map((h) => ({ role: String(h.role), content: String(h.content || '') }))
      .slice(-8);
    const usuario = String(body?.usuario || '').trim().slice(0, 80);
    // Contexto opcional del panel desde el que se invoca a DamarIA (p. ej. el
    // resumen del Análisis Mercado Público) — se inyecta al system prompt.
    const contexto = String(body?.contexto || '').slice(0, 15000);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const emit = (evento: any) => {
      res.write(`data: ${JSON.stringify(evento)}\n\n`);
    };

    try {
      await this.ia.consultarStream(pregunta, emit, { historial, usuario, contexto });
    } catch (e: any) {
      emit({ tipo: 'error', mensaje: e?.message || 'Error desconocido.' });
    } finally {
      res.end();
    }
  }
}
