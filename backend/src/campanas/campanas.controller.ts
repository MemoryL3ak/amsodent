import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, UseGuards, Req,
} from '@nestjs/common';
import { CampanasService } from './campanas.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('campanas')
@UseGuards(AuthGuard)
export class CampanasController {
  constructor(private campanasService: CampanasService) {}

  @Get()
  findAll() {
    return this.campanasService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.campanasService.findOne(id);
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.campanasService.create(body, req.user?.id || null);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.campanasService.update(id, body);
  }

  @Delete('items/:itemId')
  deleteItem(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.campanasService.deleteItem(itemId);
  }
}
