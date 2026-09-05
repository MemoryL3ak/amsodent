import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsuariosService } from './usuarios.service';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('usuarios')
@UseGuards(AuthGuard)
export class UsuariosController {
  constructor(private usuariosService: UsuariosService) {}

  @Get('profiles')
  getProfiles() {
    return this.usuariosService.getProfiles();
  }

  @Post('profiles/by-emails')
  getProfilesByEmails(@Body() body: { emails: string[] }) {
    return this.usuariosService.getProfilesByEmails(body.emails);
  }

  @Post('profiles/by-ids')
  getProfilesByIds(@Body() body: { ids: string[] }) {
    return this.usuariosService.getProfilesByIds(body.ids);
  }

  // Editar y eliminar perfiles cambia roles y accesos: SOLO admin
  // (contención auditoría 2026-09-04 — antes bastaba estar autenticado, lo que
  // permitía a cualquier usuario asignarse rol admin).
  @Put('profiles/:id')
  @UseGuards(AdminGuard)
  updateProfile(@Param('id') id: string, @Body() body: any) {
    return this.usuariosService.updateProfile(id, body);
  }

  @Delete('profiles/:id')
  @UseGuards(AdminGuard)
  deleteProfile(@Param('id') id: string) {
    return this.usuariosService.deleteProfile(id);
  }

  // Foto de perfil (avatar). El usuario sube la suya o un admin la asigna.
  @Put('profiles/:id/avatar')
  @UseInterceptors(FileInterceptor('file'))
  subirAvatar(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.usuariosService.subirAvatar(id, file);
  }

  // ── Perfiles de permisos (RBAC). Solo admin. ──
  @Get('perfiles')
  listarPerfiles() {
    return this.usuariosService.listarPerfiles();
  }

  @Post('perfiles')
  @UseGuards(AdminGuard)
  crearPerfil(@Body() body: any) {
    return this.usuariosService.crearPerfil(body);
  }

  @Put('perfiles/:id')
  @UseGuards(AdminGuard)
  actualizarPerfil(@Param('id') id: string, @Body() body: any) {
    return this.usuariosService.actualizarPerfil(id, body);
  }

  @Delete('perfiles/:id')
  @UseGuards(AdminGuard)
  eliminarPerfil(@Param('id') id: string) {
    return this.usuariosService.eliminarPerfil(id);
  }

  // Crear usuario (Auth + perfil). Solo admin.
  @Post('crear')
  @UseGuards(AdminGuard)
  crearUsuario(@Body() body: { email?: string; nombre?: string; rol?: string }) {
    return this.usuariosService.crearUsuario(body);
  }

  @Post('reset-password')
  resetPassword(@Body() body: { email: string }) {
    return this.usuariosService.resetPassword(body.email);
  }

  // Admin establece manualmente la contraseña de un usuario.
  @Post('profiles/:id/set-password')
  @UseGuards(AdminGuard)
  setPasswordAdmin(
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    return this.usuariosService.setPasswordAdmin(id, body?.password);
  }

  // Sessions
  @Get('sessions')
  getSessions() {
    return this.usuariosService.getSessions();
  }

  @Get('sessions/active')
  getActiveSessions() {
    return this.usuariosService.getActiveSessions();
  }

  @Get('sessions/in-range')
  getSessionsInRange(@Query('start') start: string, @Query('end') end: string) {
    return this.usuariosService.getSessionsInRange(start, end);
  }

  @Get('activity/in-range')
  getActivityDailyInRange(@Query('from') from: string, @Query('to') to: string) {
    return this.usuariosService.getActivityDailyInRange(from, to);
  }

  @Post('sessions')
  upsertSession(@Body() body: any) {
    return this.usuariosService.upsertSession(body);
  }

  @Put('sessions/:id')
  updateSession(@Param('id') id: string, @Body() body: any) {
    return this.usuariosService.updateSession(id, body);
  }

  @Post('sessions/close-stale')
  closeStaleSessions(@Body() body: { staleSeconds: number }) {
    return this.usuariosService.closeStaleSessions(body.staleSeconds);
  }

  // Activity
  @Get('activity')
  getActivityDaily(@Query() filters: any) {
    return this.usuariosService.getActivityDaily(filters);
  }

  @Post('activity')
  upsertActivity(@Body() body: any) {
    return this.usuariosService.upsertActivity(body);
  }
}
