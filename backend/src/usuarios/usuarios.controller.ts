import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { AuthGuard } from '../auth/auth.guard';

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

  @Put('profiles/:id')
  updateProfile(@Param('id') id: string, @Body() body: any) {
    return this.usuariosService.updateProfile(id, body);
  }

  @Delete('profiles/:id')
  deleteProfile(@Param('id') id: string) {
    return this.usuariosService.deleteProfile(id);
  }

  @Post('reset-password')
  resetPassword(@Body() body: { email: string }) {
    return this.usuariosService.resetPassword(body.email);
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
