/* ── Rastreo de clínicas dentales en Google Maps: la lógica (2026-11-17) ─────
   Pedido de Ariel: «una función de tipo bot que vaya por comunas en Google
   Maps viendo clínicas dentales y registre su nombre, correo, teléfono,
   WhatsApp, página, dirección, comuna y región; luego se almacenan en
   Comunidad Amsodent como Cliente Rastreado. Se selecciona la comuna, le damos
   a buscar y retorna el resultado».

   De dónde sale cada dato:
     · nombre, teléfono, página, dirección, comuna y región → Google Maps
       (Places API, búsqueda por texto «clínica dental en <comuna>…»).
     · correo y WhatsApp → Google Maps no los publica: se leen de la página web
       de la clínica (enlaces mailto:, correos escritos, enlaces wa.me /
       api.whatsapp.com). Si la página no trae WhatsApp y el teléfono de Maps es
       un celular, se propone ese mismo número (se marca como «del teléfono»).

   Este archivo no toca la red ni la base: recibe lo que entregó Google o el
   HTML de una página y devuelve los datos ordenados. Así se puede probar. */

/* Google entrega a lo más 60 lugares por búsqueda: en comunas con muchas
   clínicas una sola consulta se queda corta, así que se hacen varias con
   distintas palabras y se juntan sin repetir (hasta 18 llamadas por comuna). */
export const CONSULTAS_RASTREO = ['clínica dental', 'dentista', 'centro odontológico', 'ortodoncia', 'implantes dentales', 'odontopediatría'];

export interface ResultadoRastreo {
  place_id: string;
  nombre: string;
  telefono: string;
  whatsapp: string;
  /** 'sitio' = lo publica su página; 'telefono' = es el celular de Google Maps; '' = sin WhatsApp. */
  whatsapp_origen: 'sitio' | 'telefono' | '';
  correo: string;
  correos: string[];
  sitio_web: string;
  direccion: string;
  comuna: string;
  region: string;
  /** La dirección cae en la comuna que se buscó (Google también devuelve vecinas). */
  en_comuna: boolean;
  maps_url: string;
  nota: number | null;
  resenas: number | null;
  /** Rubro según Google: dentista, clínica dental… */
  rubro: string;
  /** Es del rubro dental (según Google o por su nombre). Google también devuelve hospitales, CESFAM y centros médicos. */
  dental: boolean;
  /** El lugar figura cerrado temporalmente. */
  cerrado_temporal: boolean;
}

