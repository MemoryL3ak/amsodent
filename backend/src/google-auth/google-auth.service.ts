import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// Scopes solicitados al usuario:
//   - gmail.modify: permite enviar correos + leer hilos (para mostrar respuestas).
//     Incluye implícitamente gmail.send y gmail.readonly.
//   - userinfo.email + userinfo.profile: para saber qué cuenta Google se conectó.
//
// IMPORTANTE: gmail.modify es "restricted" y requiere verificación de Google al
// salir de testing. Si tu app está en producción y solo necesitas enviar, vuelve
// a gmail.send. Para que los usuarios existentes pasen al nuevo scope deben
// reconectar Gmail desde Perfil (el callback exige re-consent).
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const STATE_TTL_SECONDS = 10 * 60; // 10 min entre que se inicia el flujo y vuelve el callback

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(private supabase: SupabaseService) {}

  private get clientId(): string {
    const v = process.env.GOOGLE_CLIENT_ID;
    if (!v) throw new BadRequestException('GOOGLE_CLIENT_ID no configurado.');
    return v;
  }

  private get clientSecret(): string {
    const v = process.env.GOOGLE_CLIENT_SECRET;
    if (!v) throw new BadRequestException('GOOGLE_CLIENT_SECRET no configurado.');
    return v;
  }

  private get redirectUri(): string {
    const v = process.env.GOOGLE_REDIRECT_URI;
    if (!v) throw new BadRequestException('GOOGLE_REDIRECT_URI no configurado.');
    return v;
  }

  private get frontendUrl(): string {
    return process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  private get stateSecret(): string {
    return (
      process.env.GOOGLE_OAUTH_STATE_SECRET ||
      process.env.PORTAL_JWT_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      'dev-secret'
    );
  }

  // ── State firmado (HMAC) ───────────────────────────────────────────────────
  // Encapsula user_email + nonce + timestamp. El backend lo verifica al recibir
  // el callback para asociar el código OAuth con el usuario que inició el flujo.
  signState(payload: { user_email: string }): string {
    const data = {
      e: payload.user_email,
      n: crypto.randomBytes(8).toString('hex'),
      t: Math.floor(Date.now() / 1000),
    };
    const json = JSON.stringify(data);
    const body = Buffer.from(json).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.stateSecret)
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  verifyState(state: string): { user_email: string } {
    if (!state || typeof state !== 'string' || !state.includes('.')) {
      throw new BadRequestException('State inválido.');
    }
    const [body, sig] = state.split('.');
    const expected = crypto
      .createHmac('sha256', this.stateSecret)
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new BadRequestException('Firma de state inválida.');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      throw new BadRequestException('State malformado.');
    }
    const now = Math.floor(Date.now() / 1000);
    if (!parsed?.t || now - parsed.t > STATE_TTL_SECONDS) {
      throw new BadRequestException('State expirado, vuelve a iniciar la conexión.');
    }
    if (!parsed?.e) throw new BadRequestException('State sin user_email.');
    return { user_email: String(parsed.e) };
  }

  // ── URL de autorización ────────────────────────────────────────────────────
  buildAuthUrl(userEmail: string): string {
    const state = this.signState({ user_email: userEmail });
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      // 'offline' fuerza que Google entregue refresh_token (sin esto solo da access_token).
      access_type: 'offline',
      // 'consent' fuerza al usuario a pasar por la pantalla de autorización aunque
      // ya haya autorizado antes (necesario para garantizar que vuelva el refresh_token).
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  // ── Intercambio code → tokens ──────────────────────────────────────────────
  private async exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  }> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok) {
      this.logger.error(`Token exchange falló: ${JSON.stringify(json)}`);
      throw new BadRequestException(
        `Google rechazó el código: ${json?.error_description || json?.error || res.statusText}`,
      );
    }
    return json;
  }

  // ── Userinfo (email/name de la cuenta autorizada) ──────────────────────────
  private async fetchUserinfo(accessToken: string): Promise<{ email: string; name?: string }> {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json: any = await res.json();
    if (!res.ok || !json?.email) {
      throw new BadRequestException(
        `No se pudo obtener el email de la cuenta Google: ${json?.error || res.statusText}`,
      );
    }
    return { email: String(json.email).toLowerCase(), name: json?.name };
  }

  // ── Flujo de callback ──────────────────────────────────────────────────────
  // Recibe el code y el state, intercambia tokens, valida que el scope incluya
  // gmail.send, y guarda el refresh_token en BD asociado al user_email.
  async handleCallback(code: string, state: string): Promise<{
    user_email: string;
    google_email: string;
  }> {
    const { user_email } = this.verifyState(state);

    const tokens = await this.exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google no devolvió refresh_token. Esto pasa si el usuario ya tenía la app autorizada — pide que revoque el acceso en https://myaccount.google.com/permissions y vuelva a intentar.',
      );
    }

    const scopes = String(tokens.scope || '').split(' ').filter(Boolean);
    // gmail.modify implica send y readonly. Aceptamos cualquiera de los dos para
    // no romper a quienes ya conectaron con gmail.send.
    const tieneGmailSend =
      scopes.includes('https://www.googleapis.com/auth/gmail.modify') ||
      scopes.includes('https://www.googleapis.com/auth/gmail.send');
    if (!tieneGmailSend) {
      throw new BadRequestException(
        'No autorizaste el permiso necesario para enviar correos. Vuelve a intentar y acepta todos los permisos solicitados.',
      );
    }

    const info = await this.fetchUserinfo(tokens.access_token);

    const { error } = await this.supabase
      .getClient()
      .from('user_google_oauth')
      .upsert(
        {
          user_email: user_email.toLowerCase(),
          google_email: info.email,
          refresh_token: tokens.refresh_token,
          scopes: scopes.join(' '),
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_email' },
      );
    if (error) {
      this.logger.error(`No se pudo guardar refresh_token: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return { user_email, google_email: info.email };
  }

  // ── Guardar refresh_token entregado por Supabase ───────────────────────────
  // Cuando el usuario hace "Iniciar sesión con Google" usando Supabase OAuth,
  // Supabase recibe los tokens de Google y los expone en la sesión del cliente
  // (`provider_refresh_token`). El frontend nos los manda acá para persistirlos
  // y poder enviar correos sin que el usuario tenga que hacer un segundo flujo
  // "Conectar Gmail" en su perfil.
  //
  // Validación: probamos el refresh_token inmediatamente intercambiándolo por
  // un access_token. Si Google lo rechaza, devolvemos error para que el
  // frontend reintente.
  async saveRefreshTokenFromSupabase(opts: {
    user_email: string;
    google_email: string;
    refresh_token: string;
    scopes?: string;
  }): Promise<{ ok: true; google_email: string }> {
    const client = this.supabase.getClient();

    // Validamos que el refresh_token funcione antes de guardarlo.
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: opts.refresh_token,
      grant_type: 'refresh_token',
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok || !json?.access_token) {
      throw new BadRequestException(
        `El refresh_token de Google no es válido: ${json?.error_description || json?.error || res.statusText}. Cierra sesión y vuelve a entrar con Google.`,
      );
    }

    // Verificamos que el scope autorizado incluya gmail.send o gmail.modify.
    const grantedScopes = String(json?.scope || opts.scopes || '');
    const tieneScopeValido =
      grantedScopes.includes('https://www.googleapis.com/auth/gmail.modify') ||
      grantedScopes.includes('https://www.googleapis.com/auth/gmail.send');
    if (!tieneScopeValido) {
      throw new BadRequestException(
        'No autorizaste el permiso para enviar correos. Cierra sesión y vuelve a entrar aceptando todos los permisos.',
      );
    }

    const { error } = await client
      .from('user_google_oauth')
      .upsert(
        {
          user_email: opts.user_email,
          google_email: opts.google_email,
          refresh_token: opts.refresh_token,
          scopes: grantedScopes,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_email' },
      );
    if (error) {
      this.logger.error(`No se pudo guardar refresh_token de Supabase: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    return { ok: true, google_email: opts.google_email };
  }

  // ── Status: ¿el usuario tiene Gmail conectado? ─────────────────────────────
  async getStatus(userEmail: string): Promise<{
    connected: boolean;
    google_email?: string;
    connected_at?: string;
  }> {
    const { data, error } = await this.supabase
      .getClient()
      .from('user_google_oauth')
      .select('google_email, connected_at')
      .ilike('user_email', userEmail)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) return { connected: false };
    return {
      connected: true,
      google_email: data.google_email,
      connected_at: data.connected_at,
    };
  }

  // ── Desconectar: revoca el refresh_token en Google y elimina la fila. ──────
  async disconnect(userEmail: string): Promise<{ ok: true }> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('user_google_oauth')
      .select('refresh_token')
      .ilike('user_email', userEmail)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);

    if (data?.refresh_token) {
      // Best-effort: si Google rechaza el revoke (token ya expirado) igual
      // limpiamos la fila local para que el usuario pueda reconectarse.
      try {
        const body = new URLSearchParams({ token: data.refresh_token });
        await fetch(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
      } catch (e: any) {
        this.logger.warn(`Revoke falló (continuamos igual): ${e?.message}`);
      }
    }

    const { error: delErr } = await client
      .from('user_google_oauth')
      .delete()
      .ilike('user_email', userEmail);
    if (delErr) throw new BadRequestException(delErr.message);

    return { ok: true };
  }

  // ── Helper para servicios consumidores (futuro): obtener access_token vivo
  // El Comunicaciones.service lo va a usar para enviar correos via Gmail API.
  async getFreshAccessToken(userEmail: string): Promise<{
    access_token: string;
    google_email: string;
  }> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('user_google_oauth')
      .select('refresh_token, google_email')
      .ilike('user_email', userEmail)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data?.refresh_token) {
      throw new UnauthorizedException(
        'El usuario no tiene Gmail conectado. Pídele que vaya a su perfil y haga "Conectar Gmail".',
      );
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok || !json?.access_token) {
      // Si Google retorna invalid_grant es que el refresh fue revocado/expiró.
      // Borramos la fila local para forzar al usuario a reconectar.
      if (json?.error === 'invalid_grant') {
        await client
          .from('user_google_oauth')
          .delete()
          .ilike('user_email', userEmail);
        throw new UnauthorizedException(
          'La conexión con Gmail expiró o fue revocada. Vuelve a conectar tu cuenta desde el perfil.',
        );
      }
      throw new BadRequestException(
        `No se pudo refrescar el access_token: ${json?.error_description || json?.error || res.statusText}`,
      );
    }

    // Actualiza last_used_at para diagnóstico.
    await client
      .from('user_google_oauth')
      .update({ last_used_at: new Date().toISOString() })
      .ilike('user_email', userEmail);

    return { access_token: json.access_token, google_email: data.google_email };
  }

  get frontendCallbackTarget(): string {
    // El callback redirige al usuario de vuelta al frontend, a una página
    // dedicada que cierra la ventana o muestra "conectado".
    return `${this.frontendUrl.replace(/\/+$/, '')}/perfil/gmail-conectado`;
  }
}
