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
import { BitacoraService } from './bitacora.service';

@Controller('bitacora-cotizaciones')
@UseGuards(AuthGuard)
export class BitacoraController {
  constructor(private readonly service: BitacoraService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  crear(@Req() req: Request & { user: any }, @Body() body: any) {
    const email = (req.user?.email || '').toLowerCase();
    const nombre =
      req.user?.user_metadata?.nombre ||
      req.user?.user_metadata?.full_name ||
      req.user?.user_metadata?.name ||
      null;
    return this.service.crear({
      id_cotizacion: String(body?.id_cotizacion || '').trim(),
      estado: body?.estado || 'Pendiente',
      observaciones: body?.observaciones ?? null,
      creado_por_email: email,
      creado_por_nombre: body?.creado_por_nombre || nombre,
    });
  }

  @Put(':id')
  actualizar(@Param('id') id: string, @Req() req: Request & { user: any }, @Body() body: any) {
    const email = (req.user?.email || '').toLowerCase();
    const nombre =
      req.user?.user_metadata?.nombre ||
      req.user?.user_metadata?.full_name ||
      req.user?.user_metadata?.name ||
      null;
    return this.service.actualizar(id, {
      estado: body?.estado,
      observaciones: body?.observaciones,
      actualizado_por_email: email,
      actualizado_por_nombre: body?.actualizado_por_nombre || nombre,
    });
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
