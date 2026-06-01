import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { IaService } from './ia.service';

@Controller('ia')
export class IaController {
  constructor(private readonly ia: IaService) {}

  @Get('estado')
  @UseGuards(AdminGuard)
  estado() {
    return { configurada: this.ia.configurada() };
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

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const emit = (evento: any) => {
      res.write(`data: ${JSON.stringify(evento)}\n\n`);
    };

    try {
      await this.ia.consultarStream(pregunta, emit, { historial, usuario });
    } catch (e: any) {
      emit({ tipo: 'error', mensaje: e?.message || 'Error desconocido.' });
    } finally {
      res.end();
    }
  }
}
