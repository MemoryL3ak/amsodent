import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { ComisionesService } from './comisiones.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('comisiones')
@UseGuards(AuthGuard)
export class ComisionesController {
  constructor(private comisionesService: ComisionesService) {}

  @Get('config')
  getConfig() {
    return this.comisionesService.getConfig();
  }

  @Put('config')
  saveConfig(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.comisionesService.saveConfig(body, email);
  }
}
