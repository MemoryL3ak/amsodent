import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CorreosService, TipoPlantilla } from './correos.service';
import { FirmasService } from './firmas.service';

function idDe(req: any): string {
  return String(req?.user?.id || '').trim();
}

const TIPOS_VALIDOS: TipoPlantilla[] = ['oc_agradecimiento', 'guia_despacho_enviar'];

@Controller('correos')
export class CorreosController {
  constructor(
    private correos: CorreosService,
    private firmas: FirmasService,
  ) {}

  // ── Firma del usuario ─────────────────────────────────────────────────
  @Get('firma')
  @UseGuards(AuthGuard)
  async getFirma(@Req() req: any) {
    return this.firmas.getFirma(idDe(req));
  }

  @Post('firma/html')
  @UseGuards(AuthGuard)
  async setFirmaHtml(@Req() req: any, @Body() body: { html?: string }) {
    return this.firmas.setFirmaHtml(idDe(req), String(body?.html || ''));
  }

  @Post('firma/campos')
  @UseGuards(AuthGuard)
  async setFirmaCampos(
    @Req() req: any,
    @Body() body: { cargo?: string; celular?: string; nombre?: string; email?: string },
  ) {
    return this.firmas.setFirmaCampos(idDe(req), body || {});
  }

  @Post('firma/reset')
  @UseGuards(AuthGuard)
  async resetFirma(@Req() req: any) {
    return this.firmas.resetFirma(idDe(req));
  }

  // Pre-arma el correo (destinatario, asunto = N° OC, cuerpo HTML) para el editor.
  @Get('plantilla')
  @UseGuards(AuthGuard)
  async plantilla(
    @Query('tipo') tipo: string,
    @Query('licitacionId') licitacionId: string,
    @Query('documentoId') documentoId: string,
  ) {
    const t = String(tipo || '') as TipoPlantilla;
    if (!TIPOS_VALIDOS.includes(t)) {
      throw new BadRequestException(`Tipo de plantilla inválido: ${tipo}`);
    }
    const lic = Number(licitacionId);
    const doc = Number(documentoId);
    if (!lic || !doc) {
      throw new BadRequestException('Faltan licitacionId y/o documentoId.');
    }
    return this.correos.getPlantilla(t, lic, doc);
  }

  @Post('enviar')
  @UseGuards(AuthGuard)
  async enviar(
    @Body()
    body: {
      licitacionId?: number;
      para?: string;
      asunto?: string;
      cuerpoHtml?: string;
      adjuntarDocumentoId?: number | null;
    },
  ) {
    if (!body?.licitacionId || !body?.para || !body?.asunto || !body?.cuerpoHtml) {
      throw new BadRequestException(
        'Faltan datos del correo (licitación, para, asunto, cuerpo).',
      );
    }
    return this.correos.enviar({
      licitacionId: Number(body.licitacionId),
      para: body.para,
      asunto: body.asunto,
      cuerpoHtml: body.cuerpoHtml,
      adjuntarDocumentoId: body.adjuntarDocumentoId ?? null,
    });
  }

  // ── Conexión OAuth de la cuenta de correo ─────────────────────────────

  // Devuelve la URL de consentimiento de Google a la que debe navegar el
  // navegador para conectar la cuenta del usuario.
  @Get('oauth/iniciar')
  @UseGuards(AuthGuard)
  async iniciarOAuth(@Req() req: any) {
    return { url: this.correos.urlConexion(idDe(req)) };
  }

  // Callback al que Google redirige tras el consentimiento. No lleva el token
  // de sesión: la identidad del usuario viaja en `state`. Redirige de vuelta
  // al frontend (Mi Correo) con el resultado.
  @Get('oauth/callback')
  async callbackOAuth(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    try {
      if (error) {
        throw new BadRequestException('La conexión con Google fue cancelada.');
      }
      if (!code || !state) {
        throw new BadRequestException('Faltan datos en la respuesta de Google.');
      }
      const r = await this.correos.procesarCallback(code, state);
      const correo = encodeURIComponent(r.email);
      return res.redirect(`${frontend}/buzon?correo_conectado=${correo}`);
    } catch (e: any) {
      const msg = encodeURIComponent(e?.message || 'No se pudo conectar la cuenta.');
      return res.redirect(`${frontend}/buzon?correo_error=${msg}`);
    }
  }

  @Post('oauth/desconectar')
  @UseGuards(AuthGuard)
  async desconectarOAuth(@Req() req: any) {
    return this.correos.desconectar(idDe(req));
  }

  // Recibe el refresh_token de Google después del sign-in con Supabase Auth.
  // Lo guarda en correo_cuentas para que el buzón quede conectado en un solo
  // paso (sin tener que pulsar "Conectar cuenta" después).
  @Post('oauth/supabase-sync')
  @UseGuards(AuthGuard)
  async sincronizarDesdeSupabase(
    @Req() req: any,
    @Body() body: { email?: string; refreshToken?: string },
  ) {
    return this.correos.sincronizarDesdeSupabase(idDe(req), {
      email: String(body?.email || ''),
      refreshToken: String(body?.refreshToken || ''),
    });
  }

  // ── Buzón del vendedor ────────────────────────────────────────────────

