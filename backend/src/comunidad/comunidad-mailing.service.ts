import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { LOGO_AMSODENT_URL, APP_PUBLICA_URL } from '../correos/logo';
import { ComunidadService } from './comunidad.service';
import {
  CID_IMAGEN, MAX_DESTINATARIOS, elegirDestinatarios, enlaceBaja, estadoDeEnvio, htmlMailing, leerEnlaceBaja, validarContenido,
} from './comunidad-mailing';

/* ── Mailing a la Comunidad Amsodent (2026-11-19) ────────────────────────────
   Ver comunidad-mailing.ts (la lógica). Este servicio pone la base de datos y
   el correo:
     · simular  → a cuántos llega, a quiénes no y por qué, y la vista previa.
                  No envía ni registra nada.
     · prueba   → el mismo correo, solo a quien lo está redactando.
     · enviar   → registra el envío y lo despacha en segundo plano, uno por
                  persona; el avance se consulta en `envios`.
     · bajas    → quien pincha «date de baja» deja de recibir los mailings.
   La tabla `comunidad_bajas` y el origen del envío vienen de la migración
   20261119_comunidad_mailing.sql. Sin ella el mailing funciona igual, pero el
   pie del correo pide responder «BAJA» (no hay enlace) y no hay historial. */

const FALTA_MIGRACION = 'Falta aplicar la migración 20261119_comunidad_mailing.sql en Supabase: sin ella no hay enlace para darse de baja ni historial de los envíos de Comunidad.';
const noExiste = (e: any) => /^(42P01|42703|PGRST204|PGRST205)$/.test(String(e?.code || '')) || /does not exist|schema cache|could not find/i.test(String(e?.message || ''));
const IMAGEN_MAX = 4 * 1024 * 1024;
const AVISO_TOPE_DIARIO = 450;

type Imagen = { buffer: Buffer; mimetype: string; originalname?: string } | null | undefined;

@Injectable()
export class ComunidadMailingService {
  private readonly logger = new Logger(ComunidadMailingService.name);

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
    private comunidad: ComunidadService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  private secreto(): string {
    return String(process.env.COMUNIDAD_BAJA_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'amsodent');
  }

  /** Correos dados de baja. `listo: false` = falta la migración (nadie está de baja). */
  private async leerBajas(): Promise<{ listo: boolean; bajas: { correo: string; created_at: string; origen: string | null }[] }> {
    const bajas: any[] = [];
    for (let desde = 0; desde < 50000; desde += 1000) {
      const { data, error } = await this.db.from('comunidad_bajas').select('correo, created_at, origen').order('created_at', { ascending: false }).range(desde, desde + 999);
      if (error) {
        if (!noExiste(error)) this.logger.warn(`Comunidad: no se leyeron las bajas: ${error.message}`);
        return { listo: false, bajas: [] };
      }
      bajas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { listo: true, bajas };
  }

  private refsDe(body: any): string[] | null {
    if (body?.todos === true || body?.todos === 'true') return null;
    let refs = body?.refs;
    if (typeof refs === 'string') {
      try { refs = JSON.parse(refs); } catch { refs = []; }
    }
    const lista = [...new Set((Array.isArray(refs) ? refs : []).map((r) => String(r)))].slice(0, 20000);
    if (!lista.length) throw new BadRequestException('Elige a quién va el correo.');
    return lista;
  }

  private validarImagen(imagen: Imagen): string | null {
    if (!imagen) return null;
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(String(imagen.mimetype || ''))) return 'La imagen debe ser PNG, JPG, GIF o WEBP.';
    if (!imagen.buffer?.length || imagen.buffer.length > IMAGEN_MAX) return 'La imagen pesa más de 4 MB: achícala antes de adjuntarla.';
    return null;
  }

