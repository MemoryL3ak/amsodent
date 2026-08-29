import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';

// Comunidad Amsodent: registro público (portal /comunidad, al que apunta el
// QR) con rate-limit por IP, correo de BIENVENIDA vía SMTP (MailingsService)
// y administración desde el submódulo Comunidad de la plataforma.
// Calcado del patrón de eventos.service.ts.

type RateEntry = { count: number; windowStart: number };

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_HITS = 8;

// URL pública del frontend, para armar el link del formulario (QR y correos).
const APP_URL = (process.env.PUBLIC_APP_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');
const RUTA_PORTAL = '/comunidad';
const LOGO_URL = 'https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png';
const TIENDA_URL = 'https://amsodentmedical.cl';

// Evento vigente del QR: Amsodent participa como auspiciador y el formulario
// captura a quienes visitan el stand. Al cambiar de evento, actualizar aquí
// (y el espejo EVENTO_QR en src/pages/ComunidadRegistro.jsx).
const EVENTO_QR = {
  key: 'congreso-adeo-uv-2026',
  nombre: 'Congreso ADEO Chile 2026',
  detalle: 'Rehabilitación Oral y Cirugía Maxilofacial · Universidad de Valparaíso',
};

function sanitizeText(input: unknown, max = 255): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class ComunidadService {
  private readonly logger = new Logger(ComunidadService.name);
  private readonly rateMap = new Map<string, RateEntry>();

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
  ) {}

  private checkRateLimit(ip: string) {
    if (!ip) return;
    const now = Date.now();
    const entry = this.rateMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
      this.rateMap.set(ip, { count: 1, windowStart: now });
      return;
    }
    if (entry.count >= RATE_MAX_HITS) {
      throw new HttpException(
        'Demasiados intentos desde esta red. Intenta nuevamente más tarde.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count += 1;
  }

  // Info del portal para el submódulo admin (QR y links).
  portalInfo() {
    return { ruta: RUTA_PORTAL, url: `${APP_URL}${RUTA_PORTAL}` };
  }

  async registrar(body: Record<string, any>, ip: string, userAgent: string) {
    this.checkRateLimit(ip);

    const nombre = sanitizeText(body?.nombre, 120);
    const apellido = sanitizeText(body?.apellido, 120);
    const telefono = sanitizeText(body?.telefono, 30);
    const correo = sanitizeText(body?.correo, 180).toLowerCase();
    const perfil = sanitizeText(body?.perfil, 20).toLowerCase();
    const anioEstudio = sanitizeText(body?.anio_estudio, 40) || null;
    const universidad = sanitizeText(body?.universidad, 200) || null;
    const especialidad = sanitizeText(body?.especialidad, 120) || null;
    const ciudad = sanitizeText(body?.ciudad, 120) || null;
    const comoConociste = sanitizeText(body?.como_conociste, 120) || null;
    const origen = sanitizeText(body?.origen, 120) || EVENTO_QR.key;
    const aceptaDatos = body?.acepta_datos === true;

    const faltantes: string[] = [];
    if (!nombre) faltantes.push('nombre');
    if (!apellido) faltantes.push('apellido');
    if (!telefono) faltantes.push('teléfono');
    if (!correo) faltantes.push('correo electrónico');
    if (perfil !== 'estudiante' && perfil !== 'dentista') {
      faltantes.push('perfil (estudiante o dentista)');
    }
    if (perfil === 'estudiante' && !anioEstudio) faltantes.push('año de estudio');
    if (perfil === 'dentista' && !especialidad) faltantes.push('especialidad');

    if (faltantes.length > 0) {
      throw new BadRequestException(`Faltan o son inválidos: ${faltantes.join(', ')}.`);
    }
    if (!isValidEmail(correo)) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }
    if ((telefono.match(/\d/g) || []).length < 8) {
      throw new BadRequestException('El teléfono no es válido (mínimo 8 dígitos).');
    }
    // Consentimiento obligatorio (Ley 19.628): sin él no se guarda nada.
    if (!aceptaDatos) {
      throw new BadRequestException(
        'Debes aceptar el tratamiento de tus datos personales para registrarte.',
      );
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('comunidad_registros')
      .insert([
        {
          nombre,
          apellido,
          telefono,
          correo,
          perfil,
          anio_estudio: perfil === 'estudiante' ? anioEstudio : null,
          universidad: perfil === 'estudiante' ? universidad : null,
          especialidad: perfil === 'dentista' ? especialidad : null,
          ciudad,
          como_conociste: comoConociste,
          origen,
          acepta_datos: true,
          acepta_datos_at: new Date().toISOString(),
          ip_origen: ip || null,
          user_agent: userAgent ? userAgent.slice(0, 400) : null,
        },
      ])
      .select('id, nombre, correo')
      .single();

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate key') || msg.includes('unique') || (error as any).code === '23505') {
        throw new ConflictException('Este correo ya es parte de la comunidad Amsodent.');
      }
      if (/does not exist|schema cache/i.test(error.message)) {
        throw new BadRequestException('Falta aplicar la migración 20260828_comunidad.sql en Supabase.');
      }
      throw new BadRequestException(error.message);
    }

    // Correo de bienvenida EN SEGUNDO PLANO: el registro responde de inmediato
    // aunque el SMTP esté lento o caído. Si falla, correo_enviado queda en
    // false y se reenvía desde el submódulo Comunidad.
    void this.enviarBienvenida(data.id, {
      nombre,
      apellido,
      correo,
      perfil,
      anioEstudio,
      universidad,
      especialidad,
    });

    return { id: data.id, nombre: data.nombre, ok: true };
  }

  private async enviarBienvenida(
    id: number,
    p: {
      nombre: string;
      apellido: string;
      correo: string;
      perfil: string;
      anioEstudio: string | null;
      universidad: string | null;
      especialidad: string | null;
    },
  ) {
    try {
      await this.mailings.enviarUno({
        para: p.correo,
        asunto: '¡Bienvenid@ a la Familia AMSODENT! 🦷',
        remitenteNombre: 'Amsodent Medical',
        cuerpoHtml: this.htmlBienvenida(p),
      });
      await this.supabase
        .getClient()
        .from('comunidad_registros')
        .update({ correo_enviado: true })
        .eq('id', id);
    } catch (e: any) {
      this.logger.warn(`Comunidad ${id}: no se pudo enviar la bienvenida a ${p.correo}: ${e?.message || e}`);
    }
  }

  // Correo de bienvenida (email-safe: tablas + estilos inline, mismo formato
  // de marca que los correos de eventos).
  private htmlBienvenida(p: {
    nombre: string;
    apellido: string;
    perfil: string;
    anioEstudio: string | null;
    universidad: string | null;
    especialidad: string | null;
  }): string {
    const esEstudiante = p.perfil === 'estudiante';
    const mensajePerfil = esEstudiante
      ? 'Queremos acompañarte durante toda tu formación: materiales de calidad, precios pensados para estudiantes y el respaldo de un equipo que conoce lo que necesitas en cada año de la carrera.'
      : 'Queremos ser el aliado de tu práctica clínica: insumos de calidad, marcas de nivel internacional y un equipo que responde cuando lo necesitas.';
    const intro = `¡Qué gusto encontrarte en el ${EVENTO_QR.nombre}! Como auspiciadores del congreso, queremos darte la bienvenida: desde hoy eres parte de la comunidad Amsodent.`;

    const filasDatos = [
      ['Nombre', `${p.nombre} ${p.apellido}`],
      esEstudiante
        ? ['Perfil', `Estudiante de Odontología · ${p.anioEstudio || ''}`]
        : ['Perfil', `Dentista · ${p.especialidad || ''}`],
      ...(esEstudiante && p.universidad ? [['Universidad', p.universidad]] : []),
    ]
      .map(
        ([k, v], i) =>
          `<tr>
            <td style="padding:10px 16px;color:#667085;font-size:13px;border-top:${i === 0 ? 'none' : '1px solid #eef2f6'};width:38%;">${escapeHtml(String(k))}</td>
            <td style="padding:10px 16px;color:#101828;font-size:13px;font-weight:bold;border-top:${i === 0 ? 'none' : '1px solid #eef2f6'};">${escapeHtml(String(v))}</td>
          </tr>`,
      )
      .join('');

    const beneficio = (emoji: string, texto: string) => `
      <tr>
        <td style="padding:6px 0;font-size:14px;width:30px;vertical-align:top;">${emoji}</td>
        <td style="padding:6px 0;font-size:13.5px;color:#475467;line-height:1.55;">${texto}</td>
      </tr>`;

    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e7ec;">

      <!-- Franja de marca -->
      <tr><td style="height:6px;background:#28aeb1;background:linear-gradient(90deg,#28aeb1,#6fd0d2,#1e9295);font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- Logo sobre blanco -->
      <tr><td align="center" style="padding:26px 24px 18px;">
        <img src="${LOGO_URL}" alt="AMSODENT" width="170" style="display:block;width:170px;max-width:60%;height:auto;" />
      </td></tr>

      <!-- Hero de bienvenida (fondo oscuro corporativo) -->
      <tr><td style="padding:0 24px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f3740;background:linear-gradient(150deg,#0d2d35,#0f3740);border-radius:14px;">
          <tr><td align="center" style="padding:28px 26px;">
            <div style="display:inline-block;background:rgba(40,174,177,.18);border:1px solid rgba(40,174,177,.5);color:#7fd6d8;font-size:11px;font-weight:bold;letter-spacing:.09em;border-radius:999px;padding:5px 12px;margin-bottom:12px;">GRACIAS POR SUMARTE</div>
            <h1 style="margin:0 0 6px;color:#ffffff;font-size:24px;line-height:1.25;">¡Bienvenid@ a la Familia<br/>AMSODENT!</h1>
            <p style="margin:0;color:rgba(255,255,255,.75);font-size:13.5px;line-height:1.5;">${escapeHtml(EVENTO_QR.nombre)} · ${escapeHtml(EVENTO_QR.detalle)}</p>
          </td></tr>
        </table>
      </td></tr>

      <!-- Cuerpo -->
      <tr><td style="padding:22px 26px 4px;">
        <p style="margin:0 0 12px;color:#101828;font-size:14.5px;">Hola <strong>${escapeHtml(p.nombre)}</strong>:</p>
        <p style="margin:0 0 10px;color:#475467;font-size:14px;line-height:1.6;">
          ${escapeHtml(intro)}
        </p>
        <p style="margin:0 0 16px;color:#475467;font-size:14px;line-height:1.6;">
          ${escapeHtml(mensajePerfil)}
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef2f6;border-radius:12px;overflow:hidden;margin-bottom:18px;">
          ${filasDatos}
        </table>

        <p style="margin:0 0 8px;color:#101828;font-size:14px;font-weight:bold;">Como parte de la comunidad recibirás:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
          ${beneficio('🎁', 'Promociones y precios preferentes antes que nadie.')}
          ${beneficio('📅', 'Invitaciones a nuestros eventos, charlas y lanzamientos.')}
          ${beneficio('🦷', 'Novedades de las marcas que representamos en Chile.')}
          ${beneficio('🤝', 'Atención personalizada de nuestro equipo cuando la necesites.')}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 18px;">
          <tr><td align="center" style="border-radius:12px;background:#1e9295;background:linear-gradient(135deg,#28aeb1,#1e9295);">
            <a href="${TIENDA_URL}" target="_blank"
               style="display:inline-block;padding:14px 34px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:12px;">
              CONOCE NUESTROS PRODUCTOS &rarr;
            </a>
          </td></tr>
        </table>

        <p style="margin:0 0 24px;color:#101828;font-size:14px;">¡Nos vemos pronto!<br/><strong>Equipo AMSODENT</strong></p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:14px 26px;background:#f8fafc;border-top:1px solid #eef2f6;">
        <span style="color:#98a2b3;font-size:11.5px;">© ${new Date().getFullYear()} AMSODENT MEDICAL · Representante oficial de American Burrs en Chile.<br/>Recibiste este correo porque te uniste a la comunidad Amsodent.</span>
      </td></tr>

    </table>
  </td></tr>
</table>`;
  }

  async listar() {
    const { data, error } = await this.supabase
      .getClient()
      .from('comunidad_registros')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, 20000);
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260828_comunidad.sql en Supabase.'
          : error.message,
      );
    }
    return data || [];
  }

  async eliminar(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('comunidad_registros')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Reenvía la bienvenida a un registro puntual (p. ej. si el SMTP estaba
  // caído al registrarse). Sincrónico, con el motivo del error si falla.
  async reenviarBienvenida(id: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('comunidad_registros')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Registro no encontrado.');

    try {
      await this.mailings.enviarUno({
        para: data.correo,
        asunto: '¡Bienvenid@ a la Familia AMSODENT! 🦷',
        remitenteNombre: 'Amsodent Medical',
        cuerpoHtml: this.htmlBienvenida({
          nombre: data.nombre,
          apellido: data.apellido,
          perfil: data.perfil,
          anioEstudio: data.anio_estudio,
          universidad: data.universidad,
          especialidad: data.especialidad,
        }),
      });
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        `No se pudo enviar el correo: ${String(e?.message || e).slice(0, 200)}`,
      );
    }
    await this.supabase
      .getClient()
      .from('comunidad_registros')
      .update({ correo_enviado: true })
      .eq('id', id);
    return { ok: true };
  }
}
