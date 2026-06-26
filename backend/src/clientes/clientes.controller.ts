import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientesService } from './clientes.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

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

  // ── Contactos clave (rutas literales antes de ':id' para evitar colisiones) ──
  @Put('contactos/:contactoId')
  actualizarContacto(@Param('contactoId') contactoId: string, @Body() body: any) {
    return this.clientesService.actualizarContacto(contactoId, body);
  }

  @Delete('contactos/:contactoId')
  eliminarContacto(@Param('contactoId') contactoId: string) {
    return this.clientesService.eliminarContacto(contactoId);
  }

  @Put('contactos/:contactoId/foto')
  @UseInterceptors(FileInterceptor('file'))
  subirFotoContacto(@Param('contactoId') contactoId: string, @UploadedFile() file: any) {
    return this.clientesService.subirFotoContacto(contactoId, file);
  }

  // ── Perfil 360° y contactos por cliente ──
  @Get(':id/comercial')
  perfilComercial(@Param('id') id: string) {
    return this.clientesService.perfilComercial(id);
  }

  @Put(':id/foto')
  @UseInterceptors(FileInterceptor('file'))
  subirFotoCliente(@Param('id') id: string, @UploadedFile() file: any) {
    return this.clientesService.subirFotoCliente(id, file);
  }

  @Get(':id/contactos')
  listarContactos(@Param('id') id: string) {
    return this.clientesService.listarContactos(id);
  }

  @Post(':id/contactos')
  crearContacto(@Param('id') id: string, @Body() body: any) {
    return this.clientesService.crearContacto(id, body);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientesService.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.clientesService.create(body);
  }

  // Creación rápida (bitácora): datos mínimos → cliente transitorio.
  @Post('rapido')
  crearRapido(@Body() body: any) {
    return this.clientesService.crearRapido(body);
  }

  // Override del bloqueo por mora (desbloqueo manual). Solo admin.
  @Put(':id/cobranza-desbloqueo')
  @UseGuards(AdminGuard)
  setCobranzaDesbloqueo(@Param('id') id: string, @Body() body: { desbloqueado: boolean }) {
    return this.clientesService.setCobranzaDesbloqueo(id, !!body?.desbloqueado);
  }

  // Override manual del estado de cobranza: 'bloqueado' | 'desbloqueado' | null. Solo admin.
  @Put(':id/cobranza-override')
  @UseGuards(AdminGuard)
  setCobranzaOverride(@Param('id') id: string, @Body() body: { override?: string | null }) {
    return this.clientesService.setCobranzaOverride(id, body?.override ?? null);
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
