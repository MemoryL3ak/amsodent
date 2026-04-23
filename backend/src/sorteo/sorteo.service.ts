import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

type RateEntry = { count: number; windowStart: number };

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_HITS = 5;

function sanitizeText(input: unknown, max = 255): string {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

@Injectable()
export class SorteoService {
  private readonly rateMap = new Map<string, RateEntry>();

  constructor(private supabase: SupabaseService) {}

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
    const email = sanitizeText(body?.email, 180).toLowerCase();
    const tipoPerfilRaw = sanitizeText(body?.tipo_perfil, 20).toLowerCase();
    const tipoPerfil =
      tipoPerfilRaw === 'estudiante' || tipoPerfilRaw === 'egresado'
        ? tipoPerfilRaw
        : '';
    const universidadClinica =
      sanitizeText(body?.universidad_clinica, 200) || null;
    const conociaAmsodent = Boolean(body?.conocia_amsodent);
    const aceptaUsoDatos = Boolean(body?.acepta_uso_datos);
    const aceptaComunicaciones = Boolean(body?.acepta_comunicaciones);

    const faltantes: string[] = [];
    if (!nombre) faltantes.push('nombre');
    if (!email) faltantes.push('correo electrónico');
    if (!tipoPerfil) faltantes.push('si eres estudiante o egresado');
    if (tipoPerfil === 'egresado' && !universidadClinica) {
      faltantes.push('nombre de universidad o clínica donde trabaja');
    }
    if (!aceptaUsoDatos) faltantes.push('autorización de uso de datos');

    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Faltan o son inválidos: ${faltantes.join(', ')}.`,
      );
    }

    if (!isValidEmail(email)) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('sorteo_participantes')
      .insert([
        {
          nombre,
          email,
          tipo_perfil: tipoPerfil,
          universidad_clinica: tipoPerfil === 'egresado' ? universidadClinica : null,
          conocia_amsodent: conociaAmsodent,
          acepta_uso_datos: aceptaUsoDatos,
          acepta_comunicaciones: aceptaComunicaciones,
          ip_origen: ip || null,
          user_agent: userAgent ? userAgent.slice(0, 400) : null,
        },
      ])
      .select('id, nombre')
      .single();

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (
        msg.includes('duplicate key') ||
        msg.includes('unique') ||
        (error as any).code === '23505'
      ) {
        throw new ConflictException(
          'Ya te encuentras registrado con este correo. ¡Ya estás participando!',
        );
      }
      throw new BadRequestException(error.message);
    }

    return { id: data?.id, nombre: data?.nombre, ok: true };
  }

  async listarParticipantes() {
    const { data, error } = await this.supabase
      .getClient()
      .from('sorteo_participantes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async sortearGanador() {
    const client = this.supabase.getClient();

    // Solo sortea entre quienes aceptaron uso de datos y aún no son ganadores
    const { data: elegibles, error: errElig } = await client
      .from('sorteo_participantes')
      .select('id, nombre, email, tipo_perfil, universidad_clinica')
      .eq('acepta_uso_datos', true)
      .eq('ganador', false);

    if (errElig) throw new BadRequestException(errElig.message);
    if (!elegibles || elegibles.length === 0) {
      throw new NotFoundException(
        'No hay participantes elegibles para sortear.',
      );
    }

    const idx = Math.floor(Math.random() * elegibles.length);
    const elegido = elegibles[idx];

    const { data, error } = await client
      .from('sorteo_participantes')
      .update({ ganador: true, fecha_ganador: new Date().toISOString() })
      .eq('id', elegido.id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async resetGanadores() {
    const { error } = await this.supabase
      .getClient()
      .from('sorteo_participantes')
      .update({ ganador: false, fecha_ganador: null })
      .eq('ganador', true);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async eliminarParticipante(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('sorteo_participantes')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
