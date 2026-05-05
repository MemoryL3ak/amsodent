import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { FeriadosService } from './feriados.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('feriados')
@UseGuards(AuthGuard)
export class FeriadosController {
  constructor(private feriadosService: FeriadosService) {}

  @Get(':year')
  async getYear(@Param('year', ParseIntPipe) year: number) {
    const feriados = await this.feriadosService.getYear(year);
    return { year, feriados };
  }
}
