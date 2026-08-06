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

// Inscripciones al evento AMSODENT: registro público (portal /evento) con
// rate-limit por IP, correo de confirmación vía SMTP (MailingsService) y
// administración desde el submódulo Evento de la plataforma.

type RateEntry = { count: number; windowStart: number };

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_HITS = 8;

// Datos del evento que aparecen en el correo de confirmación. Si cambian la
// fecha/lugar del evento, se actualizan aquí.
const EVENTO = {
  nombre: 'American Burrs llega a Chile',
  descripcion: 'Lanzamiento oficial y charla internacional junto al Dr. Amilcar Freitas',
  fecha: 'Lunes 17 de agosto',
  hora: '19:30 hrs',
  lugar: 'Best Western Premier Las Condes',
  lugarUrl: 'https://maps.google.com/?q=Best+Western+Premier+Las+Condes',
};

const LOGO_URL = 'https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png';

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
export class EventosService {
  private readonly logger = new Logger(EventosService.name);
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

  async registrar(body: Record<string, any>, ip: string, userAgent: string) {
    this.checkRateLimit(ip);

    const nombre = sanitizeText(body?.nombre, 120);
    const apellido = sanitizeText(body?.apellido, 120);
    const telefono = sanitizeText(body?.telefono, 30);
    const correo = sanitizeText(body?.correo, 180).toLowerCase();
    const especialidad = sanitizeText(body?.especialidad, 120);
    const esProfesor = Boolean(body?.es_profesor);
    const universidad = sanitizeText(body?.universidad, 200) || null;
    const confirmaAsistencia = Boolean(body?.confirma_asistencia);

    const faltantes: string[] = [];
    if (!nombre) faltantes.push('nombre');
    if (!apellido) faltantes.push('apellido');
    if (!telefono) faltantes.push('teléfono');
    if (!correo) faltantes.push('correo electrónico');
    if (!especialidad) faltantes.push('especialidad');
    if (esProfesor && !universidad) {
      faltantes.push('universidad donde da clases');
    }

    if (faltantes.length > 0) {
      throw new BadRequestException(`Faltan o son inválidos: ${faltantes.join(', ')}.`);
    }
    if (!isValidEmail(correo)) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }
    // El teléfono debe traer al menos 8 dígitos reales.
    if ((telefono.match(/\d/g) || []).length < 8) {
      throw new BadRequestException('El teléfono no es válido (mínimo 8 dígitos).');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('evento_inscripciones')
      .insert([
        {
          nombre,
          apellido,
          telefono,
          correo,
          especialidad,
          es_profesor: esProfesor,
          universidad: esProfesor ? universidad : null,
          confirma_asistencia: confirmaAsistencia,
          ip_origen: ip || null,
          user_agent: userAgent ? userAgent.slice(0, 400) : null,
        },
      ])
      .select('id, nombre, apellido, correo')
      .single();

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate key') || msg.includes('unique') || (error as any).code === '23505') {
        throw new ConflictException('Este correo ya está inscrito en el evento.');
      }
      throw new BadRequestException(error.message);
    }

    // Correo de confirmación: si el SMTP falla, la inscripción vale igual
    // (correo_enviado queda en false y se ve en el listado admin).
    let correoEnviado = false;
    try {
      await this.mailings.enviarUno({
        para: correo,
        asunto: `Confirmación de inscripción · ${EVENTO.nombre}`,
        remitenteNombre: 'Amsodent Medical',
        cuerpoHtml: this.htmlConfirmacion({ nombre, apellido, especialidad, esProfesor, universidad, confirmaAsistencia }),
      });
      correoEnviado = true;
      await this.supabase
        .getClient()
        .from('evento_inscripciones')
        .update({ correo_enviado: true })
        .eq('id', data.id);
    } catch (e: any) {
      this.logger.warn(`Inscripción ${data.id}: no se pudo enviar la confirmación a ${correo}: ${e?.message || e}`);
    }

    return { id: data.id, nombre: data.nombre, ok: true, correo_enviado: correoEnviado };
  }

  // HTML del correo de confirmación (email-safe: tablas + estilos inline).
  private htmlConfirmacion(p: {
    nombre: string;
    apellido: string;
    especialidad: string;
    esProfesor: boolean;
    universidad: string | null;
    confirmaAsistencia: boolean;
  }): string {
    const filasDatos = [
      ['Nombre', `${p.nombre} ${p.apellido}`],
      ['Especialidad', p.especialidad],
      ...(p.esProfesor ? [['Docencia', `Profesor(a) en ${p.universidad}`]] : []),
      ['Asistencia', p.confirmaAsistencia ? 'Confirmada' : 'Por confirmar'],
    ]
      .map(
        ([k, v], i) =>
          `<tr>
            <td style="padding:10px 16px;color:#667085;font-size:13px;border-top:${i === 0 ? 'none' : '1px solid #eef2f6'};width:38%;">${escapeHtml(String(k))}</td>
            <td style="padding:10px 16px;color:#101828;font-size:13px;font-weight:bold;border-top:${i === 0 ? 'none' : '1px solid #eef2f6'};">${escapeHtml(String(v))}</td>
          </tr>`,
      )
      .join('');

    const filaEvento = (emoji: string, etiqueta: string, valor: string) => `
      <tr>
        <td style="padding:7px 0;font-size:13px;color:rgba(255,255,255,.75);width:90px;white-space:nowrap;">${emoji}&nbsp; ${etiqueta}</td>
        <td style="padding:7px 0;font-size:13.5px;color:#ffffff;font-weight:bold;">${valor}</td>
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

      <!-- Hero del evento (fondo oscuro corporativo) -->
      <tr><td style="padding:0 24px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f3740;background:linear-gradient(150deg,#0d2d35,#0f3740);border-radius:14px;">
          <tr><td style="padding:24px 26px;">
            <div style="display:inline-block;background:rgba(40,174,177,.18);border:1px solid rgba(40,174,177,.5);color:#7fd6d8;font-size:11px;font-weight:bold;letter-spacing:.09em;border-radius:999px;padding:5px 12px;margin-bottom:12px;">INSCRIPCI&Oacute;N CONFIRMADA</div>
            <h1 style="margin:0 0 6px;color:#ffffff;font-size:22px;line-height:1.25;">${escapeHtml(EVENTO.nombre)}</h1>
            <p style="margin:0 0 16px;color:rgba(255,255,255,.75);font-size:13.5px;line-height:1.5;">${escapeHtml(EVENTO.descripcion)}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${filaEvento('📅', 'Fecha', escapeHtml(EVENTO.fecha))}
              ${filaEvento('🕢', 'Hora', escapeHtml(EVENTO.hora))}
              ${filaEvento('📍', 'Lugar', `<a href="${EVENTO.lugarUrl}" style="color:#7fd6d8;text-decoration:underline;">${escapeHtml(EVENTO.lugar)}</a>`)}
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Cuerpo -->
      <tr><td style="padding:22px 26px 4px;">
        <p style="margin:0 0 12px;color:#101828;font-size:14.5px;">Hola <strong>${escapeHtml(p.nombre)}</strong>:</p>
        <p style="margin:0 0 18px;color:#475467;font-size:14px;line-height:1.6;">
          ¡Tu cupo quedó reservado! Recibimos tu inscripción con los siguientes datos:
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #eef2f6;border-radius:12px;overflow:hidden;margin-bottom:18px;">
          ${filasDatos}
        </table>
        <p style="margin:0 0 18px;color:#475467;font-size:14px;line-height:1.6;">
          Te enviaremos por este medio cualquier novedad o recordatorio del evento.
          Si necesitas corregir tus datos, simplemente responde este correo.
        </p>
        <p style="margin:0 0 24px;color:#101828;font-size:14px;">¡Te esperamos!<br/><strong>Equipo AMSODENT</strong></p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:14px 26px;background:#f8fafc;border-top:1px solid #eef2f6;">
        <span style="color:#98a2b3;font-size:11.5px;">© ${new Date().getFullYear()} AMSODENT MEDICAL · Representante oficial de American Burrs en Chile.<br/>Este correo confirma tu inscripción al evento.</span>
      </td></tr>

    </table>
  </td></tr>
</table>`;
  }

  async listar() {
    const { data, error } = await this.supabase
      .getClient()
      .from('evento_inscripciones')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, 20000);
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260805_evento_inscripciones.sql en Supabase.'
          : error.message,
      );
    }
    return data || [];
  }

  async eliminar(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('evento_inscripciones')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }

  // Reenvía la confirmación a una inscripción puntual (p. ej. si el SMTP
  // estaba caído al registrarse).
  async reenviarConfirmacion(id: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('evento_inscripciones')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Inscripción no encontrada.');

    try {
      await this.mailings.enviarUno({
        para: data.correo,
        asunto: `Confirmación de inscripción · ${EVENTO.nombre}`,
        remitenteNombre: 'Amsodent Medical',
        cuerpoHtml: this.htmlConfirmacion({
          nombre: data.nombre,
          apellido: data.apellido,
          especialidad: data.especialidad,
          esProfesor: Boolean(data.es_profesor),
          universidad: data.universidad,
          confirmaAsistencia: Boolean(data.confirma_asistencia),
        }),
      });
    } catch (e: any) {
      // Los errores de nodemailer (auth SMTP, conexión) no son HttpException y
      // llegarían al cliente como 500 sin detalle: se envuelven con el motivo.
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        `No se pudo enviar el correo: ${String(e?.message || e).slice(0, 200)}`,
      );
    }
    await this.supabase
      .getClient()
      .from('evento_inscripciones')
      .update({ correo_enviado: true })
      .eq('id', id);
    return { ok: true };
  }
}
