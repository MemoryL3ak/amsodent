import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, UseGuards, Req,
  UseInterceptors, UploadedFile, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductosService } from './productos.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('productos')
@UseGuards(AuthGuard)
export class ProductosController {
  constructor(private productosService: ProductosService) {}

  @Get()
  findAll() {
    return this.productosService.findAll();
  }

  @Get('list')
  findAllList() {
    return this.productosService.findAllList();
  }

  @Get('campaign-prices')
  getCampaignPrices() {
    return this.productosService.getCampaignPrices();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productosService.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.productosService.create(body);
  }

  @Post('bulk-upsert')
  bulkUpsert(@Body() body: { rows: Record<string, any>[]; archivo?: string }, @Req() req: any) {
    return this.productosService.bulkUpsert(body?.rows || [], {
      archivo: body?.archivo,
      email: (req?.user?.email || '').toLowerCase(),
    });
  }

  /* ── Historial de cargas masivas ──────────────────────────────────────── */
  @Get('cargas/historial')
  listarCargas() {
    return this.productosService.listarCargas();
  }

  @Get('cargas/:id')
  detalleCarga(@Param('id', ParseIntPipe) id: number) {
    return this.productosService.detalleCarga(id);
  }

  // Revertir borra y sobrescribe productos del catálogo: solo admin.
  @Post('cargas/:id/revertir')
  @UseGuards(AdminGuard)
  revertirCarga(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.productosService.revertirHasta(id, (req?.user?.email || '').toLowerCase());
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(@UploadedFile() file: Express.Multer.File, @Query('sku') sku: string) {
    return this.productosService.uploadImage(file, sku);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.productosService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productosService.remove(id);
  }
}
