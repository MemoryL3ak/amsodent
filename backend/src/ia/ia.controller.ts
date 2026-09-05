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
import { Throttle } from '@nestjs/throttler';
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
  @Throttle({ default: { ttl: 60_000, limit: 6 } }) // visión es lo más caro: 6/min por IP
  @UseInterceptors(FileInterceptor('file'))
  async extraerDocumento(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Falta el archivo a leer.');
    }
    // Tope de tamaño y tipos (contención auditoría 2026-09-04): antes cualquier
    // archivo de hasta 8 MB llegaba directo a la API de visión.
    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('El archivo supera el máximo de 10 MB.');
    }
    const mime = String(file.mimetype || '').toLowerCase();
    if (!/^(application\/pdf|image\/(png|jpe?g|webp|gif))$/.test(mime)) {
      throw new BadRequestException('Solo se aceptan PDF o imágenes (PNG/JPG/WebP).');
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

  // Centro de Ayuda: DamarIA como guía de la plataforma, disponible para TODO
  // usuario autenticado (no solo admin). Responde con el manual operativo, sin
  // acceso a SQL ni datos de negocio. SSE con el mismo patrón que /consultar.
  @Post('ayuda')
  @UseGuards(AuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 15 } }) // cuota por IP: protege la API key
  async ayuda(
    @Body()
    body: {
      pregunta?: string;
      historial?: { role?: string; content?: string }[];
      usuario?: string;
      rol?: string;
      modulos?: string[];
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

    const historial = (Array.isArray(body?.historial) ? body.historial : [])
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content)
      .map((h) => ({ role: String(h.role), content: String(h.content || '') }))
      .slice(-8);
    const usuario = String(body?.usuario || '').trim().slice(0, 80);
    const rol = String(body?.rol || '').trim().slice(0, 40);
    const modulos = (Array.isArray(body?.modulos) ? body.modulos : [])
      .map((m) => String(m || '').trim())
      .filter(Boolean)
      .slice(0, 40);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const emit = (evento: any) => {
      res.write(`data: ${JSON.stringify(evento)}\n\n`);
    };

    try {
      await this.ia.ayudaStream(pregunta, emit, { historial, usuario, rol, modulos });
    } catch (e: any) {
      emit({ tipo: 'error', mensaje: e?.message || 'Error desconocido.' });
    } finally {
      res.end();
    }
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
