import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { SupabaseService } from '../supabase/supabase.service';
import { esFaltaMigracion } from './comunidad-categorias';
import {
  CONSULTAS_RASTREO,
  ResultadoRastreo,
  contactosDe,
  enlaceContacto,
  lugarAResultado,
  regionParaBuscar,
  sitioSeLee,
  telefonoE164,
  urlPublica,
  whatsappsEn,
} from './rastreo.logica';

/* ── Rastreo de clínicas dentales en Google Maps (2026-11-17) ────────────────
   El «bot» de Comunidad Amsodent (ver rastreo.logica.ts). Tres pasos, cada uno
   una llamada corta para que la pantalla muestre el avance:

     1. buscar     → Google Maps (Places API): las clínicas de la comuna, con
                     nombre, teléfono, página, dirección, comuna y región.
                     NO guarda nada.
     2. contactos  → de a pocas páginas web por llamada: correo y WhatsApp.
                     NO guarda nada.
     3. guardar    → lo que la persona dejó marcado entra a Comunidad como
                     «Cliente Rastreado» (un lugar se guarda una sola vez: si ya
                     estaba, se actualizan sus datos y se respeta su categoría).

   La clave de Google es la del backend (GOOGLE_PLACES_API_KEY o, si no está,
   GOOGLE_MAPS_API_KEY) y necesita «Places API (New)» habilitada. */

