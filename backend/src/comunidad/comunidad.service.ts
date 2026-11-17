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
import { LOGO_AMSODENT_URL } from '../correos/logo';
import { categoriaDeSorteo, esCategoria, esFaltaMigracion, leerRef, unirComunidad } from './comunidad-categorias';

const FALTA_MIGRACION_CATEGORIAS = 'Falta aplicar la migración 20261117_comunidad_categorias_rastreo.sql en Supabase: sin ella no se puede guardar la categoría.';

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
// El logo vive en el sistema (el del sitio web ya no existe): ver correos/logo.ts.
const LOGO_URL = LOGO_AMSODENT_URL;
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
        /* (2026-11-17) El correo puede estar en Comunidad solo porque se le
           guardó una categoría a alguien de un sorteo o un evento: esa persona
           nunca llenó este formulario, así que se le acepta el registro sobre
           su misma fila (conserva la categoría) y recibe su bienvenida. */
        const adoptada = await this.adoptarFila(correo, {
          nombre, apellido, telefono, perfil,
          anio_estudio: perfil === 'estudiante' ? anioEstudio : null,
          universidad: perfil === 'estudiante' ? universidad : null,
          especialidad: perfil === 'dentista' ? especialidad : null,
          ciudad, como_conociste: comoConociste, origen,
          acepta_datos: true, acepta_datos_at: new Date().toISOString(),
          ip_origen: ip || null, user_agent: userAgent ? userAgent.slice(0, 400) : null,
          fuente: 'comunidad',
        });
        if (adoptada) {
          void this.enviarBienvenida(adoptada, { nombre, apellido, correo, perfil, anioEstudio, universidad, especialidad });
          return { id: adoptada, nombre, ok: true };
        }
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

  /* Si el correo está en Comunidad como persona de un sorteo o evento (nunca
     llenó el formulario), le pone los datos del formulario. Devuelve su id, o
     null si no hay tal fila (o la base aún no distingue la fuente). */
  private async adoptarFila(correo: string, datos: Record<string, any>): Promise<number | null> {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('comunidad_registros').select('id, fuente').eq('correo', correo).in('fuente', ['sorteo', 'evento']).limit(1);
    const fila = !error && (data || [])[0];
    if (!fila) return null;
    const { error: errUpd } = await db.from('comunidad_registros').update(datos).eq('id', (fila as any).id);
    return errUpd ? null : Number((fila as any).id);
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

  /* Todas las filas de una tabla, de a 1.000 (el tope por consulta de la API). */
  private async todas(tabla: string, columnas: string): Promise<{ filas: any[]; error: any }> {
    const filas: any[] = [];
    for (let desde = 0; desde < 50000; desde += 1000) {
      const { data, error } = await this.supabase.getClient().from(tabla).select(columnas).order('id', { ascending: true }).range(desde, desde + 999);
      if (error) return { filas, error };
      filas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { filas, error: null };
  }

  /* (2026-11-17) La lista de Comunidad une, en vivo, el formulario del QR, las
     clínicas rastreadas y las personas de sorteos y eventos (una fila por
     correo), cada una con su categoría: la guardada o la que se deduce del
     origen. Ver comunidad-categorias.ts. Si las tablas de sorteos o eventos no
     se pueden leer, la lista sale igual sin ellas. */
  async listar() {
    const [registros, participantes, sorteos, inscripciones] = await Promise.all([
      this.todas('comunidad_registros', '*'),
      this.todas('sorteo_participantes', 'id, sorteo_id, nombre, email, tipo_perfil, universidad_clinica, especialidad, es_estudiante, anio, created_at'),
      this.todas('sorteos', 'id, titulo'),
      this.todas('evento_inscripciones', 'id, evento, nombre, apellido, telefono, correo, especialidad, es_profesor, universidad, created_at'),
    ]);
    if (registros.error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(registros.error.message)
          ? 'Falta aplicar la migración 20260828_comunidad.sql en Supabase.'
          : registros.error.message,
      );
    }
    // El formulario antiguo de sorteos no tenía `es_estudiante` ni `anio`: se lee lo que haya.
    let parts = participantes;
    if (parts.error && /es_estudiante|anio|sorteo_id|42703/i.test(`${parts.error.message} ${parts.error.code || ''}`)) {
      parts = await this.todas('sorteo_participantes', 'id, nombre, email, tipo_perfil, universidad_clinica, especialidad, created_at');
    }
    if (parts.error) this.logger.warn(`Comunidad: no se leyeron los participantes de sorteos: ${parts.error.message}`);
    if (inscripciones.error) this.logger.warn(`Comunidad: no se leyeron las inscripciones a eventos: ${inscripciones.error.message}`);
    return unirComunidad(registros.filas, parts.error ? [] : parts.filas, inscripciones.error ? [] : inscripciones.filas, sorteos.error ? [] : sorteos.filas);
  }

  /* (2026-11-17) Guarda la categoría de una o más filas de la lista. Las de
     Comunidad se actualizan; a una persona que solo figura en un sorteo o un
     evento se le crea su fila en Comunidad (con sus datos de origen) para
     tener dónde guardar la categoría. `refs`: 'comunidad:12', 'sorteo:55',
     'evento:8' (el `ref` de cada fila de la lista). */
  async categorizar(body: { refs?: string[]; categoria?: string }, usuarioEmail: string | null) {
    const categoria = String(body?.categoria || '').trim();
    if (!esCategoria(categoria)) throw new BadRequestException('Elige una categoría válida.');
    const refs = [...new Set((Array.isArray(body?.refs) ? body.refs : []).map((r) => String(r)))].slice(0, 2000);
    const leidas = refs.map(leerRef).filter(Boolean) as { tipo: 'comunidad' | 'sorteo' | 'evento'; id: number }[];
    if (!leidas.length) throw new BadRequestException('Indica qué filas categorizar.');

    const db = this.supabase.getClient();
    const ahora = new Date().toISOString();
    const marca = { categoria, categoria_por: usuarioEmail || null, categoria_at: ahora };
    const faltaMigracion = (e: any) => new BadRequestException(esFaltaMigracion(e) ? FALTA_MIGRACION_CATEGORIAS : e?.message || 'No se pudo guardar la categoría.');
    let actualizadas = 0;

    // 1) Filas que ya están en Comunidad.
    const idsComunidad = leidas.filter((r) => r.tipo === 'comunidad').map((r) => r.id);
    for (let i = 0; i < idsComunidad.length; i += 200) {
      const { data, error } = await db.from('comunidad_registros').update(marca).in('id', idsComunidad.slice(i, i + 200)).select('id');
      if (error) throw faltaMigracion(error);
      actualizadas += (data || []).length;
    }

    // 2) Personas que solo están en un sorteo o un evento: se les crea su fila.
    const virtuales = leidas.filter((r) => r.tipo !== 'comunidad');
    if (virtuales.length) {
      const idsDe = (tipo: string) => virtuales.filter((r) => r.tipo === tipo).map((r) => r.id);
      const leer = async (tabla: string, columnas: string, ids: number[]) => {
        const out: any[] = [];
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await db.from(tabla).select(columnas).in('id', ids.slice(i, i + 200));
          if (error) throw new BadRequestException(error.message);
          out.push(...(data || []));
        }
        return out;
      };
      const [parts, inscs] = await Promise.all([
        idsDe('sorteo').length ? leer('sorteo_participantes', '*', idsDe('sorteo')) : [],
        idsDe('evento').length ? leer('evento_inscripciones', '*', idsDe('evento')) : [],
      ]);
      const candidatas = [
        ...parts.map((p: any) => {
          const estudiante = categoriaDeSorteo(p) === 'estudiante';
          return {
            nombre: sanitizeText(p.nombre, 120) || 'Sin nombre', apellido: null, telefono: null, correo: sanitizeText(p.email, 180).toLowerCase(),
            perfil: estudiante ? 'estudiante' : 'dentista', anio_estudio: sanitizeText(p.anio, 40) || null,
            universidad: estudiante ? sanitizeText(p.universidad_clinica, 200) || null : null,
            especialidad: estudiante ? null : sanitizeText(p.especialidad, 120) || null,
            origen: `sorteo:${p.sorteo_id ?? ''}`, fuente: 'sorteo', created_at: p.created_at || ahora,
          };
        }),
        ...inscs.map((i: any) => ({
          nombre: sanitizeText(i.nombre, 120) || 'Sin nombre', apellido: sanitizeText(i.apellido, 120) || null, telefono: sanitizeText(i.telefono, 30) || null,
          correo: sanitizeText(i.correo, 180).toLowerCase(), perfil: 'dentista', anio_estudio: null,
          universidad: i.es_profesor ? sanitizeText(i.universidad, 200) || null : null, especialidad: sanitizeText(i.especialidad, 120) || null,
          origen: `evento:${i.evento ?? ''}`, fuente: 'evento', created_at: i.created_at || ahora,
        })),
      ].filter((c) => isValidEmail(c.correo));

      // Un correo, una fila: si la persona ya tiene fila en Comunidad (o viene repetida), se actualiza esa.
      const porCorreo = new Map<string, (typeof candidatas)[number]>();
      for (const c of candidatas) if (!porCorreo.has(c.correo)) porCorreo.set(c.correo, c);
      const correos = [...porCorreo.keys()];
      const yaEstan = new Map<string, number>();
      for (let i = 0; i < correos.length; i += 150) {
        const { data, error } = await db.from('comunidad_registros').select('id, correo, fuente').in('correo', correos.slice(i, i + 150));
        if (error) throw faltaMigracion(error);
        for (const f of data || []) if ((f as any).fuente !== 'rastreo') yaEstan.set(String((f as any).correo).toLowerCase(), Number((f as any).id));
      }
      const idsExistentes = [...new Set(correos.filter((c) => yaEstan.has(c)).map((c) => yaEstan.get(c) as number))];
      for (let i = 0; i < idsExistentes.length; i += 200) {
        const { data, error } = await db.from('comunidad_registros').update(marca).in('id', idsExistentes.slice(i, i + 200)).select('id');
        if (error) throw faltaMigracion(error);
        actualizadas += (data || []).length;
      }
      const nuevas = correos.filter((c) => !yaEstan.has(c)).map((c) => ({ ...porCorreo.get(c), ...marca, acepta_datos: false, correo_enviado: false }));
      for (let i = 0; i < nuevas.length; i += 200) {
        const { data, error } = await db.from('comunidad_registros').insert(nuevas.slice(i, i + 200)).select('id');
        if (error) throw faltaMigracion(error);
        actualizadas += (data || []).length;
      }
    }
    return { ok: true, categoria, actualizadas };
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
    // (2026-11-17) La bienvenida es para quien llenó el formulario del QR: no para una clínica rastreada ni para alguien de un sorteo o evento.
    if (data.fuente && data.fuente !== 'comunidad') {
      throw new BadRequestException('Esta fila no viene del formulario de Comunidad: el correo de bienvenida no aplica.');
    }

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
