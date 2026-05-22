import { Controller, Get, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
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

  @Post('consultar')
  @UseGuards(AdminGuard)
  async consultar(@Body() body: { pregunta?: string }) {
    const pregunta = String(body?.pregunta || '').trim();
    if (!pregunta) {
      throw new BadRequestException('Falta la pregunta para DamarIA.');
    }
    if (pregunta.length > 1000) {
      throw new BadRequestException('La pregunta es demasiado larga.');
    }
    return this.ia.consultar(pregunta);
  }
}