const CAMPOS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.websiteUri', 'places.googleMapsUri', 'places.businessStatus', 'places.rating',
  'places.userRatingCount', 'places.primaryType', 'places.types', 'nextPageToken',
].join(',');
const PAGINAS_POR_CONSULTA = 3; // Google entrega hasta 60 lugares (3 páginas de 20) por consulta
const SITIOS_POR_LLAMADA = 8;
const ESPERA_PAGINA_MS = 7000;
const TOPE_HTML = 600 * 1024;
// Con forma de navegador y la identificación al final (los cortafuegos rechazan «Mozilla/5.0 (compatible; …)»).
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 AmsodentComunidad/1.0 (+https://amsodentmedical.cl)';

const txt = (v: any, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const FALTA_MIGRACION = 'Falta aplicar la migración 20261117_comunidad_categorias_rastreo.sql en Supabase: sin ella las clínicas rastreadas no se pueden guardar.';

@Injectable()
export class RastreoService {
  private readonly logger = new Logger(RastreoService.name);

  constructor(private supabase: SupabaseService) {}

  private clave(): string {
    return String(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  }

  /** Estado del rastreo para la pantalla: si hay clave y qué se ha buscado antes. */
  async estado() {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('comunidad_rastreos').select('id, region, comuna, encontrados, guardados, actualizados, usuario_email, created_at').order('created_at', { ascending: false }).limit(200);
    return {
      configurado: !!this.clave(),
      migracion: !error,
      mensaje: !this.clave()
        ? 'Falta la clave de Google en el servidor (GOOGLE_MAPS_API_KEY o GOOGLE_PLACES_API_KEY).'
        : error ? FALTA_MIGRACION : null,
      consultas: CONSULTAS_RASTREO,
      historial: error ? [] : data || [],
    };
  }

  private async buscarTexto(consulta: string, pageToken?: string): Promise<{ lugares: any[]; siguiente: string | null }> {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.clave(), 'X-Goog-FieldMask': CAMPOS },
      body: JSON.stringify({ textQuery: consulta, languageCode: 'es', regionCode: 'CL', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    const cuerpo: any = await r.json().catch(() => null);
    if (!r.ok) {
      const motivo = String(cuerpo?.error?.message || `HTTP ${r.status}`);
      if (r.status === 403 || /not been used|disabled|not enabled|API key/i.test(motivo)) {
        throw new BadRequestException(`Google no aceptó la búsqueda: la clave del servidor necesita «Places API (New)» habilitada en Google Cloud. Detalle: ${motivo.slice(0, 220)}`);
      }
      if (r.status === 429) throw new BadRequestException('Google está limitando las búsquedas (cuota). Espera un momento y vuelve a intentar.');
      throw new BadRequestException(`Google Maps no respondió la búsqueda: ${motivo.slice(0, 220)}`);
    }
    return { lugares: Array.isArray(cuerpo?.places) ? cuerpo.places : [], siguiente: cuerpo?.nextPageToken || null };
  }

  /* Paso 1. Clínicas dentales de una comuna según Google Maps. No guarda nada. */
  async buscar(body: { region?: string; comuna?: string }) {
    const region = txt(body?.region, 80);
    const comuna = txt(body?.comuna, 80);
    if (!region || !comuna) throw new BadRequestException('Elige la región y la comuna.');
    if (!this.clave()) throw new BadRequestException('Falta la clave de Google en el servidor (GOOGLE_MAPS_API_KEY o GOOGLE_PLACES_API_KEY).');

    const porId = new Map<string, ResultadoRastreo>();
    const consultas: { consulta: string; lugares: number }[] = [];
    for (const termino of CONSULTAS_RASTREO) {
      const consulta = `${termino} en ${comuna}, ${regionParaBuscar(region)}, Chile`;
      let token: string | undefined;
      let n = 0;
      for (let pagina = 0; pagina < PAGINAS_POR_CONSULTA; pagina++) {
        const { lugares, siguiente } = await this.buscarTexto(consulta, token);
        for (const l of lugares) {
          const res = lugarAResultado(l, { region, comuna });
          if (res && !porId.has(res.place_id)) porId.set(res.place_id, res);
        }
        n += lugares.length;
        if (!siguiente) break;
        token = siguiente;
      }
      consultas.push({ consulta, lugares: n });
    }

    const resultados = [...porId.values()].map((r) => {
      // Una «página» que es un enlace de WhatsApp ya trae el número.
      const deUrl = whatsappsEn(r.sitio_web)[0];
      return deUrl ? { ...r, whatsapp: deUrl, whatsapp_origen: 'sitio' as const } : r;
    });
    // Primero las clínicas dentales de la comuna; dentro de cada grupo, las con más reseñas (las más establecidas).
    resultados.sort((a, b) => Number(b.en_comuna && b.dental) - Number(a.en_comuna && a.dental) || Number(b.en_comuna) - Number(a.en_comuna) || (b.resenas || 0) - (a.resenas || 0) || a.nombre.localeCompare(b.nombre, 'es'));

    const yaGuardadas = await this.guardadas(resultados.map((r) => r.place_id));
    return {
      region, comuna, consultas,
      total: resultados.length,
      // Lo que se busca: clínicas dentales con dirección en la comuna.
      en_comuna: resultados.filter((r) => r.en_comuna && r.dental).length,
      otras_comunas: resultados.filter((r) => !r.en_comuna && r.dental).length,
      no_dentales: resultados.filter((r) => !r.dental).length,
      resultados: resultados.map((r) => ({ ...r, ya_guardada: yaGuardadas.has(r.place_id), lee_sitio: !!this.sitioLegible(r.sitio_web) })),
    };
  }

  /** place_id → id en Comunidad, de los lugares ya guardados. Vacío si la migración no está. */
  private async guardadas(placeIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = [...new Set(placeIds.filter(Boolean))];
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await this.supabase.getClient().from('comunidad_registros').select('id, place_id').in('place_id', ids.slice(i, i + 150));
      if (error) return out;
      for (const f of data || []) out.set(String((f as any).place_id), Number((f as any).id));
    }
    return out;
  }

  private sitioLegible(v: any): URL | null {
    const u = urlPublica(v);
    return u && sitioSeLee(u) ? u : null;
  }

  /* El nombre debe resolver a una dirección pública: una página que apunte a
     la red interna del servidor no se lee. */
  private async exigirHostPublico(host: string) {
    const direcciones = await lookup(host, { all: true }).catch(() => [] as { address: string }[]);
    if (!direcciones.length) throw new Error('el dominio no existe');
    const privada = (ip: string) =>
      /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
      /^(::1|::|fc|fd|fe80:)/i.test(ip) || /^::ffff:(10\.|127\.|192\.168\.|169\.254\.)/i.test(ip);
    if (direcciones.some((d) => privada(d.address))) throw new Error('dirección no permitida');
  }

  private async leerPagina(inicio: URL): Promise<string> {
    // Las redirecciones se siguen a mano (hasta 4) para revisar cada salto.
    let u = inicio;
    let r: Response | null = null;
    const limite = AbortSignal.timeout(ESPERA_PAGINA_MS);
    for (let salto = 0; salto < 5; salto++) {
      await this.exigirHostPublico(u.hostname);
      r = await fetch(u.href, {
        headers: { 'User-Agent': AGENTE, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-CL,es;q=0.9' },
        redirect: 'manual',
        signal: limite,
      });
      if (r.status < 300 || r.status >= 400) break;
      const destino = urlPublica(new URL(r.headers.get('location') || '', u).href);
      void r.body?.cancel().catch(() => undefined);
      if (!destino) throw new Error('redirección no permitida');
      u = destino;
      r = null;
    }
    if (!r) throw new Error('demasiadas redirecciones');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!/html|text/i.test(r.headers.get('content-type') || 'text/html')) throw new Error('no es una página');
    const lector = r.body?.getReader();
    if (!lector) return (await r.text()).slice(0, TOPE_HTML);
    const trozos: Buffer[] = [];
    let total = 0;
    while (total < TOPE_HTML) {
      const { done, value } = await lector.read();
      if (done) break;
      trozos.push(Buffer.from(value));
      total += value.length;
    }
    void lector.cancel().catch(() => undefined);
    return Buffer.concat(trozos).toString('utf8');
  }

  /* Paso 2. Correo y WhatsApp de las páginas web (hasta 8 por llamada). No guarda nada. */
  async contactos(body: { sitios?: { place_id?: string; url?: string }[] }) {
    const sitios = (Array.isArray(body?.sitios) ? body.sitios : []).slice(0, SITIOS_POR_LLAMADA);
    const resultados = await Promise.all(
      sitios.map(async (s) => {
        const place_id = String(s?.place_id || '');
        const u = this.sitioLegible(s?.url);
        if (!u) return { place_id, leido: false, motivo: 'no es una página propia (red social o enlace)', correos: [] as string[], whatsapps: [] as string[] };
        try {
          const portada = await this.leerPagina(u);
          const paginas = [portada];
          let c = contactosDe(paginas, u.hostname);
          // Sin correo en la portada: se mira la página de contacto del mismo sitio.
          if (!c.correos.length) {
            const contacto = enlaceContacto(portada, u);
            const uc = contacto ? this.sitioLegible(contacto) : null;
            if (uc) {
              try { paginas.push(await this.leerPagina(uc)); c = contactosDe(paginas, u.hostname); } catch { /* la portada ya sirvió */ }
            }
          }
          return { place_id, leido: true, motivo: null as string | null, correos: c.correos, whatsapps: c.whatsapps };
        } catch (e: any) {
          // «fetch failed» no dice nada: el motivo real viene en la causa (certificado, conexión rechazada, DNS…).
          const causa = String(e?.cause?.code || e?.cause?.message || '');
          const m = String(
            e?.name === 'TimeoutError' || /aborted|timeout/i.test(`${e?.message} ${causa}`) ? 'la página no respondió a tiempo'
              : /CERT|SSL|TLS|certificate/i.test(causa) ? 'certificado de seguridad inválido'
                : /ENOTFOUND|EAI_AGAIN/i.test(causa) ? 'el dominio no existe'
                  : /ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET/i.test(causa) ? 'la página rechazó la conexión'
                    : e?.message === 'fetch failed' ? 'no se pudo conectar' : e?.message || e,
          ).slice(0, 80);
          return { place_id, leido: false, motivo: m, correos: [] as string[], whatsapps: [] as string[] };
        }
      }),
    );
    return { resultados };
  }

  /* Paso 3. Guarda en Comunidad las clínicas marcadas, como «Cliente Rastreado». */
  async guardar(body: { region?: string; comuna?: string; encontrados?: number; resultados?: any[] }, usuarioEmail: string | null) {
    const region = txt(body?.region, 80);
    const comuna = txt(body?.comuna, 80);
    const crudos = Array.isArray(body?.resultados) ? body.resultados.slice(0, 400) : [];
    const limpios = crudos
      .map((r) => {
        const sitio = urlPublica(r?.sitio_web);
        const correo = txt(r?.correo, 180).toLowerCase();
        const mapa = urlPublica(r?.maps_url);
        return {
          place_id: txt(r?.place_id, 120),
          nombre: txt(r?.nombre, 160),
          telefono: telefonoE164(r?.telefono) || txt(r?.telefono, 30),
          whatsapp: telefonoE164(r?.whatsapp) || '',
          whatsapp_origen: r?.whatsapp_origen === 'sitio' ? 'sitio' : r?.whatsapp_origen === 'telefono' ? 'telefono' : '',
          correo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ? correo : '',
          correos: (Array.isArray(r?.correos) ? r.correos : []).map((c: any) => txt(c, 180).toLowerCase()).filter((c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)).slice(0, 5),
          sitio_web: sitio ? sitio.href : '',
          direccion: txt(r?.direccion, 240),
          comuna: txt(r?.comuna, 80) || comuna,
          region: txt(r?.region, 80) || region,
          maps_url: mapa && /(^|\.)google\.[a-z.]+$/i.test(mapa.hostname) ? mapa.href : '',
          nota: Number.isFinite(Number(r?.nota)) && r?.nota != null ? Number(r.nota) : null,
          resenas: Number.isFinite(Number(r?.resenas)) && r?.resenas != null ? Number(r.resenas) : null,
          rubro: txt(r?.rubro, 60),
        };
      })
      .filter((r) => r.place_id && r.nombre);
    if (!limpios.length) throw new BadRequestException('No hay clínicas marcadas para guardar.');

    const db = this.supabase.getClient();
    const existentes = await this.guardadas(limpios.map((r) => r.place_id));
    const ahora = new Date().toISOString();
    const detalle = (r: (typeof limpios)[number]) => ({
      nota: r.nota, resenas: r.resenas, rubro: r.rubro || null, correos: r.correos, whatsapp_origen: r.whatsapp_origen || null,
      comuna_buscada: comuna || null, region_buscada: region || null, rastreado_at: ahora, rastreado_por: usuarioEmail || null,
    });

    const nuevos = limpios.filter((r) => !existentes.has(r.place_id));
    let guardados = 0;
    for (let i = 0; i < nuevos.length; i += 100) {
      const filas = nuevos.slice(i, i + 100).map((r) => ({
        nombre: r.nombre, apellido: null, telefono: r.telefono || null, correo: r.correo || null, perfil: 'clinica',
        ciudad: r.comuna || null, origen: 'google-maps', acepta_datos: false, correo_enviado: false,
        categoria: 'cliente_rastreado', categoria_por: usuarioEmail || null, categoria_at: ahora, fuente: 'rastreo',
        whatsapp: r.whatsapp || null, sitio_web: r.sitio_web || null, direccion: r.direccion || null, comuna: r.comuna || null, region: r.region || null,
        place_id: r.place_id, maps_url: r.maps_url || null, rastreo: detalle(r), updated_at: ahora,
      }));
      const { data, error } = await db.from('comunidad_registros').insert(filas).select('id');
      if (error) throw new BadRequestException(esFaltaMigracion(error) ? FALTA_MIGRACION : error.message);
      guardados += (data || []).length;
    }

    // Las que ya estaban: se refrescan sus datos de contacto (no se toca la categoría ni se borra lo que tenían).
    let actualizados = 0;
    for (const r of limpios.filter((x) => existentes.has(x.place_id))) {
      const fila: Record<string, any> = { nombre: r.nombre, rastreo: detalle(r), updated_at: ahora };
      for (const k of ['telefono', 'correo', 'whatsapp', 'sitio_web', 'direccion', 'comuna', 'region', 'maps_url'] as const) if (r[k]) fila[k] = r[k];
      const { error } = await db.from('comunidad_registros').update(fila).eq('id', existentes.get(r.place_id) as number);
      if (!error) actualizados++;
      else this.logger.warn(`Rastreo: no se pudo actualizar ${r.nombre}: ${error.message}`);
    }

    // Bitácora del rastreo (si falla no se pierde lo guardado).
    const { error: errLog } = await db.from('comunidad_rastreos').insert([{ region, comuna, encontrados: Math.max(0, Math.round(Number(body?.encontrados) || limpios.length)), guardados, actualizados, usuario_email: usuarioEmail || null }]);
    if (errLog) this.logger.warn(`Rastreo: no se registró en la bitácora: ${errLog.message}`);
    this.logger.log(`Rastreo ${comuna} (${region}): ${guardados} clínica(s) nuevas y ${actualizados} actualizada(s) por ${usuarioEmail || 'sin usuario'}`);
    return { guardados, actualizados, total: limpios.length, region, comuna };
  }
}
