import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type TipoMarcaje = 'entrada' | 'salida';

export interface CrearMarcajeDto {
  tipo: TipoMarcaje;
  latitud?: number | null;
  longitud?: number | null;
  accuracy_m?: number | null;
  user_agent?: string | null;
  ip_address?: string | null;
}

export interface OficinaRow {
  id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  radio_metros: number;
  activa: boolean;
}

// Fórmula haversine para distancia entre dos puntos geográficos en metros.
function distanciaMetros(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // radio de la Tierra en metros
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Reverse geocoding via Nominatim (OpenStreetMap). Gratis, sin API key.
// TOS: requiere User-Agent identificable; máximo ~1 req/seg.
// Como esto corre por marcaje (esporádico), no necesitamos caching agresivo.
async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
      lat,
    )}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AMSODENT-Marcajes/1.0 (contacto@amsodent.cl)',
        'Accept-Language': 'es-CL,es',
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data) return null;

    // Preferimos un display_name corto y útil: calle + número + comuna + región.
    const a = data.address || {};
    const calle = a.road || a.pedestrian || a.footway || '';
    const numero = a.house_number || '';
    const comuna =
      a.city_district || a.suburb || a.town || a.village || a.city || '';
    const region = a.state || '';
    const corto = [
      [calle, numero].filter(Boolean).join(' '),
      comuna,
      region,
    ]
      .filter(Boolean)
      .join(', ');
    return corto || data.display_name || null;
  } catch (_e) {
    return null;
  }
}

@Injectable()
export class MarcajesService {
  private readonly logger = new Logger(MarcajesService.name);

  constructor(private supabase: SupabaseService) {}

