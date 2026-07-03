import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, UseGuards, Req,
} from '@nestjs/common';
import { OrdenesCompraService } from './ordenes-compra.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('ordenes-compra')
@UseGuards(AuthGuard)
export class OrdenesCompraController {
  constructor(private ordenesService: OrdenesCompraService) {}

  @Get()
  listar() {
    return this.ordenesService.listar();
  }

  @Get('next-numero')
  nextNumero() {
    return this.ordenesService.getNextNumero();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordenesService.findOne(id);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.ordenesService.create(body, email);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.ordenesService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.ordenesService.remove(id);
  }
}
