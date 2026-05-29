import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { GmailApiService, GmailCreds } from './gmail-api.service';
import { FirmasService } from './firmas.service';
import {
  plantillaAgradecimientoOC,
  plantillaGuiaDespacho,
} from './correos.templates';

export type TipoPlantilla = 'oc_agradecimiento' | 'guia_despacho_enviar';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PlantillaPreparada = {
  tipo: TipoPlantilla;
  para: string;
  asunto: string;
  cuerpoHtml: string;
  // Cuenta desde la que sale el correo (se muestra en el editor).
  de: string;
  // 'gmail' = sale desde la casilla conectada del vendedor; 'smtp' = cuenta compartida.
  modoEnvio: 'gmail' | 'smtp';
  // True si el vendedor conectó su cuenta de Google (correo sale desde la suya).
  delegacionActiva: boolean;
  // Solo aplica en modo smtp: a dónde llegan las respuestas del cliente.
  replyTo: string;
  nombreCliente: string;
  // Documento cuyo PDF se sugiere adjuntar (la guía, para el envío de guía).
  adjuntarDocumentoId: number | null;
};

// Modo de acceso a Gmail para un usuario:
//  - 'oauth': el usuario conectó manualmente su Google y guardamos su refresh_token
//  - 'dwd':   el usuario está en Workspace y usamos service account + impersonación
type CuentaVendedor =
  | { email: string; modo: 'oauth'; refreshToken: string }
  | { email: string; modo: 'dwd' };

// Remitente de la cuenta SMTP compartida (modo de respaldo).
function remitenteCompartido(): string {
  const user = String(process.env.SMTP_USER || '').trim();
  const nombre = String(process.env.SMTP_FROM_NAME || 'AMSODENT').trim();
  return user ? `${nombre} <${user}>` : nombre;
}

// Convierte el texto plano escrito en el editor del buzón a HTML seguro,
// conservando los saltos de línea.
function textoAHtml(texto: string): string {
  const escapado = String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br>');
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;' +
    `color:#1f2937;line-height:1.6;">${escapado}</div>`
  );
}

@Injectable()
export class CorreosService {
  private readonly logger = new Logger(CorreosService.name);

