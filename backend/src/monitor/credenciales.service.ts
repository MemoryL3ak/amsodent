import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as dns from 'dns';
import * as nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { SupabaseService } from '../supabase/supabase.service';
import { MonitorService } from './monitor.service';
import { atiendeWeb } from '../rol-proceso';

/* ============================================================================
   Chequeo de credenciales e integraciones (2026-10-23)
   ----------------------------------------------------------------------------
   El SMTP llevaba desde el 2026-10-05 rechazando la clave (Gmail 535) y nadie
   se enteró: el health check solo abría el puerto 465 (no autenticaba), las
   fallas eran 1-4 al día (la alerta exige 5 errores en 5 minutos) y el único
   canal de alerta era… el correo. Este servicio AUTENTICA de verdad contra
   cada proveedor con la llamada más barata que existe, cada pocas horas y a
   pedido desde el panel, y avisa por la campana a los admins (canal que no
   depende del correo), con recordatorio diario mientras siga fallando.

   Estados:
     ok              la credencial fue aceptada
     fallo           el proveedor la RECHAZÓ (401/403/535/invalid_client…)
     aviso           la credencial sirve pero hay algo que atender (cuenta de
                     Google de un vendedor caducada, WhatsApp desvinculado…)
     sin_respuesta   no se pudo saber (timeout, 5xx): no se alerta, se muestra
     no_configurada  falta la variable de entorno
============================================================================ */

export type EstadoCredencial = 'ok' | 'fallo' | 'aviso' | 'sin_respuesta' | 'no_configurada';

export interface ResultadoCredencial {
  clave: string;
  nombre: string;
  /** Variable(s) de entorno que hay que corregir en Railway / backend/.env. */
  variable: string;
  estado: EstadoCredencial;
  detalle: string;
  ms: number | null;
  revisado_en: string;
  /** Desde cuándo está en este estado (en memoria: se reinicia con el backend). */
  desde: string;
}

type Veredicto = { estado: EstadoCredencial; detalle: string };
type Respuesta = { ok: boolean; status: number; json: any; texto: string };

const TIMEOUT_MS = 15_000;
const PRIMER_CHEQUEO_MS = 20_000;

const env = (k: string) => String(process.env[k] || '').trim();
const msg = (e: any) => String(e?.message || e || 'error desconocido').replace(/\s+/g, ' ').slice(0, 240);

@Injectable()
export class CredencialesService implements OnModuleDestroy {
  private readonly logger = new Logger(CredencialesService.name);
  private resultados = new Map<string, ResultadoCredencial>();
  private ultimaRevision: string | null = null;
  private corriendo: Promise<ResultadoCredencial[]> | null = null;
  private timers: NodeJS.Timeout[] = [];
  // Qué ya se avisó (clave → estado) y cuándo fue el último aviso, para no
  // repetir con cada corrida ni callar más de un día mientras siga fallando.
  private avisados = new Map<string, string>();
  private ultimoAvisoEn = 0;

