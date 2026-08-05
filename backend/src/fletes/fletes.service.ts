import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Costeo de Fletes: cobros reales de Starken/Blue cargados desde sus archivos
// de detalle de cobro. Upsert por (empresa, n_seguimiento) para poder recargar
// un archivo corregido sin duplicar filas.
@Injectable()
export class FletesService {
  constructor(private supabase: SupabaseService) {}

  /* ===========================================================
     TARIFAS / CÁLCULO DE FLETE (Starken y Blue Express)
     - Starken: peso facturable = max(peso físico, cm³/4000);
       tarifa NETA por tramo según región+localidad. Tramos >100 kg
       son por kilo + fijo adicional.
     - Blue: solo peso físico; tarifa NETA por región y tramo (la tabla
       ya guarda netos; el archivo oficial bruto se convierte al importar).
  =========================================================== */

  private static readonly STARKEN_CAMPOS = [
    't_0_05', 't_05_15', 't_15_3', 't_3_6', 't_6_10', 't_10_20', 't_20_30',
    't_30_40', 't_40_50', 't_50_60', 't_60_70', 't_70_80', 't_80_90', 't_90_100',
    'kg_100_499', 'kg_499_1000', 'fijo_adicional',
  ];
  private static readonly BLUE_CAMPOS = ['xs', 's', 'm', 'l', 'xl'];

  private tablaTarifas(empresa: string): string {
    if (empresa === 'Blue') return 'fletes_tarifas_blue';
    if (empresa === 'Starken') return 'fletes_tarifas_starken';
    throw new BadRequestException('Empresa inválida (Starken o Blue).');
  }

