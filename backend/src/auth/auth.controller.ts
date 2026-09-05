import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Máx. 10 intentos por IP por minuto (contención auditoría 2026-09-04).
  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.signIn(body.email, body.password);
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@Req() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  // Crear usuarios (con rol arbitrario) es acción de administración
  // (contención auditoría 2026-09-04 — antes cualquier autenticado podía
  // crear una cuenta admin).
  @Post('create-user')
  @UseGuards(AdminGuard)
  async createUser(
    @Body() body: { email: string; password: string; nombre: string; rol: string },
  ) {
    return this.authService.createUser(body);
  }
}