  // ============================================================
  // OFICINAS
  // ============================================================
  async listarOficinas(): Promise<OficinaRow[]> {
    const { data, error } = await this.supabase
      .getClient()
      .from('marcaje_oficinas')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data || []) as OficinaRow[];
  }

  async crearOficina(body: Partial<OficinaRow>) {
    const payload = {
      nombre: String(body?.nombre || '').trim() || 'Sin nombre',
      latitud: Number(body?.latitud),
      longitud: Number(body?.longitud),
      radio_metros: Math.max(10, Number(body?.radio_metros || 200)),
      activa: body?.activa !== false,
    };
    if (!Number.isFinite(payload.latitud) || !Number.isFinite(payload.longitud)) {
      throw new BadRequestException('Latitud y longitud deben ser números válidos');
    }
    const { data, error } = await this.supabase
      .getClient()
      .from('marcaje_oficinas')
      .insert(payload)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizarOficina(id: number, body: Partial<OficinaRow>) {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body?.nombre != null) payload.nombre = String(body.nombre).trim();
    if (body?.latitud != null) payload.latitud = Number(body.latitud);
    if (body?.longitud != null) payload.longitud = Number(body.longitud);
    if (body?.radio_metros != null)
      payload.radio_metros = Math.max(10, Number(body.radio_metros));
    if (body?.activa != null) payload.activa = Boolean(body.activa);

    const { data, error } = await this.supabase
      .getClient()
      .from('marcaje_oficinas')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Oficina no encontrada');
    return data;
  }

  async eliminarOficina(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('marcaje_oficinas')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ============================================================
  // MARCAJES
  // ============================================================

  // Obtiene el último marcaje del día para un usuario — sirve para decidir
  // si el próximo botón es 'entrada' o 'salida'.
  async ultimoDelDia(email: string): Promise<{ tipo: TipoMarcaje } | null> {
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    const { data, error } = await this.supabase
      .getClient()
      .from('marcajes')
      .select('tipo')
      .ilike('user_email', email)
      .gte('marcado_at', inicioDia.toISOString())
      .order('marcado_at', { ascending: false })
      .limit(1);
    if (error) throw new BadRequestException(error.message);
    return (data && data[0]) || null;
  }

  async crear(
    email: string,
    nombre: string | null,
    body: CrearMarcajeDto,
  ) {
    const tipo = body?.tipo;
    if (tipo !== 'entrada' && tipo !== 'salida') {
      throw new BadRequestException('Tipo de marcaje inválido');
    }

    // Calcular distancia a la oficina más cercana y flag de fuera de radio.
    const oficinas = await this.listarOficinas();
    const activas = oficinas.filter((o) => o.activa);

    let oficinaId: number | null = null;
    let distanciaM: number | null = null;
    let fueraDeRadio = false;

    if (
      Number.isFinite(Number(body?.latitud)) &&
      Number.isFinite(Number(body?.longitud)) &&
      activas.length > 0
    ) {
      let mejor: { oficina: OficinaRow; dist: number } | null = null;
      for (const oficina of activas) {
        const d = distanciaMetros(
          Number(body.latitud),
          Number(body.longitud),
          Number(oficina.latitud),
          Number(oficina.longitud),
        );
        if (!mejor || d < mejor.dist) mejor = { oficina, dist: d };
      }
      if (mejor) {
        oficinaId = mejor.oficina.id;
        distanciaM = Math.round(mejor.dist);
        fueraDeRadio = mejor.dist > mejor.oficina.radio_metros;
      }
    } else if (activas.length > 0) {
      // No envió coords → lo marcamos como fuera de radio (el admin debe saberlo).
      fueraDeRadio = true;
    }

    // Reverse geocode la coordenada — non-blocking: si falla, guardamos sin dirección.
    let direccion: string | null = null;
    if (
      Number.isFinite(Number(body?.latitud)) &&
      Number.isFinite(Number(body?.longitud))
    ) {
      direccion = await reverseGeocode(
        Number(body.latitud),
        Number(body.longitud),
      );
    }

    const payload = {
      user_email: email.toLowerCase().trim(),
      user_nombre: nombre,
      tipo,
      latitud: Number.isFinite(Number(body?.latitud)) ? Number(body.latitud) : null,
      longitud: Number.isFinite(Number(body?.longitud)) ? Number(body.longitud) : null,
      accuracy_m: Number.isFinite(Number(body?.accuracy_m)) ? Number(body.accuracy_m) : null,
      oficina_id: oficinaId,
      distancia_m: distanciaM,
      fuera_de_radio: fueraDeRadio,
      direccion,
      user_agent: (body?.user_agent || '').toString().slice(0, 400) || null,
      ip_address: (body?.ip_address || '').toString().slice(0, 60) || null,
    };

    const { data, error } = await this.supabase
      .getClient()
      .from('marcajes')
      .insert(payload)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Listado de marcajes del usuario actual (paginado por fecha).
  async listarMios(email: string, desde?: string, hasta?: string) {
    let query = this.supabase
      .getClient()
      .from('marcajes')
      .select('*')
      .ilike('user_email', email)
      .order('marcado_at', { ascending: false })
      .limit(200);
    if (desde) query = query.gte('marcado_at', `${desde}T00:00:00`);
    if (hasta) query = query.lte('marcado_at', `${hasta}T23:59:59`);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  // Listado completo para admin (con filtros).
  async listarTodos(filters?: {
    desde?: string;
    hasta?: string;
    email?: string;
    tipo?: TipoMarcaje;
    fuera_de_radio?: boolean;
  }) {
    let query = this.supabase
      .getClient()
      .from('marcajes')
      .select('*')
      .order('marcado_at', { ascending: false })
      .range(0, 5000);
    if (filters?.desde) query = query.gte('marcado_at', `${filters.desde}T00:00:00`);
    if (filters?.hasta) query = query.lte('marcado_at', `${filters.hasta}T23:59:59`);
    if (filters?.email) query = query.ilike('user_email', `%${filters.email}%`);
    if (filters?.tipo) query = query.eq('tipo', filters.tipo);
    if (filters?.fuera_de_radio != null)
      query = query.eq('fuera_de_radio', filters.fuera_de_radio);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }
}
