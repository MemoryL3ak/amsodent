import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, ParseIntPipe, UseGuards, Req,
  UseInterceptors, UploadedFile, ForbiddenException,
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

  /* ── Licitaciones disponibles (listado para tomar/cargar) ── */
  @Get('disponibles')
  listarDisponibles() {
    return this.licitacionesService.listarDisponibles();
  }

  @Post('disponibles/bulk')
  bulkDisponibles(@Body() body: { rows: any[]; origen?: string }, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    // 'exploracion' = toma directa en el Explorador MP (no aparece en el
    // Listado); cualquier otro valor cae al Listado de siempre.
    const origen = body?.origen === 'exploracion' ? 'exploracion' : 'listado';
    return this.licitacionesService.bulkDisponibles(body?.rows || [], email, origen);
  }

  // Revisa contra Mercado Público si nuestro RUT ya figura entre los oferentes.
  // Se llama por tandas desde la pantalla, que muestra el avance.
  @Post('disponibles/verificar-postulacion')
  verificarPostulaciones(@Body() body: any) {
    return this.licitacionesService.verificarPostulaciones(body || {});
  }

  @Put('disponibles/:dispId/cargar')
  marcarDisponibleCargada(@Param('dispId', ParseIntPipe) dispId: number, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.licitacionesService.marcarDisponibleCargada(dispId, email);
  }

  @Put('disponibles/:dispId/descargar')
  desmarcarDisponible(@Param('dispId', ParseIntPipe) dispId: number) {
    return this.licitacionesService.desmarcarDisponible(dispId);
  }

  @Delete('disponibles/todas')
  eliminarTodasDisponibles() {
    return this.licitacionesService.eliminarTodasDisponibles();
  }

  @Put('disponibles/:dispId/tomar')
  tomarDisponible(
    @Param('dispId', ParseIntPipe) dispId: number,
    @Body() body: { tomar: boolean },
    @Req() req: any,
  ) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.licitacionesService.tomarDisponible(dispId, email, !!body?.tomar);
  }

  @Put('disponibles/:dispId/no-aplica')
  noAplicaDisponible(
    @Param('dispId', ParseIntPipe) dispId: number,
    @Body() body: { noAplica: boolean },
    @Req() req: any,
  ) {
    const email = (req?.user?.email || '').toLowerCase();
    return this.licitacionesService.noAplicaDisponible(dispId, email, !!body?.noAplica);
  }

  @Delete('disponibles/:dispId')
  eliminarDisponible(@Param('dispId', ParseIntPipe) dispId: number) {
    return this.licitacionesService.eliminarDisponible(dispId);
  }

  // Buscador de procesos en Mercado Público (sección Explorar). Debe ir ANTES
  // de 'mercado-publico/:codigo' para que "buscar" no se tome como código.
  //
  // Restringido: la búsqueda completa son ~90 consultas contra la API (~4 min
  // y cuota compartida con la sincronización del Análisis). Para el resto del
  // equipo el resultado se genera solo (14:00 y 23:00) y se lee de
  // 'mercado-publico/exploracion'.
  @Get('mercado-publico/buscar')
  mercadoPublicoBuscar(@Query() query: any, @Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    if (!LicitacionesService.exploradoresMp().includes(email)) {
      throw new ForbiddenException(
        'La búsqueda manual está restringida: consume la cuota diaria de la API. El listado se actualiza solo a las 14:00 y 23:00.',
      );
    }
    return this.licitacionesService.mercadoPublicoBuscar(query || {});
  }

  // Última exploración automática guardada. Para todo el equipo: leerla no
  // consulta la API. Devuelve además si quien pregunta puede buscar a mano.
  @Get('mercado-publico/exploracion')
  async exploracionMp(@Req() req: any) {
    const email = (req?.user?.email || '').toLowerCase();
    const guardada = await this.licitacionesService.exploracionGuardada();
    return {
      ...(guardada || { items: null }),
      puede_buscar: LicitacionesService.exploradoresMp().includes(email),
    };
  }

  /* Catálogo de palabras clave y búsquedas guardadas del explorador. Van antes
     de 'mercado-publico/:codigo' por la misma razón que 'buscar'. */
  @Get('mercado-publico/keywords')
  listarKeywordsMp() {
    return this.licitacionesService.listarKeywordsMp();
  }

  @Post('mercado-publico/keywords')
  crearKeywordMp(@Body() body: any, @Req() req: any) {
    return this.licitacionesService.crearKeywordMp(body?.texto, (req?.user?.email || '').toLowerCase());
  }

  @Delete('mercado-publico/keywords/:id')
  eliminarKeywordMp(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.eliminarKeywordMp(id);
  }

  @Post('mercado-publico/busquedas')
  guardarBusquedaMp(@Body() body: any, @Req() req: any) {
    return this.licitacionesService.guardarBusquedaMp(
      body?.nombre, body?.keywords, (req?.user?.email || '').toLowerCase(),
    );
  }

  @Delete('mercado-publico/busquedas/:id')
  eliminarBusquedaMp(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.eliminarBusquedaMp(id);
  }

  // Ficha en vivo desde Mercado Público (proxy: el ticket vive solo en el
  // backend). Debe declararse ANTES de @Get(':id').
  @Get('mercado-publico/:codigo')
  mercadoPublicoDetalle(@Param('codigo') codigo: string) {
    return this.licitacionesService.mercadoPublicoDetalle(codigo);
  }

  @Get(':id/hijas')
  getHijas(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.getHijas(id);
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

  // Avisa a los admin que la cotización quedó "Pendiente Aprobación Peso"
  // (productos sin peso registrado). Lo llama el frontend tras guardar.
  @Post(':id/notificar-peso')
  notificarPeso(@Param('id', ParseIntPipe) id: number) {
    return this.licitacionesService.notificarAprobacionPeso(id);
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
