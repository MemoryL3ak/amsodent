import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { GoogleAuthService } from './google-auth.service';

@Controller('auth/google')
export class GoogleAuthController {
  constructor(private readonly service: GoogleAuthService) {}

  // 1) Inicio del flujo OAuth. Protegido por AuthGuard: solo usuarios logueados
  // pueden pedir conectar. Retornamos la URL para que el frontend redirija al
  // navegador del usuario (window.location.href = ...).
  @Get('connect')
  @UseGuards(AuthGuard)
  connect(@Req() req: Request & { user: any }) {
    const userEmail = (req.user?.email || '').toLowerCase();
    if (!userEmail) throw new BadRequestException('Usuario sin email.');
    const url = this.service.buildAuthUrl(userEmail);
    return { url };
  }

  // 2) Callback: NO va con AuthGuard porque Google redirige directo aquí (no
  // tiene el JWT del usuario). La identidad se reconstruye del state firmado.
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const target = this.service.frontendCallbackTarget;

    if (error) {
      const u = new URL(target);
      u.searchParams.set('status', 'error');
      u.searchParams.set('reason', error);
      return res.redirect(u.toString());
    }

    if (!code || !state) {
      const u = new URL(target);
      u.searchParams.set('status', 'error');
      u.searchParams.set('reason', 'missing_params');
      return res.redirect(u.toString());
    }

    try {
      const { google_email } = await this.service.handleCallback(code, state);
      const u = new URL(target);
      u.searchParams.set('status', 'ok');
      u.searchParams.set('email', google_email);
      return res.redirect(u.toString());
    } catch (e: any) {
      const u = new URL(target);
      u.searchParams.set('status', 'error');
      u.searchParams.set('reason', (e?.message || 'unknown').slice(0, 200));
      return res.redirect(u.toString());
    }
  }

  // 3) Estado: ¿el usuario logueado tiene Gmail conectado?
  @Get('status')
  @UseGuards(AuthGuard)
  status(@Req() req: Request & { user: any }) {
    const userEmail = (req.user?.email || '').toLowerCase();
    return this.service.getStatus(userEmail);
  }

  // 4) Desconectar: revoca refresh_token en Google y borra la fila local.
  @Post('disconnect')
  @UseGuards(AuthGuard)
  disconnect(@Req() req: Request & { user: any }) {
    const userEmail = (req.user?.email || '').toLowerCase();
    return this.service.disconnect(userEmail);
  }

  // 5) Guardar refresh_token que viene del flujo de Supabase OAuth.
  // Cuando el usuario hace "Iniciar sesión con Google", Supabase entrega en la
  // sesión `provider_refresh_token`. El frontend lo manda acá para persistirlo
  // y poder enviar correos en su nombre (incluso programados/automáticos).
  @Post('save-refresh-token')
  @UseGuards(AuthGuard)
  saveRefreshToken(
    @Req() req: Request & { user: any },
    @Body() body: { refresh_token?: string; google_email?: string; scopes?: string },
  ) {
    const userEmail = (req.user?.email || '').toLowerCase();
    if (!body?.refresh_token || !body?.google_email) {
      throw new BadRequestException('Falta refresh_token o google_email.');
    }
    return this.service.saveRefreshTokenFromSupabase({
      user_email: userEmail,
      google_email: String(body.google_email).toLowerCase(),
      refresh_token: body.refresh_token,
      scopes: body.scopes,
    });
  }
}
