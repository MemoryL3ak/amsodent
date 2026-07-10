import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, UseGuards, Req,
} from '@nestjs/common';
import { ProveedoresService } from './proveedores.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('proveedores')
@UseGuards(AuthGuard)
export class ProveedoresController {
  constructor(private proveedores: ProveedoresService) {}

  @Get()
  listar() {
    return this.proveedores.listar();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.proveedores.findOne(id);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.proveedores.create(body, email);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.proveedores.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.proveedores.remove(id);
  }
}