  constructor(
    private supabase: SupabaseService,
    private monitor: MonitorService,
  ) {
    // Igual que los health checks: solo el proceso que atiende a los usuarios.
    if (atiendeWeb()) {
      const primero = setTimeout(() => void this.chequear(), PRIMER_CHEQUEO_MS);
      primero.unref?.();
      const cada = setInterval(() => void this.chequear(), this.intervaloMs());
      cada.unref?.();
      this.timers.push(primero, cada);
    }
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  intervaloHoras(): number {
    const h = Number(process.env.MONITOR_CREDENCIALES_HORAS || 6);
    return Number.isFinite(h) && h >= 1 ? h : 6;
  }

  private intervaloMs() {
    return this.intervaloHoras() * 60 * 60 * 1000;
  }

  /** Estado vigente para el panel y el banner. No vuelve a chequear. */
  estado() {
    if (this.resultados.size === 0 && !this.corriendo) void this.chequear();
    return {
      revisado_en: this.ultimaRevision,
      chequeando: !!this.corriendo,
      intervalo_horas: this.intervaloHoras(),
      en_produccion: this.monitor.enProduccion(),
      items: Array.from(this.resultados.values()),
    };
  }

  /** Botón «Probar ahora» del panel: espera el resultado. */
  async chequearAhora() {
    await this.chequear();
    return this.estado();
  }

  /** Corre todos los chequeos (una sola corrida a la vez). */
  chequear(): Promise<ResultadoCredencial[]> {
    if (this.corriendo) return this.corriendo;
    this.corriendo = this.ejecutar().finally(() => {
      this.corriendo = null;
    });
    return this.corriendo;
  }

  private async ejecutar(): Promise<ResultadoCredencial[]> {
    const defs: Array<{ clave: string; nombre: string; variable: string; fn: () => Promise<Veredicto> }> = [
      { clave: 'smtp', nombre: 'Correo SMTP (cuenta compartida)', variable: 'SMTP_USER / SMTP_PASS', fn: () => this.smtp() },
      { clave: 'bsale', nombre: 'Bsale (facturación y stock)', variable: 'BSALE_ACCESS_TOKEN', fn: () => this.bsale() },
      { clave: 'mercado_publico', nombre: 'Mercado Público (ticket API)', variable: 'MERCADO_PUBLICO_TICKET', fn: () => this.mercadoPublico() },
      { clave: 'anthropic', nombre: 'DamarIA (Anthropic)', variable: 'ANTHROPIC_API_KEY', fn: () => this.anthropic() },
      { clave: 'elevenlabs', nombre: 'Voz de DamarIA (ElevenLabs)', variable: 'ELEVENLABS_API_KEY', fn: () => this.elevenlabs() },
      { clave: 'google_maps', nombre: 'Google Maps (fletes)', variable: 'GOOGLE_MAPS_API_KEY', fn: () => this.googleMaps() },
      { clave: 'google_oauth', nombre: 'Google (cuentas de correo y calendario)', variable: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET', fn: () => this.googleOauth() },
      { clave: 'google_sa', nombre: 'Google Workspace (cuenta de servicio)', variable: 'GOOGLE_SERVICE_ACCOUNT_JSON', fn: () => this.googleServiceAccount() },
      { clave: 'webpay', nombre: 'Webpay (Transbank)', variable: 'TBK_COMMERCE_CODE / TBK_API_KEY', fn: () => this.webpay() },
      { clave: 'whatsapp', nombre: 'WhatsApp del equipo (Green API)', variable: 'WHATSAPP_GA_INSTANCE / WHATSAPP_GA_TOKEN', fn: () => this.whatsapp() },
      { clave: 'secretos_portal', nombre: 'Secretos de los portales (JWT)', variable: 'PORTAL_JWT_SECRET', fn: () => this.secretosPortal() },
    ];

    const ahora = new Date().toISOString();
    const res = await Promise.all(
      defs.map(async (d) => {
        const t0 = Date.now();
        let v: Veredicto;
        try {
          v = await d.fn();
        } catch (e: any) {
          v = { estado: 'sin_respuesta', detalle: msg(e) };
        }
        const previo = this.resultados.get(d.clave);
        const cambio = !previo || previo.estado !== v.estado;
        const r: ResultadoCredencial = {
          clave: d.clave,
          nombre: d.nombre,
          variable: d.variable,
          estado: v.estado,
          detalle: v.detalle,
          ms: Date.now() - t0,
          revisado_en: ahora,
          desde: cambio || !previo?.desde ? ahora : previo.desde,
        };
        this.resultados.set(d.clave, r);
        if (previo && cambio) {
          this.monitor.registrar({
            nivel: v.estado === 'fallo' ? 'error' : v.estado === 'ok' ? 'info' : 'warn',
            tipo: 'sistema',
            mensaje: `🔑 Credencial "${d.nombre}": ${previo.estado} → ${v.estado}. ${v.detalle}`,
            metadata: { credencial: d.clave, estado: v.estado },
          });
        }
        return r;
      }),
    );
    this.ultimaRevision = ahora;
    try {
      await this.avisar(res);
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar el estado de credenciales: ${msg(e)}`);
    }
    return res;
  }

  /* Aviso por la campana (+ correo si el SMTP sirve): cuando cambia lo que
     falla y, mientras siga fallando, un recordatorio cada
     MONITOR_CREDENCIALES_RECORDATORIO_H horas (24 por defecto). */
  private async avisar(res: ResultadoCredencial[]) {
    const malas = res.filter((r) => r.estado === 'fallo' || r.estado === 'aviso');
    const recordatorioMs = Math.max(1, Number(process.env.MONITOR_CREDENCIALES_RECORDATORIO_H || 24)) * 3600_000;

    // Una credencial deja de estar "avisada" solo cuando vuelve a ok (o se
    // quita del entorno). Un `sin_respuesta` pasajero (429, timeout) no la
    // recupera ni la vuelve a avisar cuando reaparece: evita el ruido.
    for (const r of res) {
      if (r.estado === 'ok' || r.estado === 'no_configurada') this.avisados.delete(r.clave);
    }
    const pendientes = res.some((r) => r.estado === 'sin_respuesta' && this.avisados.has(r.clave));

    if (!malas.length) {
      if (this.ultimoAvisoEn && !pendientes) {
        this.avisados.clear();
        this.ultimoAvisoEn = 0;
        await this.monitor.notificarAdmins({
          tipo: 'credencial_ok',
          nivel: 'info',
          mensaje: '✅ Todas las credenciales e integraciones vuelven a funcionar.',
          link: '/monitoreo-sistema',
          correo: false,
        });
      }
      return;
    }

    const nuevas = malas.filter((r) => this.avisados.get(r.clave) !== r.estado);
    const vencido = this.ultimoAvisoEn > 0 && Date.now() - this.ultimoAvisoEn >= recordatorioMs;
    if (!nuevas.length && !vencido) return;
    // El dedupe es en memoria: tras un reinicio del backend (p. ej. un
    // deploy) se vuelve a avisar una vez. Se intentó deduplicar consultando
    // `notificaciones` por metadata, pero la tabla es tan grande que esa
    // consulta tardó más de dos minutos y vencía el timeout de Supabase.
    for (const r of malas) this.avisados.set(r.clave, r.estado);
    this.ultimoAvisoEn = Date.now();
    const firma = malas.map((r) => `${r.clave}:${r.estado}`).sort().join('|');

    const fallos = malas.filter((r) => r.estado === 'fallo');
    const avisos = malas.filter((r) => r.estado === 'aviso');
    const partes = [
      ...fallos.map((r) => `${r.nombre}: ${r.detalle} → revisar ${r.variable}`),
      ...avisos.map((r) => `${r.nombre} (aviso): ${r.detalle}`),
    ];
    const titulo = fallos.length
      ? `🚨 ${fallos.length} credencial${fallos.length === 1 ? '' : 'es'} rechazada${fallos.length === 1 ? '' : 's'}${avisos.length ? ` y ${avisos.length} aviso${avisos.length === 1 ? '' : 's'}` : ''}`
      : `⚠️ ${avisos.length} integración${avisos.length === 1 ? '' : 'es'} con aviso`;
    await this.monitor.notificarAdmins({
      tipo: fallos.length ? 'credencial_fallo' : 'credencial_aviso',
      nivel: fallos.length ? 'error' : 'warn',
      mensaje: `${titulo}: ${partes.join(' · ')}`.slice(0, 900),
      link: '/monitoreo-sistema',
      metadata: { firma, credenciales: malas.map((r) => ({ clave: r.clave, estado: r.estado })) },
      // Si justo lo que falla es el SMTP, el correo no saldrá: la campana es el canal seguro.
      correo: true,
    });
  }

  // ── Utilidades ─────────────────────────────────────────────────────────

  private async pedir(url: string, init: RequestInit = {}): Promise<Respuesta> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const texto = await res.text().catch(() => '');
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, texto: texto.replace(/\s+/g, ' ').slice(0, 200) };
  }

  private noConfigurada(variable: string): Veredicto {
    return { estado: 'no_configurada', detalle: `Falta ${variable} en el entorno.` };
  }

  private sinRespuesta(r: Respuesta, quien: string): Veredicto {
    return { estado: 'sin_respuesta', detalle: `${quien} respondió ${r.status}${r.texto ? `: ${r.texto}` : ''}` };
  }

  // ── Chequeos ───────────────────────────────────────────────────────────

  /** Autentica de verdad contra el SMTP (el health check solo abre el puerto). */
  private async smtp(): Promise<Veredicto> {
    const user = env('SMTP_USER');
    const pass = env('SMTP_PASS');
    if (!user || !pass) return this.noConfigurada('SMTP_USER y/o SMTP_PASS');
    const port = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user, pass },
      family: 4,
      lookup: (hostname: string, _o: any, cb: any) => {
        dns.resolve4(hostname, (err, addrs) => (err ? cb(err) : cb(null, addrs[0], 4)));
      },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    } as any);
    try {
      await transporter.verify();
      return { estado: 'ok', detalle: `Gmail aceptó la clave de ${user}.` };
    } catch (e: any) {
      const m = msg(e);
      if (e?.code === 'EAUTH' || /535|not accepted|invalid login|authentication failed/i.test(m)) {
        return { estado: 'fallo', detalle: `Gmail rechazó la clave de ${user} (SMTP 535): hay que generar una contraseña de aplicación nueva.` };
      }
      return { estado: 'sin_respuesta', detalle: m };
    } finally {
      try {
        transporter.close();
      } catch {
        /* nada */
      }
    }
  }

  private async bsale(): Promise<Veredicto> {
    const token = env('BSALE_ACCESS_TOKEN');
    if (!token) return this.noConfigurada('BSALE_ACCESS_TOKEN');
    const base = (process.env.BSALE_URL || 'https://api.bsale.io').replace(/\/+$/, '');
    const r = await this.pedir(`${base}/v1/offices.json?limit=1`, {
      headers: { access_token: token, Accept: 'application/json' },
    });
    if (r.status === 401 || r.status === 403) {
      return { estado: 'fallo', detalle: `Bsale rechazó el token (${r.status}): ${r.json?.error || r.texto}` };
    }
    if (r.ok) return { estado: 'ok', detalle: 'Bsale aceptó el token.' };
    return this.sinRespuesta(r, 'Bsale');
  }

  private async mercadoPublico(): Promise<Veredicto> {
    const ticket = env('MERCADO_PUBLICO_TICKET') || env('MP_API_TICKET');
    if (!ticket) return this.noConfigurada('MERCADO_PUBLICO_TICKET');
    // La consulta por código es la más liviana; con ticket inválido responde
    // {"Codigo":203,"Mensaje":"Ticket no válido."} aunque el código no exista.
    const r = await this.pedir(
      `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=1-1-L126&ticket=${encodeURIComponent(ticket)}`,
      { headers: { Accept: 'application/json' } },
    );
    const mensaje = String(r.json?.Mensaje || '');
    if (r.json && (Number(r.json.Codigo) === 203 || /ticket/i.test(mensaje))) {
      return { estado: 'fallo', detalle: `Mercado Público rechazó el ticket: ${mensaje || 'Ticket no válido.'}` };
    }
    if (r.ok && r.json) return { estado: 'ok', detalle: 'Mercado Público aceptó el ticket.' };
    return this.sinRespuesta(r, 'Mercado Público');
  }

  private async anthropic(): Promise<Veredicto> {
    const key = env('ANTHROPIC_API_KEY');
    if (!key) return this.noConfigurada('ANTHROPIC_API_KEY');
    // Listar modelos no consume tokens.
    const r = await this.pedir('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (r.status === 401 || r.status === 403) {
      return { estado: 'fallo', detalle: `Anthropic rechazó la API key (${r.status}): ${r.json?.error?.message || r.texto}` };
    }
    if (r.ok) return { estado: 'ok', detalle: 'Anthropic aceptó la API key.' };
    return this.sinRespuesta(r, 'Anthropic');
  }

  private async elevenlabs(): Promise<Veredicto> {
    const key = env('ELEVENLABS_API_KEY');
    if (!key) return this.noConfigurada('ELEVENLABS_API_KEY');
    const r = await this.pedir('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
    const status = String(r.json?.detail?.status || '');
    // Una key restringida (solo text-to-speech) responde 401 "missing the
    // permission user_read": la key es válida, solo no puede leer el perfil.
    if (r.status === 401 && (status === 'missing_permissions' || /missing the permission/i.test(String(r.json?.detail?.message || '')))) {
      return { estado: 'ok', detalle: 'ElevenLabs aceptó la API key (restringida a síntesis de voz).' };
    }
    if (r.status === 401 || r.status === 403) {
      return { estado: 'fallo', detalle: `ElevenLabs rechazó la API key (${r.status}): ${r.json?.detail?.message || r.texto}` };
    }
    if (r.ok) return { estado: 'ok', detalle: 'ElevenLabs aceptó la API key.' };
    return this.sinRespuesta(r, 'ElevenLabs');
  }

  private async googleMaps(): Promise<Veredicto> {
    const key = env('GOOGLE_MAPS_API_KEY');
    if (!key) return this.noConfigurada('GOOGLE_MAPS_API_KEY');
    const r = await this.pedir(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Santiago, Chile')}&components=country:CL&language=es&key=${encodeURIComponent(key)}`,
    );
    const status = String(r.json?.status || '');
    if (status === 'REQUEST_DENIED') {
      return { estado: 'fallo', detalle: `Google Maps rechazó la key: ${r.json?.error_message || 'REQUEST_DENIED'}` };
    }
    if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
      return { estado: 'aviso', detalle: `Google Maps: cuota agotada (${status}).` };
    }
    if (r.ok && (status === 'OK' || status === 'ZERO_RESULTS')) return { estado: 'ok', detalle: 'Google Maps aceptó la key.' };
    return this.sinRespuesta(r, 'Google Maps');
  }

  /* Valida el cliente OAuth refrescando el token de cada cuenta conectada:
     invalid_client = las credenciales del cliente están malas (global);
     invalid_grant  = esa persona debe reconectar su Google (aviso). */
  private async googleOauth(): Promise<Veredicto> {
    const id = env('GOOGLE_CLIENT_ID');
    const secret = env('GOOGLE_CLIENT_SECRET');
    if (!id || !secret) return this.noConfigurada('GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET');
    const { data: cuentas, error } = await this.supabase
      .getClient()
      .from('correo_cuentas')
      .select('email, refresh_token')
      .limit(20);
    if (error) return { estado: 'sin_respuesta', detalle: `No se pudo leer correo_cuentas: ${error.message}` };
    if (!cuentas?.length) {
      return { estado: 'ok', detalle: 'Cliente configurado; sin cuentas de Google conectadas con las que validarlo.' };
    }
    const caducadas: string[] = [];
    const otros: string[] = [];
    let vigentes = 0;
    for (const c of cuentas) {
      if (!c.refresh_token) continue;
      const r = await this.pedir('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: id,
          client_secret: secret,
          refresh_token: String(c.refresh_token),
          grant_type: 'refresh_token',
        }).toString(),
      });
      const err = String(r.json?.error || '');
      if (r.ok) vigentes++;
      else if (err === 'invalid_client' || err === 'unauthorized_client') {
        return { estado: 'fallo', detalle: `Google rechazó el cliente OAuth (${err}): ${r.json?.error_description || ''}`.trim() };
      } else if (err === 'invalid_grant') caducadas.push(String(c.email || '?'));
      else otros.push(`${c.email}: ${err || r.status}`);
    }
    if (caducadas.length) {
      return {
        estado: 'aviso',
        detalle: `Cliente OAuth válido (${vigentes} vigente${vigentes === 1 ? '' : 's'}); conexiones caducadas que deben volver a conectar su Google en Buzón: ${caducadas.join(', ')}.`,
      };
    }
    if (otros.length) return { estado: 'sin_respuesta', detalle: `Google no respondió bien para ${otros.join('; ')}` };
    return { estado: 'ok', detalle: `Cliente OAuth válido · ${vigentes} cuenta${vigentes === 1 ? '' : 's'} de Google vigente${vigentes === 1 ? '' : 's'}.` };
  }

  /* Cuenta de servicio con delegación de dominio: si la cuenta compartida
     pertenece al dominio Workspace, se pide un token impersonándola (valida
     también la delegación); si no, se valida solo la llave. */
  private async googleServiceAccount(): Promise<Veredicto> {
    const raw = env('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!raw) return this.noConfigurada('GOOGLE_SERVICE_ACCOUNT_JSON');
    let sa: any;
    try {
      sa = JSON.parse(raw);
    } catch {
      return { estado: 'fallo', detalle: 'GOOGLE_SERVICE_ACCOUNT_JSON no es un JSON válido.' };
    }
    if (!sa?.client_email || !sa?.private_key) {
      return { estado: 'fallo', detalle: 'GOOGLE_SERVICE_ACCOUNT_JSON no trae client_email/private_key.' };
    }
    const dominio = env('GOOGLE_WORKSPACE_DOMAIN').toLowerCase();
    const compartida = env('SMTP_USER').toLowerCase();
    const subject = dominio && compartida.endsWith('@' + dominio) ? compartida : undefined;
    const jwt = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: subject ? ['https://www.googleapis.com/auth/gmail.send'] : ['https://www.googleapis.com/auth/userinfo.email'],
      subject,
    });
    try {
      await jwt.authorize();
      return {
        estado: 'ok',
        detalle: subject
          ? `Cuenta de servicio válida y con delegación sobre ${subject}.`
          : `Cuenta de servicio ${sa.client_email} válida (delegación no verificada: la cuenta compartida no es del dominio).`,
      };
    } catch (e: any) {
      const m = msg(e);
      if (/invalid_grant|invalid_client|unauthorized_client|invalid jwt|invalid_rapt|access_denied/i.test(m)) {
        return { estado: 'fallo', detalle: `Google rechazó la cuenta de servicio: ${m}` };
      }
      return { estado: 'sin_respuesta', detalle: m };
    }
  }

  /* Consulta una transacción inexistente: 401 = llaves malas; 4xx de
     "token inválido" = las llaves fueron aceptadas. */
  private async webpay(): Promise<Veredicto> {
    const produccion = env('TBK_AMBIENTE').toLowerCase() === 'produccion';
    const code = env('TBK_COMMERCE_CODE');
    const key = env('TBK_API_KEY');
    if (produccion && (!code || !key)) return this.noConfigurada('TBK_COMMERCE_CODE y/o TBK_API_KEY (ambiente producción)');
    const host = produccion ? 'https://webpay3g.transbank.cl' : 'https://webpay3gint.transbank.cl';
    const r = await this.pedir(`${host}/rswebpaytransaction/api/webpay/v1.2/transactions/${'0'.repeat(64)}`, {
      headers: {
        'Tbk-Api-Key-Id': code || '597055555532',
        'Tbk-Api-Key-Secret': key || '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
        'Content-Type': 'application/json',
      },
    });
    const ambiente = produccion ? 'producción' : 'integración';
    if (r.status === 401 || r.status === 403) {
      return { estado: 'fallo', detalle: `Transbank rechazó las llaves de ${ambiente} (${r.status}): ${r.json?.error_message || r.texto}` };
    }
    if (r.ok || [400, 404, 422].includes(r.status)) return { estado: 'ok', detalle: `Transbank aceptó las llaves (${ambiente}).` };
    return this.sinRespuesta(r, 'Transbank');
  }

  private async whatsapp(): Promise<Veredicto> {
    const instancia = env('WHATSAPP_GA_INSTANCE');
    const token = env('WHATSAPP_GA_TOKEN');
    if (!instancia || !token) return this.noConfigurada('WHATSAPP_GA_INSTANCE y/o WHATSAPP_GA_TOKEN');
    const base = (process.env.WHATSAPP_GA_URL || 'https://api.green-api.com').trim().replace(/\/$/, '');
    const r = await this.pedir(`${base}/waInstance${instancia}/getStateInstance/${token}`);
    if (r.status === 401 || r.status === 403) {
      return { estado: 'fallo', detalle: `Green API rechazó la instancia o el token (${r.status}).` };
    }
    if (r.ok) {
      const estado = String(r.json?.stateInstance || '');
      if (estado === 'authorized') return { estado: 'ok', detalle: 'Instancia de WhatsApp vinculada y autorizada.' };
      return { estado: 'aviso', detalle: `Instancia de WhatsApp en estado "${estado || 'desconocido'}": hay que volver a vincular el teléfono en Green API.` };
    }
    return this.sinRespuesta(r, 'Green API');
  }

  private async secretosPortal(): Promise<Veredicto> {
    if (env('PORTAL_JWT_SECRET')) return { estado: 'ok', detalle: 'PORTAL_JWT_SECRET definido.' };
    return {
      estado: 'aviso',
      detalle: 'PORTAL_JWT_SECRET no está definido: los portales firman sesiones con la service key de Supabase. Definirlo es parte del checklist de seguridad.',
    };
  }
}

