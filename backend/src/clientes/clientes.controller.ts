import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { AuthGuard } from '../auth/auth.guard';

// El id de clientes puede ser numérico (bigint) o uuid según el historial
// de la tabla en Supabase, así que no validamos con ParseIntPipe — Supabase
// resuelve la comparación con .eq('id', ...) en ambos casos.
@Controller('clientes')
@UseGuards(AuthGuard)
export class ClientesController {
  constructor(private clientesService: ClientesService) {}

  @Get()
  findAll() {
    return this.clientesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientesService.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.clientesService.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.clientesService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientesService.remove(id);
  }
}