  /* Todo lo que simular, la prueba y el envío comparten: a quiénes, qué y cómo se ve. */
  private async preparar(body: any, imagen: Imagen) {
    const { contenido, problemas } = validarContenido({ ...body, con_imagen: !!imagen || body?.con_imagen });
    const errImagen = this.validarImagen(imagen);
    if (errImagen) problemas.push(errImagen);
    const [filas, bajas] = await Promise.all([this.comunidad.listar(), this.leerBajas()]);
    const seleccion = elegirDestinatarios(filas, this.refsDe(body), bajas.bajas.map((b) => b.correo));
    if (seleccion.destinatarios.length > MAX_DESTINATARIOS) problemas.push(`Son más de ${MAX_DESTINATARIOS.toLocaleString('es-CL')} destinatarios: divide el envío por categoría.`);
    const avisos: string[] = [];
    if (!bajas.listo) avisos.push(FALTA_MIGRACION);
    if (!this.mailings.smtpConfigurado()) avisos.push('El servidor no tiene configurado el correo de envío (SMTP_USER / SMTP_PASS): el mailing no puede salir desde aquí.');
    if (seleccion.destinatarios.length > AVISO_TOPE_DIARIO) avisos.push(`Son ${seleccion.destinatarios.length.toLocaleString('es-CL')} correos: Gmail limita los envíos diarios de la cuenta (500 en una cuenta común, 2.000 en Workspace). Si el tope se alcanza, los que falten quedan como fallidos.`);
    if (/\{\s*nombre\s*\}/i.test(contenido.mensaje)) {
      const sinNombre = seleccion.destinatarios.filter((d) => !d.nombre).length;
      if (sinNombre) avisos.push(`${sinNombre} destinatario(s) no tienen nombre: su saludo sale sin él.`);
    }
    const htmlDe = (d: { correo: string; nombre: string }) =>
      htmlMailing(contenido, d, { logoUrl: LOGO_AMSODENT_URL, urlBaja: bajas.listo ? enlaceBaja(APP_PUBLICA_URL, d.correo, this.secreto()) : null });
    return { contenido, problemas, avisos, seleccion, bajas, htmlDe };
  }

  async simular(body: any, imagen: Imagen) {
    const p = await this.preparar(body, imagen);
    const ejemplo = p.seleccion.destinatarios[0] || { correo: 'persona@ejemplo.cl', nombre: 'Ana' };
    return {
      simulacion: true,
      bloqueada: p.problemas.length > 0 || p.seleccion.destinatarios.length === 0,
      problemas: p.seleccion.destinatarios.length === 0 && !p.problemas.length ? ['Ninguna de las filas elegidas tiene un correo al que escribir.'] : p.problemas,
      avisos: p.avisos,
      filas: p.seleccion.filas,
      destinatarios: p.seleccion.destinatarios.length,
      excluidos: p.seleccion.excluidos,
      por_categoria: p.seleccion.por_categoria,
      muestra: p.seleccion.destinatarios.slice(0, 12).map((d) => ({ correo: d.correo, nombre: d.nombre })),
      asunto: p.contenido.asunto,
      // La vista previa es el correo del primer destinatario; la imagen la pone la pantalla (cid).
      ejemplo: { correo: ejemplo.correo, nombre: ejemplo.nombre },
      html: p.htmlDe(ejemplo),
      cid_imagen: CID_IMAGEN,
      con_baja: p.bajas.listo,
      smtp: this.mailings.smtpConfigurado(),
    };
  }

  private adjuntos(imagen: Imagen) {
    return imagen ? [{ filename: imagen.originalname || 'imagen.png', content: imagen.buffer, contentType: String(imagen.mimetype), cid: CID_IMAGEN }] : undefined;
  }

