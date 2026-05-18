import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PlantillasService } from './plantillas.service';

@Controller('plantillas-correo')
@UseGuards(AuthGuard)
export class PlantillasController {
  constructor(private service: PlantillasService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  crear(@Req() req: Request & { user: any }, @Body() body: any) {
    const email = (req.user?.email || '').toLowerCase();
    return this.service.crear(body, email);
  }

  @Put(':id')
  actualizar(@Param('id') id: string, @Body() body: any) {
    return this.service.actualizar(id, body);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