  // Solo columnas conocidas; números coercionados (evita campos arbitrarios).
  private limpiarFilaTarifa(empresa: string, row: any): Record<string, any> {
    const out: Record<string, any> = {};
    const region = String(row?.region || '').trim();
    if (!region) throw new BadRequestException('Cada fila necesita una región.');
    out.region = region;
    if (empresa === 'Starken') {
      const localidad = String(row?.localidad || '').trim().toUpperCase();
      if (!localidad) throw new BadRequestException(`Fila de "${region}" sin localidad.`);
      out.localidad = localidad;
    }
    const campos = empresa === 'Starken' ? FletesService.STARKEN_CAMPOS : FletesService.BLUE_CAMPOS;
    for (const campo of campos) {
      const n = Number(row?.[campo]);
      out[campo] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return out;
  }

  async listarTarifas(empresa: string) {
    const tabla = this.tablaTarifas(empresa);
    let query = this.supabase.getClient().from(tabla).select('*').range(0, 20000)
      .order('region', { ascending: true });
    if (empresa === 'Starken') query = query.order('localidad', { ascending: true });
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async crearTarifa(empresa: string, body: any) {
    const tabla = this.tablaTarifas(empresa);
    const fila = this.limpiarFilaTarifa(empresa, body);
    const { data, error } = await this.supabase.getClient().from(tabla).insert([fila]).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizarTarifa(empresa: string, id: number, body: any) {
    const tabla = this.tablaTarifas(empresa);
    const fila = this.limpiarFilaTarifa(empresa, body);
    const { data, error } = await this.supabase.getClient().from(tabla).update(fila).eq('id', id).select().single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async eliminarTarifa(empresa: string, id: number) {
    const tabla = this.tablaTarifas(empresa);
    const { error } = await this.supabase.getClient().from(tabla).delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // Carga masiva: la tabla nueva REEMPLAZA por completo a la anterior (es el
  // tarifario vigente del courier; localidades que ya no vienen deben salir).
  // Blue: el archivo del courier trae valores BRUTOS (IVA incluido) y la
  // tabla guarda NETOS → aquí se convierte siempre (÷1,19).
  async reemplazarTarifas(empresa: string, rows: any[]) {
    const tabla = this.tablaTarifas(empresa);
    const lista = Array.isArray(rows) ? rows : [];
    const filas = lista.map((r) => {
      const fila = this.limpiarFilaTarifa(empresa, r);
      if (empresa === 'Blue') {
        for (const campo of FletesService.BLUE_CAMPOS) {
          fila[campo] = Math.round((Number(fila[campo]) || 0) / 1.19);
        }
      }
      return fila;
    });

    // Dedup por clave natural (última fila del archivo gana).
    const porClave = new Map<string, Record<string, any>>();
    for (const f of filas) {
      const clave = empresa === 'Starken'
        ? `${String(f.region).toLowerCase()}|${f.localidad}`
        : String(f.region).toLowerCase();
      porClave.set(clave, f);
    }
    const unicas = [...porClave.values()];
    if (unicas.length === 0) {
      throw new BadRequestException('El archivo no trae filas válidas (región y valores).');
    }

    const client = this.supabase.getClient();
    const { error: errDel } = await client.from(tabla).delete().gte('id', 0);
    if (errDel) throw new BadRequestException(errDel.message);

    let insertadas = 0;
    const BATCH = 200;
    for (let i = 0; i < unicas.length; i += BATCH) {
      const { data, error } = await client.from(tabla).insert(unicas.slice(i, i + BATCH)).select('id');
      if (error) throw new BadRequestException(`Error insertando (fila ${i + 1}+): ${error.message}`);
      insertadas += (data || []).length;
    }
    return { insertadas, duplicadasEnArchivo: filas.length - unicas.length };
  }

  async tarifasRegiones(empresa: string) {
    const tabla = empresa === 'Blue' ? 'fletes_tarifas_blue' : 'fletes_tarifas_starken';
    const { data, error } = await this.supabase.getClient()
      .from(tabla)
      .select('region')
      .range(0, 20000);
    if (error) throw new BadRequestException(error.message);
    const unicas = [...new Set((data || []).map((r: any) => String(r.region)))];
    return unicas.sort((a, b) => a.localeCompare(b, 'es'));
  }

  async tarifasLocalidades(region: string) {
    if (!region) return [];
    const { data, error } = await this.supabase.getClient()
      .from('fletes_tarifas_starken')
      .select('localidad')
      .eq('region', region)
      .order('localidad', { ascending: true })
      .range(0, 20000);
    if (error) throw new BadRequestException(error.message);
    return (data || []).map((r: any) => r.localidad);
  }

  private static readonly TRAMOS_STARKEN: Array<[number, string, string]> = [
    [0.5, 't_0_05', '0 – 0,5 kg'],
    [1.5, 't_05_15', '0,5 – 1,5 kg'],
    [3, 't_15_3', '1,5 – 3 kg'],
    [6, 't_3_6', '3 – 6 kg'],
    [10, 't_6_10', '6 – 10 kg'],
    [20, 't_10_20', '10 – 20 kg'],
    [30, 't_20_30', '20 – 30 kg'],
    [40, 't_30_40', '30 – 40 kg'],
    [50, 't_40_50', '40 – 50 kg'],
    [60, 't_50_60', '50 – 60 kg'],
    [70, 't_60_70', '60 – 70 kg'],
    [80, 't_70_80', '70 – 80 kg'],
    [90, 't_80_90', '80 – 90 kg'],
    [100, 't_90_100', '90 – 100 kg'],
  ];

  async calcularFlete(body: {
    empresa?: string;
    region?: string;
    localidad?: string;
    peso?: number;
    volumen_cm3?: number;
    km?: number;
  }) {
    const empresa = String(body?.empresa || '').trim();
    const region = String(body?.region || '').trim();
    const peso = Number(body?.peso) || 0;
    const volumen = Number(body?.volumen_cm3) || 0;

    if (!['Starken', 'Blue', 'Interno'].includes(empresa)) {
      throw new BadRequestException('Empresa inválida (Starken, Blue o Interno).');
    }

    // ── Despacho interno: km de ida × 2 (ida y vuelta) × valor por km ──
    if (empresa === 'Interno') {
      const km = Number(body?.km);
      if (!Number.isFinite(km) || km <= 0) {
        throw new BadRequestException('Debes indicar los kilómetros del despacho (calcula la distancia o digítalos).');
      }
      const config = await this.internoConfig();
      const valorKm = Number(config?.valor_km) || 0;
      if (valorKm <= 0) {
        throw new BadRequestException('Falta configurar el valor por km (Tarifas de Flete → Despacho interno).');
      }
      const kmTotal = km * 2;
      const neto = Math.round(kmTotal * valorKm);
      return {
        empresa,
        km: Math.round(km * 10) / 10,
        km_total: Math.round(kmTotal * 10) / 10,
        valor_km: valorKm,
        neto,
        detalle: `Despacho interno · ${km.toFixed(1)} km × 2 (ida y vuelta) = ${kmTotal.toFixed(1)} km × $${valorKm.toLocaleString('es-CL')}/km`,
      };
    }

    if (!region) throw new BadRequestException('Debes indicar la región de destino.');

    if (empresa === 'Blue') {
      if (peso <= 0) {
        throw new BadRequestException('El peso total es 0: revisa que los productos tengan peso registrado.');
      }
      const { data, error } = await this.supabase.getClient()
        .from('fletes_tarifas_blue')
        .select('*')
        .eq('region', region)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new BadRequestException(`Sin tarifa Blue Express para la región "${region}".`);

      const tramos: Array<[number, string, string]> = [
        [0.5, 'xs', 'XS (0 – 0,5 kg)'],
        [3, 's', 'S (0,5 – 3 kg)'],
        [6, 'm', 'M (3 – 6 kg)'],
        [16, 'l', 'L (6 – 16 kg)'],
        [25, 'xl', 'XL (16 – 25 kg)'],
      ];
      const tramo = tramos.find(([limite]) => peso <= limite);
      if (!tramo) {
        throw new BadRequestException(
          `Blue Express cubre hasta 25 kg y el envío pesa ${peso.toFixed(1)} kg. Usa Starken para este despacho.`,
        );
      }
      const neto = Math.round(Number((data as any)[tramo[1]]) || 0);
      return {
        empresa,
        region,
        neto,
        tramo: tramo[2],
        peso_facturable: peso,
        detalle: `Blue Express ${region} · ${tramo[2]}`,
      };
    }

    // ── Starken ──
    const localidad = String(body?.localidad || '').trim();
    if (!localidad) throw new BadRequestException('Debes indicar la localidad de destino (Starken).');

    const pesoVolumetrico = volumen / 4000;
    const pesoFacturable = Math.max(peso, pesoVolumetrico);
    if (pesoFacturable <= 0) {
      throw new BadRequestException(
        'Peso y volumen totales en 0: revisa que los productos tengan peso o dimensiones registradas.',
      );
    }

    const { data, error } = await this.supabase.getClient()
      .from('fletes_tarifas_starken')
      .select('*')
      .eq('region', region)
      .eq('localidad', localidad)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) {
      throw new BadRequestException(`Sin tarifa Starken para ${localidad} (${region}).`);
    }

    let neto: number;
    let tramoLabel: string;
    const plano = FletesService.TRAMOS_STARKEN.find(([limite]) => pesoFacturable <= limite);
    if (plano) {
      neto = Math.round(Number((data as any)[plano[1]]) || 0);
      tramoLabel = plano[2];
    } else if (pesoFacturable <= 499) {
      neto = Math.round(pesoFacturable * (Number((data as any).kg_100_499) || 0) + (Number((data as any).fijo_adicional) || 0));
      tramoLabel = '100 – 499 kg (tarifa por kilo)';
    } else if (pesoFacturable <= 1000) {
      neto = Math.round(pesoFacturable * (Number((data as any).kg_499_1000) || 0) + (Number((data as any).fijo_adicional) || 0));
      tramoLabel = '499 – 1000 kg (tarifa por kilo)';
    } else {
      throw new BadRequestException('El peso facturable supera los 1.000 kg cubiertos por la tarifa Starken.');
    }

    return {
      empresa,
      region,
      localidad,
      neto,
      tramo: tramoLabel,
      peso_fisico: peso,
      peso_volumetrico: Math.round(pesoVolumetrico * 100) / 100,
      peso_facturable: Math.round(pesoFacturable * 100) / 100,
      detalle: `Starken ${localidad} · ${tramoLabel} · peso facturable ${pesoFacturable.toFixed(2)} kg (mayor entre ${peso.toFixed(2)} kg físico y ${pesoVolumetrico.toFixed(2)} kg volumétrico)`,
    };
  }

  /* ===========================================================
     DESPACHO INTERNO: config (origen) + distancia por Google Maps
     - Origen fijo: dirección de la bodega en fletes_interno_config;
       al guardarla se geocodifica y quedan lat/lng cacheadas.
     - Distancia: Geocoding API (destino) + Routes API (km por
       carretera). Requiere GOOGLE_MAPS_API_KEY en el backend.
  =========================================================== */

  private mapsKey(): string {
    const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (!key) {
      throw new BadRequestException(
        'GOOGLE_MAPS_API_KEY no está configurada en el servidor; digita los km manualmente.',
      );
    }
    return key;
  }

  private async geocodificar(direccion: string): Promise<{ lat: number; lng: number; formateada: string }> {
    const key = this.mapsKey();
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json' +
      `?address=${encodeURIComponent(direccion)}&components=country:CL&language=es&key=${key}`;
    const res = await fetch(url);
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json || json.status === 'REQUEST_DENIED' || json.status === 'OVER_QUERY_LIMIT') {
      throw new BadRequestException(
        `Google Geocoding rechazó la consulta (${json?.status || res.status}): ${json?.error_message || 'revisa la API key.'}`,
      );
    }
    const hit = json?.results?.[0];
    if (json.status !== 'OK' || !hit?.geometry?.location) {
      throw new BadRequestException(`No se encontró la dirección "${direccion}"; corrígela o digita los km manualmente.`);
    }
    return {
      lat: Number(hit.geometry.location.lat),
      lng: Number(hit.geometry.location.lng),
      formateada: String(hit.formatted_address || direccion),
    };
  }

  // Distancia de ruta (km por carretera) usando la Routes API v2.
  private async rutaKm(origen: { lat: number; lng: number }, destino: { lat: number; lng: number }): Promise<number> {
    const key = this.mapsKey();
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origen.lat, longitude: origen.lng } } },
        destination: { location: { latLng: { latitude: destino.lat, longitude: destino.lng } } },
        travelMode: 'DRIVE',
      }),
    });
    const json: any = await res.json().catch(() => null);
    const metros = Number(json?.routes?.[0]?.distanceMeters);
    if (!res.ok || !Number.isFinite(metros)) {
      // Un 200 sin routes[] significa que Google no encontró ruta en auto
      // entre los dos puntos (destino mal geocodificado, isla, etc.).
      const detalleGoogle = json?.error?.message
        || (res.ok ? `sin ruta entre origen (${origen.lat.toFixed(5)}, ${origen.lng.toFixed(5)}) y destino (${destino.lat.toFixed(5)}, ${destino.lng.toFixed(5)}); respuesta: ${JSON.stringify(json ?? {}).slice(0, 160)}` : 'revisa que la Routes API esté habilitada.');
      throw new BadRequestException(
        `Google Routes no pudo calcular la ruta (${json?.error?.status || res.status}): ${detalleGoogle}`,
      );
    }
    return metros / 1000;
  }

  async internoConfig() {
    const { data, error } = await this.supabase.getClient()
      .from('fletes_interno_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260804_fletes_interno.sql en Supabase.'
          : error.message,
      );
    }
    return data || { id: 1, direccion_origen: null, origen_lat: null, origen_lng: null, valor_km: 0 };
  }

  async guardarInternoConfig(body: { direccion_origen?: string; valor_km?: number }) {
    const direccion = String(body?.direccion_origen || '').trim();
    const valorKm = Number(body?.valor_km);
    const fila: Record<string, any> = {
      id: 1,
      direccion_origen: direccion || null,
      origen_lat: null,
      origen_lng: null,
      valor_km: Number.isFinite(valorKm) && valorKm >= 0 ? valorKm : 0,
    };
    // La dirección de origen se geocodifica al guardar (así cada cálculo de
    // distancia gasta una sola llamada: la del destino). Si aún no hay API key
    // configurada, se guarda igual sin coordenadas y distanciaInterno() la
    // geocodificará automáticamente cuando la key exista.
    if (direccion && (process.env.GOOGLE_MAPS_API_KEY || '').trim()) {
      const geo = await this.geocodificar(direccion);
      fila.origen_lat = geo.lat;
      fila.origen_lng = geo.lng;
    }
    const { data, error } = await this.supabase.getClient()
      .from('fletes_interno_config')
      .upsert([fila], { onConflict: 'id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Sugerencias de dirección (autocompletar) vía Places Autocomplete. La key
  // vive solo en el backend. Sin key devuelve lista vacía (el campo funciona
  // igual como texto libre).
  async sugerirDirecciones(q: string) {
    const input = String(q || '').trim();
    if (input.length < 4) return [];
    const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (!key) return [];
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
        },
        body: JSON.stringify({
          input,
          languageCode: 'es',
          regionCode: 'CL',
        }),
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) return [];
      return (json?.suggestions || [])
        .map((s: any) => String(s?.placePrediction?.text?.text || '').trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch {
      return [];
    }
  }

  // Km por carretera entre la bodega configurada y la dirección del cliente.
  async distanciaInterno(body: { direccion?: string; comuna?: string; region?: string }) {
    const partes = [body?.direccion, body?.comuna, body?.region]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    if (!partes.length) {
      throw new BadRequestException('La cotización no tiene dirección de destino; digita los km manualmente.');
    }
    const config = await this.internoConfig();
    const sinCoords =
      !Number.isFinite(Number(config?.origen_lat)) || !Number.isFinite(Number(config?.origen_lng));
    if (sinCoords) {
      if (!String(config?.direccion_origen || '').trim()) {
        throw new BadRequestException(
          'Falta configurar la dirección de origen (Tarifas de Flete → Despacho interno).',
        );
      }
      // Origen guardado sin coordenadas (se configuró antes de tener la API
      // key): geocodificarlo ahora y dejarlo cacheado para el resto.
      const geoOrigen = await this.geocodificar(String(config.direccion_origen));
      config.origen_lat = geoOrigen.lat;
      config.origen_lng = geoOrigen.lng;
      await this.supabase.getClient()
        .from('fletes_interno_config')
        .update({ origen_lat: geoOrigen.lat, origen_lng: geoOrigen.lng })
        .eq('id', 1);
    }
    const destino = await this.geocodificar(partes.join(', '));
    let km: number;
    try {
      km = await this.rutaKm(
        { lat: Number(config.origen_lat), lng: Number(config.origen_lng) },
        destino,
      );
    } catch (e: any) {
      // Anexar el destino geocodificado: casi siempre el problema es que la
      // dirección del cliente resolvió a un lugar inesperado.
      throw new BadRequestException(`${e?.message || e} · Destino geocodificado: "${destino.formateada}"`);
    }
    return {
      km: Math.round(km * 10) / 10,
      destino: destino.formateada,
      origen: config.direccion_origen,
    };
  }

  async listarCobros(empresa?: string) {
    let query = this.supabase.getClient()
      .from('fletes_cobros')
      .select('id,empresa,n_seguimiento,monto,detalle,archivo,cargado_por,created_at,updated_at')
      .range(0, 50000)
      .order('created_at', { ascending: false });
    if (empresa) query = query.eq('empresa', empresa);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async bulkUpsert(body: { empresa?: string; archivo?: string; rows?: any[] }, email: string) {
    const empresa = String(body?.empresa || '').trim();
    if (!['Starken', 'Blue'].includes(empresa)) {
      throw new BadRequestException('Empresa inválida (Starken o Blue).');
    }
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const archivo = String(body?.archivo || '').trim() || null;

    // Dedup por n° de seguimiento dentro del archivo (última fila gana).
    const porSeguimiento = new Map<string, any>();
    for (const r of rows) {
      const n = String(r?.n_seguimiento || '').trim();
      const monto = Number(r?.monto || 0);
      if (!n || !(monto >= 0)) continue;
      porSeguimiento.set(n, {
        empresa,
        n_seguimiento: n,
        monto,
        detalle: r?.detalle && typeof r.detalle === 'object' ? r.detalle : null,
        archivo,
        cargado_por: email || null,
        updated_at: new Date().toISOString(),
      });
    }
    const filas = Array.from(porSeguimiento.values());
    if (!filas.length) return { insertados: 0 };

    const { error } = await this.supabase.getClient()
      .from('fletes_cobros')
      .upsert(filas, { onConflict: 'empresa,n_seguimiento' });
    if (error) throw new BadRequestException(error.message);
    return { insertados: filas.length };
  }

  async eliminarCobros(empresa?: string) {
    let query = this.supabase.getClient().from('fletes_cobros').delete();
    if (empresa) query = query.eq('empresa', empresa);
    else query = query.neq('id', 0); // delete all requiere un filtro
    const { error } = await query;
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  // ── Cierres de costeo (subsección Análisis) ──────────────────────────────

  async listarCierres() {
    const { data, error } = await this.supabase.getClient()
      .from('fletes_cierres')
      .select('id,licitacion_id,flete_estimado,cobro_real,diferencia,cerrado_por,created_at')
      .range(0, 50000)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async cerrarCosteo(body: { licitacion_id?: number; flete_estimado?: number; cobro_real?: number; diferencia?: number }, email: string) {
    const licitacionId = Number(body?.licitacion_id || 0);
    if (!licitacionId) throw new BadRequestException('licitacion_id requerido.');
    const fila = {
      licitacion_id: licitacionId,
      flete_estimado: Number(body?.flete_estimado || 0),
      cobro_real: Number(body?.cobro_real || 0),
      diferencia: Number(body?.diferencia || 0),
      cerrado_por: email || null,
    };
    const { data, error } = await this.supabase.getClient()
      .from('fletes_cierres')
      .upsert([fila], { onConflict: 'licitacion_id' })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async reabrirCosteo(licitacionId: number) {
    if (!licitacionId) throw new BadRequestException('licitacion_id requerido.');
    const { error } = await this.supabase.getClient()
      .from('fletes_cierres')
      .delete()
      .eq('licitacion_id', licitacionId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }
}