export const sinTildes = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/* «Región Metropolitana de Santiago», «Metropolitana», «RM» → la misma clave. */
export function claveRegion(s: any): string {
  return sinTildes(s)
    .replace(/^region\s+(de(l)?\s+)?/, '')
    .replace(/\s+de santiago$/, '')
    .replace(/^libertador (general )?bernardo o'?higgins$/, "o'higgins")
    .replace(/^aysen.*$/, 'aysen')
    .replace(/^magallanes.*$/, 'magallanes')
    .replace(/^la araucania$/, 'araucania')
    .replace(/^(del )?bio\s*bio$/, 'biobio')
    .trim();
}

/** Cómo se le nombra la región a Google: «Región Metropolitana», «Región de Valparaíso». */
export function regionParaBuscar(region: any): string {
  const r = String(region ?? '').replace(/\s+/g, ' ').trim();
  if (/^regi[oó]n\b/i.test(r)) return r;
  if (/metropolitana/i.test(r)) return 'Región Metropolitana';
  return `Región de ${r}`;
}

// ── Teléfonos ───────────────────────────────────────────────────────────────

/** Deja un teléfono chileno como +56XXXXXXXXX; '' si no parece un teléfono. Otros países quedan con su +. */
export function telefonoE164(v: any): string {
  const crudo = String(v ?? '');
  const d = crudo.replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return '';
  if (d.startsWith('56') && d.length === 11) return `+${d}`;
  if (d.length === 9) return `+56${d}`; // 9XXXXXXXX (celular) o 2XXXXXXXX (fijo de Santiago)
  if (d.length === 8) return `+569${d}`; // celular escrito sin el 9
  if (crudo.trim().startsWith('+') || d.length > 9) return `+${d}`;
  return '';
}

export const esCelularChile = (e164: string) => /^\+569\d{8}$/.test(String(e164 || ''));

/** +56912345678 → «+56 9 1234 5678»; fijos «+56 2 2859 1531». Otros quedan igual. */
export function telefonoLegible(e164: string): string {
  const m = String(e164 || '').match(/^\+56(\d)(\d{4})(\d{4})$/);
  return m ? `+56 ${m[1]} ${m[2]} ${m[3]}` : String(e164 || '');
}

// ── Lugares de Google Maps ──────────────────────────────────────────────────

const RUBROS: Record<string, string> = {
  dental_clinic: 'Clínica dental', dentist: 'Dentista', orthodontist: 'Ortodoncista', medical_clinic: 'Clínica', doctor: 'Médico',
  hospital: 'Hospital', medical_lab: 'Laboratorio', store: 'Tienda', health: 'Salud',
};

/* Qué cuenta como «clínica dental»: el rubro que Google le pone al lugar o,
   si no lo trae, su nombre. La búsqueda por texto también devuelve hospitales,
   CESFAM y centros médicos generales: esos quedan marcados como no dentales. */
const TIPOS_DENTALES = new Set(['dentist', 'dental_clinic', 'orthodontist']);
const NOMBRE_DENTAL = /\b(dent\w*|odont\w*|ortodon\w*|orthodon\w*|endodon\w*|periodon\w*|implant\w*|maxilofacial|sonrisas?|smile|oral\w*|bucal\w*)\b/;

function componente(lugar: any, ...tipos: string[]): string {
  for (const t of tipos) {
    const c = (lugar?.addressComponents || []).find((x: any) => Array.isArray(x?.types) && x.types.includes(t));
    if (c?.longText) return String(c.longText).trim();
  }
  return '';
}

/** Un lugar de la Places API (New) → la fila que se muestra y se guarda. */
export function lugarAResultado(lugar: any, buscado: { region: string; comuna: string }): ResultadoRastreo | null {
  const id = String(lugar?.id || '').trim();
  const nombre = String(lugar?.displayName?.text || '').replace(/\s+/g, ' ').trim();
  if (!id || !nombre) return null;
  if (lugar?.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const comunaMaps = componente(lugar, 'administrative_area_level_3', 'locality', 'sublocality_level_1');
  const localidad = componente(lugar, 'locality');
  const regionMaps = componente(lugar, 'administrative_area_level_1');
  const buscada = sinTildes(buscado.comuna);
  const enComuna = !!buscada && [comunaMaps, localidad].some((c) => sinTildes(c) === buscada);
  const telefono = telefonoE164(lugar?.internationalPhoneNumber || lugar?.nationalPhoneNumber);
  const tipos: string[] = [lugar?.primaryType, ...(lugar?.types || [])].filter(Boolean);
  const rubro = tipos.map((t) => RUBROS[t]).find(Boolean) || '';
  const dental = tipos.some((t) => TIPOS_DENTALES.has(t)) || NOMBRE_DENTAL.test(sinTildes(nombre));
  return {
    place_id: id,
    nombre,
    telefono,
    whatsapp: esCelularChile(telefono) ? telefono : '',
    whatsapp_origen: esCelularChile(telefono) ? 'telefono' : '',
    correo: '',
    correos: [],
    sitio_web: String(lugar?.websiteUri || '').trim(),
    direccion: String(lugar?.formattedAddress || '').trim(),
    comuna: enComuna ? buscado.comuna : comunaMaps || localidad,
    region: enComuna || claveRegion(regionMaps) === claveRegion(buscado.region) ? buscado.region : regionMaps,
    en_comuna: enComuna,
    maps_url: String(lugar?.googleMapsUri || '').trim(),
    nota: Number.isFinite(Number(lugar?.rating)) && lugar?.rating != null ? Number(lugar.rating) : null,
    resenas: Number.isFinite(Number(lugar?.userRatingCount)) && lugar?.userRatingCount != null ? Number(lugar.userRatingCount) : null,
    rubro,
    dental,
    cerrado_temporal: lugar?.businessStatus === 'CLOSED_TEMPORARILY',
  };
}

// ── Páginas web de las clínicas ─────────────────────────────────────────────

/* Solo se leen páginas públicas por http(s): nada de direcciones internas. */
export function urlPublica(v: any): URL | null {
  let u: URL;
  try { u = new URL(String(v ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return null; // IP literal: no
  return u;
}

/* Redes sociales y acortadores: no son «la página de la clínica» (piden iniciar
   sesión o no traen correo); se guardan como enlace pero no se leen. */
const SIN_LEER = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|google\.[a-z.]+|goo\.gl|bit\.ly|linktr\.ee|doctoralia\.[a-z.]+|agendapro\.com|reservo\.cl|medilink\.[a-z.]+|dentalink\.[a-z.]+)$/i;
export const sitioSeLee = (u: URL) => !SIN_LEER.test(u.hostname) && !/(^|\.)(wa\.me|whatsapp\.com)$/i.test(u.hostname);

const whatsappDeDigitos = (d: string) => {
  const e = telefonoE164(d.startsWith('+') ? d : `+${d}`) || telefonoE164(d);
  return e && e.replace(/\D/g, '').length >= 10 ? e : '';
};

/** Números de WhatsApp que aparecen como enlace en un texto o HTML (también en la propia URL del sitio). */
export function whatsappsEn(textoHtml: string): string[] {
  const t = String(textoHtml || '').replace(/&amp;/g, '&').replace(/%2B/gi, '+');
  const out: string[] = [];
  const patrones = [
    /wa\.me\/\+?(\d[\d\s-]{7,16}\d)/gi,
    /(?:api|web)\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*&)?phone=\+?(\d{8,15})/gi,
    /whatsapp:\/\/send\/?\?(?:[^"'\s<>]*&)?phone=\+?(\d{8,15})/gi,
  ];
  for (const re of patrones) {
    for (const m of t.matchAll(re)) {
      const e = whatsappDeDigitos(m[1].replace(/\D/g, ''));
      if (e && !out.includes(e)) out.push(e);
    }
  }
  return out;
}

/* Cloudflare esconde los correos como <a data-cfemail="hex">: el primer byte es la llave. */
export function descifrarCfEmail(hex: string): string {
  const h = String(hex || '').trim();
  if (!/^[0-9a-f]{4,}$/i.test(h) || h.length % 2) return '';
  const llave = parseInt(h.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ llave);
  return out;
}

const RE_CORREO = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9][a-z0-9.-]{0,251}\.[a-z]{2,24}/gi;
const EXT_ARCHIVO = /\.(png|jpe?g|gif|webp|svg|avif|ico|css|js|json|woff2?|ttf|mp4|pdf)$/i;
const DOMINIOS_BASURA = /(^|\.)(sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|example\.(com|org)|ejemplo\.(com|cl)|domain\.com|dominio\.(com|cl)|tudominio\.(com|cl)|email\.com|correo\.com|mail\.com|yourdomain\.com|schema\.org|w3\.org|godaddy\.com|wordpress\.(com|org)|gravatar\.com|google\.com|googlemail\.com|jquery\.com|sitio\.com|test\.com)$/i;
const LOCAL_BASURA = /^(no-?reply|noresponder|donotreply|postmaster|mailer-daemon|abuse|webmaster|wordpress|usuario|user|name|nombre|tu|you|your|email|correo|ejemplo|example|test)$/i;
const LOCAL_CONTACTO = /^(contacto|info|informaciones|recepcion|hola|agenda|reservas?|citas|admin|administracion|ventas|clinica|atencion|secretaria|consultas?)\b/i;
const PROVEEDORES = /(^|\.)(gmail|hotmail|outlook|yahoo|live|icloud)\.[a-z.]+$/i;

const dominioBase = (host: string) => String(host || '').toLowerCase().replace(/^www\./, '');

/** Correos de contacto de una página, del más al menos probable. */
export function correosEn(html: string, hostSitio = ''): string[] {
  let t = String(html || '');
  // Correos escondidos por Cloudflare.
  for (const m of t.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) t += ` ${descifrarCfEmail(m[1])} `;
  t = t
    .replace(/&#0*64;|&#x0*40;|&commat;|%40/gi, '@')
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, '.')
    .replace(/\\u0040/gi, '@')
    .replace(/\\u003e|\\u003c|u003e|u003c/gi, ' ');
  const sitio = dominioBase(hostSitio);
  const vistos = new Map<string, number>();
  for (const m of t.matchAll(RE_CORREO)) {
    const correo = m[0].toLowerCase().replace(/^[._%+-]+/, '').replace(/\.+$/, '');
    const [local, dominio] = correo.split('@');
    if (!local || !dominio || EXT_ARCHIVO.test(correo) || DOMINIOS_BASURA.test(dominio) || LOCAL_BASURA.test(local)) continue;
    if (/^[0-9a-f]{24,}$/i.test(local) || local.length > 48) continue; // llaves de servicios de monitoreo
    if (vistos.has(correo)) continue;
    let puntos = 0;
    if (sitio && (dominio === sitio || dominio.endsWith(`.${sitio}`) || sitio.endsWith(`.${dominio}`))) puntos += 3;
    if (LOCAL_CONTACTO.test(local)) puntos += 2;
    if (PROVEEDORES.test(dominio)) puntos += 1;
    vistos.set(correo, puntos);
  }
  return [...vistos.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);
}

/** Enlace a la página de contacto del mismo sitio (para buscar ahí el correo si la portada no lo trae). */
export function enlaceContacto(html: string, base: URL): string | null {
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1].trim();
    const texto = m[2].replace(/<[^>]+>/g, ' ');
    if (/^(mailto:|tel:|javascript:|whatsapp:)/i.test(href)) continue;
    if (!/contact/i.test(href) && !/contact/i.test(texto)) continue;
    try {
      const u = new URL(href, base);
      if (dominioBase(u.hostname) !== dominioBase(base.hostname)) continue;
      if (u.href.replace(/\/+$/, '') === base.href.replace(/\/+$/, '')) continue;
      return u.href;
    } catch { /* enlace mal formado */ }
  }
  return null;
}

export interface ContactosDeSitio {
  correos: string[];
  whatsapps: string[];
}

/** Junta lo leído en una o más páginas del mismo sitio. */
export function contactosDe(paginas: string[], hostSitio: string): ContactosDeSitio {
  const todo = paginas.join('\n');
  return { correos: correosEn(todo, hostSitio), whatsapps: whatsappsEn(todo) };
}
