import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, ParseIntPipe, UseGuards, Req,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LicitacionesService } from './licitaciones.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('licitaciones')
@UseGuards(AuthGuard)
export class LicitacionesController {
  constructor(private licitacionesService: LicitacionesService) {}

  @Get()
  findAll(@Query() filters: any) {
    return this.licitacionesService.findAll(filters);
  }

  @Get('with-fields')
  findAllWithFields(@Query('fields') fields: string) {
    return this.licitacionesService.findAllWithFields(fields || '*');
  }

  // Próximo correlativo (max(id) + 1). Aproximado: si otra persona inserta entre
  // el preview y el guardado, el id real puede diferir. El frontend lo confirma
  // tras el INSERT.
  @Get('next-id')
  nextId() {
    return this.licitacionesService.getNextId();
  }

  // Estado de bloqueo por mora de un cliente (para pre-check al cotizar).
  @Get('cliente-mora')
  clienteMora(@Query('rut') rut: string, @Query('tipo') tipo?: string) {
    return this.licitacionesService.estadoBloqueoCliente(rut, tipo);
  }

  // Mora por lote de ruts (para la lista de clientes).
  @Post('clientes-mora')
  clientesMora(@Body() body: { ruts: string[] }) {
    return this.licitacionesService.moraPorRuts(body?.ruts || []);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.licitacionesService.create(body);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    const aprobadorEmail = (req?.user?.email || '').toLowerCase();
    return this.licitacionesService.update(id, body, aprobadorEmail);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.remove(id);
  }

  // Items
  @Get(':id/items')
  getItems(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.getItems(id);
  }

  @Post(':id/items')
  insertItems(@Param('id', ParseIntPipe) id: number, @Body() body: { items: any[] }) {
    const items = body.items.map((it) => ({ ...it, licitacion_id: id }));
    return this.licitacionesService.insertItems(items);
  }

  @Put(':id/items')
  upsertItems(@Body() body: { items: any[] }) {
    return this.licitacionesService.upsertItems(body.items);
  }

  @Post('items/filter')
  getItemsByFilter(@Body() body: { licitacion_ids: number[]; fields?: string }) {
    return this.licitacionesService.getItemsByFilter(body.licitacion_ids, body.fields);
  }

  @Put('items/:itemId')
  updateItem(@Param('itemId', ParseIntPipe) itemId: number, @Body() body: any) {
    return this.licitacionesService.updateItem(itemId, body);
  }

  @Delete('items/:itemId')
  deleteItem(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.licitacionesService.deleteItem(itemId);
  }

  // Documentos
  @Get(':id/documentos')
  getDocumentos(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.getDocumentos(id);
  }

  @Post('documentos/filter')
  getDocumentosByFilter(@Body() body: { filter: Record<string, any>; fields?: string }) {
    return this.licitacionesService.getDocumentosByFilter(body.filter, body.fields);
  }

  @Post('documentos')
  createDocumento(@Body() body: any) {
    return this.licitacionesService.createDocumento(body);
  }

  @Put('documentos/:docId')
  updateDocumento(@Param('docId', ParseIntPipe) docId: number, @Body() body: any) {
    return this.licitacionesService.updateDocumento(docId, body);
  }

  @Delete('documentos/:docId')
  deleteDocumento(@Param('docId', ParseIntPipe) docId: number) {
    return this.licitacionesService.deleteDocumento(docId);
  }

  // Storage
  @Post('storage/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('bucket') bucket: string,
    @Query('path') path: string,
  ) {
    return this.licitacionesService.uploadDocFile(bucket, path, file.buffer, file.mimetype);
  }

  @Get('storage/signed-url')
  getSignedUrl(@Query('bucket') bucket: string, @Query('path') path: string) {
    return this.licitacionesService.getSignedUrl(bucket, path);
  }

  @Delete('storage/file')
  removeFile(@Query('bucket') bucket: string, @Query('path') path: string) {
    return this.licitacionesService.removeFile(bucket, path);
  }
}