  @Get('buzon/estado')
  @UseGuards(AdminGuard)
  async estadoBuzon(@Req() req: any) {
    return this.correos.estadoBuzon(idDe(req));
  }

  @Get('buzon')
  @UseGuards(AdminGuard)
  async bandeja(
    @Req() req: any,
    @Query('carpeta') carpeta?: string,
    @Query('labelId') labelId?: string,
    @Query('q') q?: string,
    @Query('pageToken') pageToken?: string,
  ) {
    const carpetasValidas = ['recibidos', 'destacados', 'enviados', 'spam', 'papelera', 'borradores'];
    const carp = (carpetasValidas.includes(String(carpeta || ''))
      ? carpeta
      : 'recibidos') as
      | 'recibidos'
      | 'destacados'
      | 'enviados'
      | 'spam'
      | 'papelera'
      | 'borradores';
    return this.correos.listarBandeja(idDe(req), {
      carpeta: carp,
      labelId: labelId || undefined,
      q: q || undefined,
      pageToken: pageToken || undefined,
    });
  }

  @Get('buzon/conteos')
  @UseGuards(AdminGuard)
  async conteos(@Req() req: any) {
    return this.correos.contarCarpetas(idDe(req));
  }

  // Acciones sobre un mensaje (marcar leído/no leído, archivar, papelera,
  // restaurar, marcar como no-spam, destacar/quitar destacado).
  @Post('buzon/mensaje/:id/accion')
  @UseGuards(AdminGuard)
  async accionMensaje(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { accion?: string },
  ) {
    if (!id) throw new BadRequestException('Falta el id del mensaje.');
    return this.correos.accionMensaje(idDe(req), id, body?.accion as any);
  }

  // ── Etiquetas custom (carpetas estilo Gmail) ──────────────────────────
  @Get('buzon/etiquetas')
  @UseGuards(AdminGuard)
  async listarEtiquetas(@Req() req: any) {
    return this.correos.listarEtiquetas(idDe(req));
  }

  @Post('buzon/etiquetas')
  @UseGuards(AdminGuard)
  async crearEtiqueta(@Req() req: any, @Body() body: { nombre?: string }) {
    return this.correos.crearEtiqueta(idDe(req), String(body?.nombre || ''));
  }

  @Post('buzon/etiquetas/:id/eliminar')
  @UseGuards(AdminGuard)
  async eliminarEtiqueta(@Req() req: any, @Param('id') id: string) {
    return this.correos.eliminarEtiqueta(idDe(req), id);
  }

  @Post('buzon/mensaje/:id/etiqueta/:labelId/aplicar')
  @UseGuards(AdminGuard)
  async aplicarEtiqueta(
    @Req() req: any,
    @Param('id') id: string,
    @Param('labelId') labelId: string,
  ) {
    return this.correos.aplicarEtiqueta(idDe(req), id, labelId);
  }

  @Post('buzon/mensaje/:id/etiqueta/:labelId/quitar')
  @UseGuards(AdminGuard)
  async quitarEtiqueta(
    @Req() req: any,
    @Param('id') id: string,
    @Param('labelId') labelId: string,
  ) {
    return this.correos.quitarEtiqueta(idDe(req), id, labelId);
  }

  @Post('buzon/enviar')
  @UseGuards(AdminGuard)
  async enviarBuzon(
    @Req() req: any,
    @Body()
    body: {
      para?: string;
      cc?: string[];
      asunto?: string;
      cuerpo?: string;
      imagenes?: string[];
      adjuntos?: Array<{ url: string; nombre?: string; mime?: string }>;
    },
  ) {
    if (!body?.para || !body?.asunto || !body?.cuerpo) {
      throw new BadRequestException('Faltan datos del correo (para, asunto, cuerpo).');
    }
    return this.correos.enviarDesdeBuzon(idDe(req), {
      para: body.para,
      cc: Array.isArray(body.cc) ? body.cc : [],
      asunto: body.asunto,
      cuerpo: body.cuerpo,
      imagenes: Array.isArray(body.imagenes) ? body.imagenes : [],
      adjuntos: Array.isArray(body.adjuntos) ? body.adjuntos : [],
    });
  }

  @Get('buzon/destinatarios')
  @UseGuards(AdminGuard)
  async destinatariosBuzon(@Req() req: any) {
    return this.correos.destinatariosBuzon(idDe(req));
  }

  @Get('buzon/mensaje/:id')
  @UseGuards(AdminGuard)
  async mensaje(@Req() req: any, @Param('id') id: string) {
    if (!id) throw new BadRequestException('Falta el id del mensaje.');
    return this.correos.obtenerMensajeBuzon(idDe(req), id);
  }

  @Get('buzon/mensaje/:messageId/adjunto/:attachmentId')
  @UseGuards(AdminGuard)
  async adjunto(
    @Req() req: any,
    @Res() res: Response,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('nombre') nombre?: string,
    @Query('tipo') tipo?: string,
  ) {
    const buffer = await this.correos.descargarAdjuntoBuzon(
      idDe(req),
      messageId,
      attachmentId,
    );
    const filename = (nombre || 'adjunto').replace(/[^\w.\- ]+/g, '_');
    res.set({
      'Content-Type': tipo || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }
}