  // Estados OAuth pendientes: nonce → usuario que conecta su cuenta.
  // Viven en memoria, son de un solo uso y caducan a los 10 minutos.
  private estadosOAuth = new Map<string, { userId: string; expira: number }>();

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
    private gmailApi: GmailApiService,
    private firmas: FirmasService,
  ) {}

  private async getLicitacion(licitacionId: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('licitaciones')
      .select(
        'id, id_licitacion, nombre_entidad, email, contacto, vendedor_nombre, vendedor_correo, vendedor_celular, creado_por',
      )
      .eq('id', licitacionId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException(`Cotización ${licitacionId} no encontrada.`);
    return data;
  }

  private async getDocumento(documentoId: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('licitacion_documentos')
      .select(
        'id, licitacion_id, tipo, numero, n_seguimiento, empresa_despacho, deriva_de_id, bucket, storage_path, file_name, mime_type',
      )
      .eq('id', documentoId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException(`Documento ${documentoId} no encontrado.`);
    return data;
  }

  // Identidad del vendedor en la cotización (su correo de inicio de sesión).
  private correoVendedor(lic: any): string {
    return String(lic?.vendedor_correo || lic?.creado_por || '').trim().toLowerCase();
  }

  // ── Cuentas de correo conectadas (OAuth + DWD) ────────────────────────

  // Convierte una CuentaVendedor en credenciales para gmail-api.
  private credsDe(cuenta: CuentaVendedor): GmailCreds {
    if (cuenta.modo === 'oauth') {
      return { modo: 'oauth', refreshToken: cuenta.refreshToken };
    }
    return { modo: 'dwd', email: cuenta.email };
  }

  // Email del perfil del usuario (necesario para el fallback DWD cuando
  // todavía no se conectó manualmente).
  private async emailDePerfil(userId: string): Promise<string> {
    const id = String(userId || '').trim();
    if (!id) return '';
    const { data } = await this.supabase
      .getClient()
      .from('profiles')
      .select('email')
      .eq('id', id)
      .maybeSingle();
    return String((data as any)?.email || '').trim().toLowerCase();
  }

  // Resuelve cómo enviar/leer correos para un usuario:
  //  1) Si conectó manualmente Google → OAuth con su refresh_token
  //  2) Si su correo pertenece al dominio Workspace y hay service account
  //     configurado → impersonación DWD (sin pedirle nada al usuario)
  //  3) Si nada de lo anterior → null (cae al SMTP compartido)
  private async cuentaDeUsuario(userId: string): Promise<CuentaVendedor | null> {
    const id = String(userId || '').trim();
    if (!id) return null;
    try {
      const { data } = await this.supabase
        .getClient()
        .from('correo_cuentas')
        .select('email, refresh_token')
        .eq('user_id', id)
        .maybeSingle();
      if (data?.refresh_token) {
        return {
          modo: 'oauth',
          email: String(data.email || '').trim().toLowerCase(),
          refreshToken: String(data.refresh_token),
        };
      }
    } catch (e: any) {
      this.logger.warn(`Error leyendo correo_cuentas: ${e?.message || e}`);
    }
    // Fallback DWD: si está en el dominio Workspace y tenemos service account
    if (this.gmailApi.configuradoDWD()) {
      const email = await this.emailDePerfil(id);
      if (email && this.gmailApi.puedeImpersonar(email)) {
        return { modo: 'dwd', email };
      }
    }
    return null;
  }

  // Id de perfil a partir del correo de inicio de sesión.
  private async perfilIdPorEmail(email: string): Promise<string | null> {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    try {
      const { data, error } = await this.supabase
        .getClient()
        .from('profiles')
        .select('id')
        .ilike('email', e)
        .maybeSingle();
      if (error) {
        this.logger.warn(`No se pudo resolver perfil por email: ${error.message}`);
        return null;
      }
      return data?.id ? String(data.id) : null;
    } catch (e: any) {
      this.logger.warn(`Error resolviendo perfil por email: ${e?.message || e}`);
      return null;
    }
  }

  // Cuenta conectada del vendedor dueño de la cotización.
  private async cuentaDeVendedor(lic: any): Promise<CuentaVendedor | null> {
    const identidad = this.correoVendedor(lic);
    const perfilId = await this.perfilIdPorEmail(identidad);
    if (!perfilId) return null;
    return this.cuentaDeUsuario(perfilId);
  }

  // Arma destinatario + asunto + cuerpo HTML para que el frontend los muestre
  // en el editor de correo. No envía nada.
  async getPlantilla(
    tipo: TipoPlantilla,
    licitacionId: number,
    documentoId: number,
  ): Promise<PlantillaPreparada> {
    const lic = await this.getLicitacion(licitacionId);
    const doc = await this.getDocumento(documentoId);

    const nombreCliente = String(lic.nombre_entidad || lic.contacto || '').trim();
    const para = String(lic.email || '').trim().toLowerCase();
    const vendedorCorreo = this.correoVendedor(lic);
    const vendedorNombre = String(lic.vendedor_nombre || '').trim();
    const vendedorCelular = String(lic.vendedor_celular || '').trim();

    // El correo sale desde la casilla del vendedor si conectó su cuenta de
    // Google; si no, desde la cuenta SMTP compartida (modo de respaldo).
    const cuenta = await this.cuentaDeVendedor(lic);
    const puedeGmail = this.gmailApi.configurado() && !!cuenta;
    const modoEnvio: 'gmail' | 'smtp' = puedeGmail ? 'gmail' : 'smtp';
    const de = puedeGmail ? cuenta!.email : remitenteCompartido();

    const base = {
      tipo,
      para,
      de,
      modoEnvio,
      delegacionActiva: puedeGmail,
      replyTo: vendedorCorreo,
      nombreCliente,
    };

    if (tipo === 'oc_agradecimiento') {
      const { asunto, html } = plantillaAgradecimientoOC({
        nombreCliente,
        numeroOc: doc.numero || '',
        vendedorNombre,
        vendedorCorreo,
        vendedorCelular,
      });
      return { ...base, asunto, cuerpoHtml: html, adjuntarDocumentoId: null };
    }

    if (tipo === 'guia_despacho_enviar') {
      // El N° de OC viene del documento del que deriva la guía.
      let numeroOc = '';
      if (doc.deriva_de_id) {
        const { data: ocDoc } = await this.supabase
          .getClient()
          .from('licitacion_documentos')
          .select('numero')
          .eq('id', doc.deriva_de_id)
          .maybeSingle();
        numeroOc = String(ocDoc?.numero || '').trim();
      }
      const { asunto, html } = plantillaGuiaDespacho({
        nombreCliente,
        numeroOc,
        numeroGuia: doc.numero || '',
        numeroSeguimiento: doc.n_seguimiento || '',
        empresaDespacho: doc.empresa_despacho || '',
        vendedorNombre,
        vendedorCorreo,
        vendedorCelular,
      });
      return { ...base, asunto, cuerpoHtml: html, adjuntarDocumentoId: doc.id };
    }

    throw new BadRequestException(`Tipo de plantilla no soportado: ${tipo}`);
  }

  // Descarga el PDF de un documento desde Storage para adjuntarlo al correo.
  private async descargarAdjunto(documentoId: number) {
    const doc = await this.getDocumento(documentoId);
    if (!doc.bucket || !doc.storage_path) return null;
    const { data, error } = await this.supabase
      .getClient()
      .storage.from(doc.bucket)
      .download(doc.storage_path);
    if (error || !data) {
      this.logger.warn(
        `No se pudo descargar adjunto del documento ${documentoId}: ${error?.message || 'sin datos'}`,
      );
      return null;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      filename: doc.file_name || 'documento.pdf',
      content: buffer,
      contentType: doc.mime_type || 'application/pdf',
    };
  }

  async enviar(opts: {
    licitacionId: number;
    para: string;
    asunto: string;
    cuerpoHtml: string;
    adjuntarDocumentoId?: number | null;
  }) {
    const lic = await this.getLicitacion(Number(opts.licitacionId));
    const vendedorCorreo = this.correoVendedor(lic);
    const cuenta = await this.cuentaDeVendedor(lic);

    const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    if (opts.adjuntarDocumentoId) {
      const adjunto = await this.descargarAdjunto(Number(opts.adjuntarDocumentoId));
      if (adjunto) attachments.push(adjunto);
    }

    // Si el vendedor tiene Gmail disponible (OAuth conectado o DWD), el
    // correo sale desde su casilla (queda en sus Enviados).
    if (cuenta) {
      const remitente = String(lic.vendedor_nombre || '').trim()
        ? `${String(lic.vendedor_nombre).trim()} <${cuenta.email}>`
        : cuenta.email;
      const res = await this.gmailApi.enviarComo(this.credsDe(cuenta), {
        remitente,
        para: opts.para,
        asunto: opts.asunto,
        html: opts.cuerpoHtml,
        attachments,
      });
      return { ...res, modo: 'gmail' as const, de: cuenta.email };
    }

    // Respaldo: cuenta SMTP compartida, con responder-a hacia el vendedor.
    const res = await this.mailings.enviarUno({
      para: opts.para,
      asunto: opts.asunto,
      cuerpoHtml: opts.cuerpoHtml,
      replyTo: vendedorCorreo || undefined,
      attachments,
    });
    return { ...res, modo: 'smtp' as const, de: remitenteCompartido() };
  }

  // Envía un correo de redacción libre a un cliente desde el portal de stock.
  // Sale desde la casilla conectada del usuario (OAuth o DWD) y queda en sus
  // Enviados; si no tiene cuenta conectada, cae al SMTP compartido. En ambos
  // casos se anexa la firma del usuario.
  async enviarCorreoCliente(
    userId: string,
    opts: { para: string; cc?: string[]; asunto: string; mensaje: string },
  ) {
    const para = String(opts.para || '').trim().toLowerCase();
    if (!RE_EMAIL.test(para)) {
      throw new BadRequestException('El destinatario no es un correo válido.');
    }
    const cc = (Array.isArray(opts.cc) ? opts.cc : [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => RE_EMAIL.test(e) && e !== para);
    const asunto = String(opts.asunto || '').trim();
    if (!asunto) throw new BadRequestException('Falta el asunto del correo.');
    const mensaje = String(opts.mensaje || '').trim();
    if (!mensaje) throw new BadRequestException('El mensaje no puede ir vacío.');

    const uid = String(userId || '').trim();
    const firmaHtml = uid ? await this.firmas.htmlParaEnviar(uid) : '';
    const cuerpoHtml =
      textoAHtml(mensaje) + (firmaHtml ? `<br><br>${firmaHtml}` : '');

    const cuenta = uid ? await this.cuentaDeUsuario(uid) : null;
    if (cuenta) {
      const res = await this.gmailApi.enviarComo(this.credsDe(cuenta), {
        remitente: cuenta.email,
        para,
        cc: cc.length > 0 ? cc : undefined,
        asunto,
        html: cuerpoHtml,
      });
      return { ...res, modo: 'gmail' as const, de: cuenta.email };
    }

    // Respaldo: cuenta SMTP compartida.
    const res = await this.mailings.enviarUno({
      para,
      cc: cc.length > 0 ? cc : undefined,
      asunto,
      cuerpoHtml,
    });
    return { ...res, modo: 'smtp' as const, de: remitenteCompartido() };
  }

  // ── Conexión OAuth de la cuenta de correo ─────────────────────────────

  private limpiarEstadosOAuth() {
    const ahora = Date.now();
    for (const [k, v] of this.estadosOAuth) {
      if (v.expira < ahora) this.estadosOAuth.delete(k);
    }
  }

  // Genera la URL de consentimiento de Google para que el usuario conecte
  // su cuenta de correo. El nonce identifica al usuario en el callback.
  urlConexion(userId: string): string {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('Usuario no válido.');
    if (!this.gmailApi.configurado()) {
      throw new BadRequestException(
        'La conexión con Google no está configurada en el servidor.',
      );
    }
    this.limpiarEstadosOAuth();
    const nonce = crypto.randomBytes(24).toString('hex');
    this.estadosOAuth.set(nonce, { userId: id, expira: Date.now() + 10 * 60 * 1000 });
    return this.gmailApi.urlConsentimiento(nonce);
  }

  // Procesa el callback de Google: valida el estado, intercambia el código
  // y guarda la cuenta conectada del usuario.
  async procesarCallback(code: string, state: string): Promise<{ email: string }> {
    const entrada = this.estadosOAuth.get(String(state || ''));
    if (!entrada || entrada.expira < Date.now()) {
      throw new BadRequestException(
        'La conexión expiró o no es válida. Vuelve a intentarlo.',
      );
    }
    this.estadosOAuth.delete(String(state));

    const cuenta = await this.gmailApi.intercambiarCodigo(code);
    const { error } = await this.supabase
      .getClient()
      .from('correo_cuentas')
      .upsert(
        {
          user_id: entrada.userId,
          email: cuenta.email,
          refresh_token: cuenta.refreshToken,
          scopes: cuenta.scopes,
          actualizado_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) throw new BadRequestException(error.message);

    this.logger.log(`Cuenta de correo conectada: ${cuenta.email}`);
    return { email: cuenta.email };
  }

  // Guarda directamente la cuenta de Google que viene del sign-in con
  // Supabase Auth. Usa el refresh_token que Supabase nos entrega tras el
  // OAuth con Google (configurado con access_type=offline + prompt=consent).
  async sincronizarDesdeSupabase(
    userId: string,
    payload: { email: string; refreshToken: string },
  ): Promise<{ email: string }> {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('Usuario no válido.');
    const email = String(payload?.email || '').trim().toLowerCase();
    const refresh = String(payload?.refreshToken || '').trim();
    if (!email || !refresh) {
      throw new BadRequestException('Faltan datos de la cuenta de Google.');
    }
    const { error } = await this.supabase
      .getClient()
      .from('correo_cuentas')
      .upsert(
        {
          user_id: id,
          email,
          refresh_token: refresh,
          scopes:
            'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
          actualizado_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) throw new BadRequestException(error.message);
    this.logger.log(`Cuenta de correo sincronizada vía Supabase OAuth: ${email}`);
    return { email };
  }

  async desconectar(userId: string): Promise<{ desconectado: boolean }> {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('Usuario no válido.');
    const { error } = await this.supabase
      .getClient()
      .from('correo_cuentas')
      .delete()
      .eq('user_id', id);
    if (error) throw new BadRequestException(error.message);
    return { desconectado: true };
  }

  // ── Buzón del vendedor ────────────────────────────────────────────────

  // Estado del buzón: si se puede mostrar y por qué no, en su caso.
  // Considera tanto OAuth manual como el fallback automático vía DWD.
  async estadoBuzon(userId: string) {
    const configuradoOauth = this.gmailApi.configurado();
    const configuradoDWD = this.gmailApi.configuradoDWD();
    const cuenta = await this.cuentaDeUsuario(userId);

    let motivo = '';
    if (!configuradoOauth && !configuradoDWD) {
      motivo = 'La conexión con Google aún no está configurada en el servidor.';
    } else if (!cuenta) {
      motivo =
        'Conecta tu cuenta de correo de Google para enviar correos a tus clientes y ver tu bandeja aquí.';
    }
    // Solo ofrecemos el botón manual "Conectar" si NO estamos usando DWD.
    const puedeConectar = configuradoOauth && !cuenta;
    return {
      disponible: !!cuenta,
      puedeConectar,
      correoEnvio: cuenta?.email || '',
      modo: cuenta?.modo || null,
      motivo,
    };
  }

  async listarBandeja(
    userId: string,
    opts: {
      carpeta?:
        | 'recibidos'
        | 'destacados'
        | 'enviados'
        | 'spam'
        | 'papelera'
        | 'borradores';
      labelId?: string;
      q?: string;
      pageToken?: string;
    },
  ) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    return this.gmailApi.listarMensajes(this.credsDe(cuenta), opts);
  }

  // Conteos por carpeta del sistema, para los badges del sidebar.
  async contarCarpetas(userId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    return this.gmailApi.contarCarpetas(this.credsDe(cuenta));
  }

  // Acciones sobre un mensaje individual (atajos al gmail-api.service).
  async accionMensaje(
    userId: string,
    messageId: string,
    accion:
      | 'marcar-leido'
      | 'marcar-no-leido'
      | 'archivar'
      | 'mover-papelera'
      | 'restaurar'
      | 'marcar-no-spam'
      | 'destacar'
      | 'quitar-destacado',
  ) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    const t = this.credsDe(cuenta);
    switch (accion) {
      case 'marcar-leido':
        await this.gmailApi.marcarLeido(t, messageId);
        break;
      case 'marcar-no-leido':
        await this.gmailApi.marcarNoLeido(t, messageId);
        break;
      case 'archivar':
        await this.gmailApi.archivar(t, messageId);
        break;
      case 'mover-papelera':
        await this.gmailApi.moverPapelera(t, messageId);
        break;
      case 'restaurar':
        await this.gmailApi.restaurar(t, messageId);
        break;
      case 'marcar-no-spam':
        await this.gmailApi.marcarNoSpam(t, messageId);
        break;
      case 'destacar':
        await this.gmailApi.destacar(t, messageId, true);
        break;
      case 'quitar-destacado':
        await this.gmailApi.destacar(t, messageId, false);
        break;
      default:
        throw new BadRequestException(`Acción no soportada: ${accion}`);
    }
    return { ok: true };
  }

  // ── Etiquetas custom (carpetas estilo Gmail) ──────────────────────────
  async listarEtiquetas(userId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    return this.gmailApi.listarEtiquetas(this.credsDe(cuenta));
  }

  async crearEtiqueta(userId: string, nombre: string) {
    const n = String(nombre || '').trim();
    if (!n) throw new BadRequestException('El nombre de la carpeta es obligatorio.');
    if (n.length > 80) throw new BadRequestException('El nombre es demasiado largo.');
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    return this.gmailApi.crearEtiqueta(this.credsDe(cuenta), n);
  }

  async eliminarEtiqueta(userId: string, labelId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    await this.gmailApi.eliminarEtiqueta(this.credsDe(cuenta), labelId);
    return { ok: true };
  }

  async aplicarEtiqueta(userId: string, messageId: string, labelId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    await this.gmailApi.aplicarEtiqueta(this.credsDe(cuenta), messageId, labelId);
    return { ok: true };
  }

  async quitarEtiqueta(userId: string, messageId: string, labelId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    await this.gmailApi.quitarEtiqueta(this.credsDe(cuenta), messageId, labelId);
    return { ok: true };
  }

  async obtenerMensajeBuzon(userId: string, id: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    const credsCuenta = this.credsDe(cuenta);
    const msg = await this.gmailApi.obtenerMensaje(credsCuenta, id);
    // Marcar como leído sin bloquear la respuesta.
    this.gmailApi.marcarLeido(credsCuenta, id).catch(() => undefined);
    return msg;
  }

  async descargarAdjuntoBuzon(userId: string, messageId: string, attachmentId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    return this.gmailApi.obtenerAdjunto(this.credsDe(cuenta), messageId, attachmentId);
  }

  // Envía un correo redactado desde el módulo "Mi Correo", desde la casilla
  // conectada del propio usuario.
  // Descarga un archivo desde una URL pública para adjuntarlo al correo.
  private async descargarAdjuntoDesdeUrl(
    url: string,
    nombreSugerido?: string,
  ): Promise<{ filename: string; content: Buffer; contentType: string } | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const buffer = Buffer.from(await r.arrayBuffer());
      const contentType = r.headers.get('content-type') || 'application/octet-stream';
      let filename = String(nombreSugerido || '').trim();
      if (!filename) {
        try {
          const u = new URL(url);
          filename = decodeURIComponent(u.pathname.split('/').pop() || 'adjunto');
        } catch {
          filename = 'adjunto';
        }
      }
      return { filename, content: buffer, contentType };
    } catch {
      return null;
    }
  }

  async enviarDesdeBuzon(
    userId: string,
    opts: {
      para: string;
      cc?: string[];
      asunto: string;
      cuerpo: string;
      imagenes?: string[];
      adjuntos?: Array<{ url: string; nombre?: string; mime?: string }>;
    },
  ) {
    const cuenta = await this.cuentaDeUsuario(userId);
    if (!cuenta) {
      throw new BadRequestException('Aún no has conectado tu cuenta de correo.');
    }
    const para = String(opts.para || '').trim().toLowerCase();
    if (!RE_EMAIL.test(para)) {
      throw new BadRequestException('El destinatario no es un correo válido.');
    }
    const cc = (Array.isArray(opts.cc) ? opts.cc : [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => e && RE_EMAIL.test(e));
    const asunto = String(opts.asunto || '').trim();
    if (!asunto) throw new BadRequestException('Falta el asunto del correo.');
    const cuerpo = String(opts.cuerpo || '').trim();
    if (!cuerpo) throw new BadRequestException('El correo no puede ir vacío.');

    // Imágenes/GIFs inline — solo aceptamos URLs http(s) válidas.
    const imagenes = (Array.isArray(opts.imagenes) ? opts.imagenes : [])
      .map((u) => String(u || '').trim())
      .filter((u) => /^https?:\/\//i.test(u));
    const imgsHtml = imagenes
      .map(
        (u) =>
          `<div style="margin:14px 0;"><img src="${u}" alt="" style="display:block;max-width:480px;width:100%;height:auto;border-radius:8px;" /></div>`,
      )
      .join('');

    // Descargamos cada adjunto desde su URL pública para incluirlo como
    // attachment real del correo (NO inline). Si una descarga falla, se
    // omite ese archivo en silencio para no romper el envío completo.
    const adjuntosRaw = Array.isArray(opts.adjuntos) ? opts.adjuntos : [];
    const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    for (const a of adjuntosRaw) {
      if (!a?.url || !/^https?:\/\//i.test(String(a.url))) continue;
      const adj = await this.descargarAdjuntoDesdeUrl(String(a.url), a.nombre);
      if (adj) {
        if (a.mime) adj.contentType = a.mime;
        attachments.push(adj);
      }
    }

    // Anexamos la firma del vendedor (default o personalizada).
    const firmaHtml = await this.firmas.htmlParaEnviar(userId);
    const cuerpoHtml =
      textoAHtml(cuerpo) +
      imgsHtml +
      (firmaHtml ? `<br><br>${firmaHtml}` : '');

    const res = await this.gmailApi.enviarComo(this.credsDe(cuenta), {
      remitente: cuenta.email,
      para,
      cc: cc.length > 0 ? cc : undefined,
      asunto,
      html: cuerpoHtml,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    return { ...res, de: cuenta.email };
  }

  // Destinatarios disponibles para autocompletar al redactar: usuarios de la
  // plataforma + correos a los que has escrito recientemente.
  async destinatariosBuzon(userId: string) {
    const cuenta = await this.cuentaDeUsuario(userId);
    const [perfilesRes, recientes] = await Promise.all([
      this.supabase
        .getClient()
        .from('profiles')
        .select('email, nombre')
        .order('nombre', { ascending: true }),
      cuenta
        ? this.gmailApi.destinatariosRecientes(this.credsDe(cuenta)).catch(() => [])
        : Promise.resolve([]),
    ]);

    const perfiles = (perfilesRes.data || [])
      .filter((p: any) => p?.email)
      .map((p: any) => ({
        email: String(p.email).toLowerCase(),
        nombre: String(p.nombre || ''),
        origen: 'plataforma' as const,
      }));

    const yo = String(cuenta?.email || '').toLowerCase();
    const recientesLimpios = recientes
      .map((r) => ({ email: r.email.toLowerCase(), nombre: r.nombre, origen: 'reciente' as const }))
      .filter((r) => r.email !== yo);

    // Mezclamos sin duplicados, priorizando los recientes (preserva el nombre
    // si vino más rico de uno u otro lado).
    const mapa = new Map<string, { email: string; nombre: string; origen: 'plataforma' | 'reciente' }>();
    for (const r of recientesLimpios) mapa.set(r.email, r);
    for (const p of perfiles) {
      if (p.email === yo) continue;
      if (mapa.has(p.email)) {
        const x = mapa.get(p.email)!;
        if (!x.nombre && p.nombre) x.nombre = p.nombre;
      } else mapa.set(p.email, p);
    }
    return Array.from(mapa.values()).slice(0, 100);
  }
}
