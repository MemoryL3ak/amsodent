import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActividadesService } from './actividades.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('actividades')
@UseGuards(AuthGuard)
export class ActividadesController {
  constructor(private actividades: ActividadesService) {}

  @Get()
  listar(
    @Req() req: any,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('email') email?: string,
    @Query('cliente_id') cliente_id?: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.actividades.listar(req.user, { desde, hasta, email, cliente_id, tipo, estado });
  }

  @Get('usuarios')
  usuarios(@Req() req: any) {
    return this.actividades.usuarios(req.user);
  }

  @Post()
  crear(@Req() req: any, @Body() body: any) {
    return this.actividades.crear(req.user, body);
  }

  @Put(':id')
  actualizar(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.actividades.actualizar(req.user, id, body);
  }

  @Delete(':id')
  eliminar(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.actividades.eliminar(req.user, id);
  }
}
