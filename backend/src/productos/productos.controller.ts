import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, UseGuards, Req,
  UseInterceptors, UploadedFile, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductosService } from './productos.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PreciosCambiosService } from './precios-cambios.service';

@Controller('productos')
@UseGuards(AuthGuard)
export class ProductosController {
  constructor(
    private productosService: ProductosService,
    private preciosCambios: PreciosCambiosService,
  ) {}

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

  /* (2026-11-05) Cambios de precio recientes (alerta de actualización de
     precio): Productos los usa para mostrar el «antes → después». El costo
     solo viaja a quien puede verlo (admin o permiso ver_costos). */
  @Get('precios/cambios')
  async cambiosDePrecio(@Req() req: any, @Query('dias') dias?: string) {
    return this.preciosCambios.recientes(Number(dias) || 30, await this.preciosCambios.puedeVerCostos(String(req?.user?.id || '')));
  }

  @Get(':id/precios-cambios')
  async cambiosDePrecioDeProducto(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.preciosCambios.deProducto(id, await this.preciosCambios.puedeVerCostos(String(req?.user?.id || '')));
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

  // Reenvía el producto a Bsale (lo crea allá si su SKU no existe).
  // (2026-10-07) Productos que aún no están en Bsale: simular o enviarlos todos.
  @Post('bsale/pendientes')
  @UseGuards(AdminGuard)
  pendientesBsale(@Body() body: { simular?: boolean; solo_sin_sku?: boolean }, @Req() req: any) {
    return this.productosService.pendientesBsale(body?.simular === true, req?.user?.email || null, body?.solo_sin_sku !== false);
  }

  @Get('bsale/pendientes/estado')
  @UseGuards(AdminGuard)
  estadoPendientesBsale() {
    return this.productosService.estadoPendientesBsale();
  }

  @Post(':id/bsale')
  reenviarABsale(@Param('id', ParseIntPipe) id: number) {
    return this.productosService.reenviarABsale(id);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.productosService.update(id, body, (req?.user?.email || '').toLowerCase());
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productosService.remove(id);
  }
}