  /** El correo tal cual, solo a quien lo redacta (el saludo usa el primer destinatario como ejemplo). */
  async prueba(body: any, imagen: Imagen, usuarioEmail: string | null) {
    if (!usuarioEmail) throw new BadRequestException('No se sabe a qué correo enviarte la prueba.');
    const p = await this.preparar({ ...body, todos: body?.refs ? body?.todos : true }, imagen);
    if (p.problemas.length) throw new BadRequestException(p.problemas.join(' '));
    const ejemplo = p.seleccion.destinatarios[0] || { correo: usuarioEmail, nombre: '' };
    try {
      await this.mailings.enviarUno({
        para: usuarioEmail,
        asunto: `[PRUEBA] ${p.contenido.asunto}`,
        remitenteNombre: 'Amsodent Medical',
        cuerpoHtml: p.htmlDe({ correo: usuarioEmail, nombre: ejemplo.nombre }),
        attachments: this.adjuntos(imagen),
      });
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`No se pudo enviar la prueba: ${String(e?.message || e).slice(0, 220)}`);
    }
    return { ok: true, para: usuarioEmail };
  }

  async enviar(body: any, imagen: Imagen, usuarioEmail: string | null) {
    const p = await this.preparar(body, imagen);
    if (p.problemas.length) throw new BadRequestException(p.problemas.join(' '));
    if (!p.seleccion.destinatarios.length) throw new BadRequestException('Ninguna de las filas elegidas tiene un correo al que escribir.');
    // El envío real exige haber visto la simulación de ESTE mismo público.
    const esperados = Number(body?.destinatarios_esperados);
    if (Number.isFinite(esperados) && esperados > 0 && esperados !== p.seleccion.destinatarios.length) {
      throw new BadRequestException(`La lista cambió desde la simulación (eran ${esperados} destinatarios y ahora son ${p.seleccion.destinatarios.length}): simula de nuevo antes de enviar.`);
    }
    const porCorreo = new Map(p.seleccion.destinatarios.map((d) => [d.correo, d]));
    const secreto = this.secreto();
    const r = await this.mailings.iniciarEnvioPersonalizado({
      destinatarios: p.seleccion.destinatarios.map((d) => d.correo),
      asunto: p.contenido.asunto,
      remitenteNombre: 'Amsodent Medical',
      replyTo: usuarioEmail,
      htmlPara: (email) => p.htmlDe(porCorreo.get(email) || { correo: email, nombre: '' }),
      cabecerasPara: p.bajas.listo ? (email) => ({ 'List-Unsubscribe': `<${enlaceBaja(APP_PUBLICA_URL, email, secreto)}>` }) : undefined,
      inlineAttachments: this.adjuntos(imagen) as any,
      creadoPor: usuarioEmail,
      origen: 'comunidad',
      detalle: {
        filas: p.seleccion.filas,
        excluidos: p.seleccion.excluidos,
        por_categoria: p.seleccion.por_categoria,
        todos: body?.todos === true || body?.todos === 'true',
        publico: String(body?.publico || '').slice(0, 200) || null,
        boton: p.contenido.boton_texto || null,
      },
    });
    this.logger.log(`Comunidad: mailing «${p.contenido.asunto}» iniciado por ${usuarioEmail} a ${r.total} destinatario(s) (envío ${r.envioId})`);
    return { iniciado: true, envio_id: r.envioId, total: r.total, excluidos: p.seleccion.excluidos };
  }

  /** Los mailings de Comunidad, del más nuevo al más viejo, con su avance y aperturas. */
  async envios() {
    const { data, error } = await this.db.from('mailings_envios').select('id, asunto, total, enviados, fallidos, con_flyer, creado_por, creado_at, detalle').eq('origen', 'comunidad').order('id', { ascending: false }).limit(30);
    if (error) return { listo: false, mensaje: noExiste(error) ? FALTA_MIGRACION : error.message, envios: [] };
    const envios = (data || []) as any[];
    if (!envios.length) return { listo: true, mensaje: null, envios: [] };
    const dest: any[] = [];
    const ids = envios.map((e) => Number(e.id));
    for (let desde = 0; desde < 60000; desde += 1000) {
      const { data: d, error: e } = await this.db.from('mailings_destinatarios').select('envio_id, enviado_at, abierto_at, fallo').in('envio_id', ids).order('id', { ascending: true }).range(desde, desde + 999);
      if (e) break;
      dest.push(...(d || []));
      if (!d || d.length < 1000) break;
    }
    const porEnvio = new Map<number, any[]>();
    for (const d of dest) porEnvio.set(Number(d.envio_id), [...(porEnvio.get(Number(d.envio_id)) || []), d]);
    return {
      listo: true,
      mensaje: null,
      envios: envios.map((e) => ({
        id: e.id, asunto: e.asunto, total: e.total, con_imagen: !!e.con_flyer, creado_por: e.creado_por, creado_at: e.creado_at,
        publico: e.detalle?.publico || null, excluidos: e.detalle?.excluidos || null,
        ...estadoDeEnvio(Number(e.total) || 0, porEnvio.get(Number(e.id)) || [], this.mailings.envioEnCurso(Number(e.id))),
      })),
    };
  }

  /** Un envío con cada destinatario: enviado, abierto o por qué falló. */
  async envio(id: number) {
    const { data: e, error } = await this.db.from('mailings_envios').select('id, asunto, total, creado_por, creado_at, origen').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(noExiste(error) ? FALTA_MIGRACION : error.message);
    if (!e || (e as any).origen !== 'comunidad') throw new BadRequestException('Ese envío no es de Comunidad.');
    const dest: any[] = [];
    for (let desde = 0; desde < 20000; desde += 1000) {
      const { data: d, error: err } = await this.db.from('mailings_destinatarios').select('email, enviado_at, abierto_at, fallo').eq('envio_id', id).order('email', { ascending: true }).range(desde, desde + 999);
      if (err) throw new BadRequestException(err.message);
      dest.push(...(d || []));
      if (!d || d.length < 1000) break;
    }
    return { envio: e, destinatarios: dest, ...estadoDeEnvio(Number((e as any).total) || 0, dest, this.mailings.envioEnCurso(id)) };
  }

  async bajas() {
    const r = await this.leerBajas();
    return { listo: r.listo, mensaje: r.listo ? null : FALTA_MIGRACION, bajas: r.bajas };
  }

  /** Volver a escribirle a alguien que se dio de baja (porque lo pidió o fue un error). */
  async reactivar(correo: string) {
    const c = String(correo || '').trim().toLowerCase();
    if (!c) throw new BadRequestException('Indica el correo.');
    const { error } = await this.db.from('comunidad_bajas').delete().eq('correo', c);
    if (error) throw new BadRequestException(noExiste(error) ? FALTA_MIGRACION : error.message);
    return { ok: true, correo: c };
  }

  /** Baja a mano desde la plataforma (alguien lo pidió por teléfono o respondiendo el correo). */
  async darDeBaja(correo: string, usuarioEmail: string | null) {
    const c = String(correo || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) throw new BadRequestException('Ese correo no es válido.');
    const { error } = await this.db.from('comunidad_bajas').upsert({ correo: c, origen: 'manual', anotado_por: usuarioEmail || null }, { onConflict: 'correo' });
    if (error) throw new BadRequestException(noExiste(error) ? FALTA_MIGRACION : error.message);
    return { ok: true, correo: c };
  }

  /* ── Público: el enlace «date de baja» del correo ── */
  /** Qué correo trae el enlace (para mostrarlo antes de confirmar). No cambia nada. */
  consultarBaja(c: any, f: any) {
    const correo = leerEnlaceBaja(c, f, this.secreto());
    if (!correo) throw new BadRequestException('El enlace de baja no es válido o está incompleto.');
    const [usuario, dominio] = correo.split('@');
    return { correo: `${usuario.slice(0, 2)}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}` };
  }

  async confirmarBaja(c: any, f: any) {
    const correo = leerEnlaceBaja(c, f, this.secreto());
    if (!correo) throw new BadRequestException('El enlace de baja no es válido o está incompleto.');
    const { error } = await this.db.from('comunidad_bajas').upsert({ correo, origen: 'enlace' }, { onConflict: 'correo' });
    if (error) {
      this.logger.warn(`Comunidad: no se pudo anotar la baja de ${correo}: ${error.message}`);
      throw new BadRequestException('No pudimos registrar tu baja en este momento. Responde el correo con la palabra BAJA y lo hacemos a mano.');
    }
    this.logger.log(`Comunidad: ${correo} se dio de baja de los mailings`);
    return { ok: true };
  }
}
