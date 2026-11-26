/* ── Aperturas de los mailings (2026-11-26) ──────────────────────────────────
   Pedido de Ariel: «en la funcionalidad de mailing, notificar cuando las
   personas abren los correos enviados».

   Cada correo lleva una imagen invisible de 1×1 con el token de SU
   destinatario; cuando el programa de correo la carga, el servidor anota la
   apertura (la primera fecha, la última y cuántas veces). Es aproximado por
   naturaleza: quien tiene las imágenes bloqueadas no cuenta, y Gmail o Apple
   Mail pueden cargarlas por su cuenta sin que la persona haya leído.

   Aquí está la parte sin base de datos, para poder probarla: el píxel, de
   dónde sale la dirección pública del servidor, el freno contra abuso y la
   regla de los avisos de la campana.

   AVISOS A QUIEN ENVIÓ (para no inundar la campana) — a lo más 4 por envío:
     1. La PRIMERA apertura del envío crea el aviso: «1 persona abrió tu
        correo “asunto”».
     2. Mientras ese aviso siga SIN LEER no se crea otro: el mismo aviso se
        reescribe con el número al día («12 personas abrieron…: 15 % de los
        80 enviados»).
     3. Si ya lo leyó, llega uno nuevo solo cuando las aperturas cruzan un
        tramo que el aviso anterior no había alcanzado (25 %, 50 % y 75 % de
        los enviados), y nunca antes de 60 minutos del anterior.
   Solo cuenta la primera apertura de cada persona (abrir tres veces el mismo
   correo no mueve el número). El detalle fino —quién y cuándo— está siempre
   en el seguimiento del envío. */

export const TIPO_MAILING_APERTURA = 'mailing_apertura';
export const TRAMOS_AVISO = [0.25, 0.5, 0.75];
export const MINUTOS_ENTRE_AVISOS = 60;

/** Los tokens son 16 bytes al azar en hexadecimal; cualquier otra cosa ni se consulta en la base. */
export function esTokenApertura(t: any): boolean {
  return typeof t === 'string' && /^[a-f0-9]{32}$/.test(t);
}

/** La imagen 1×1 del destinatario `token`. `baseApi` es la dirección pública del backend (…/api). */
export function pixelApertura(baseApi: string, token: string): string {
  const base = String(baseApi || '').replace(/\/+$/, '');
  return `<img src="${base}/mailings/track/open?t=${encodeURIComponent(token)}" width="1" height="1" border="0" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
}

/** El correo con su píxel: antes de </body> si es un documento completo; si no, al final. Sin base ni token queda igual. */
export function conPixelApertura(html: string, baseApi: string | null | undefined, token: string): string {
  const cuerpo = String(html ?? '');
  if (!baseApi || !token) return cuerpo;
  const pixel = pixelApertura(baseApi, token);
  const i = cuerpo.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? `${cuerpo.slice(0, i)}${pixel}${cuerpo.slice(i)}` : `${cuerpo}${pixel}`;
}

/** Una dirección que solo existe en este computador: el correo de otra persona no puede cargar nada de ahí. */
export function esBaseLocal(url: string | null | undefined): boolean {
  const s = String(url || '').trim();
  if (!s) return true;
  try {
    const h = new URL(s).hostname.toLowerCase();
    return h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || !h.includes('.');
  } catch {
    return true;
  }
}

/** La dirección con que el navegador llegó a este servidor (…/api): es pública por definición cuando la plataforma está en línea. */
export function baseDesdePeticion(req: any): string | null {
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim().toLowerCase();
  return `${proto === 'https' ? 'https' : 'http'}://${host}/api`;
}

/**
 * A dónde apunta el píxel. Manda PUBLIC_API_URL; si no está, la dirección por
 * la que llegó la petición de envío; después el dominio que pone Railway; al
 * final, localhost (y ahí no hay seguimiento posible).
 */
export function baseApiPublica(env: Record<string, string | undefined>, desdePeticion?: string | null): string {
  const limpia = (s: any) => String(s || '').trim().replace(/\/+$/, '');
  const railway = limpia(env.RAILWAY_PUBLIC_DOMAIN).replace(/^https?:\/\//i, '');
  const candidatas = [limpia(env.PUBLIC_API_URL), limpia(env.API_URL), limpia(desdePeticion), railway ? `https://${railway}/api` : ''];
  return candidatas.find((c) => c && !esBaseLocal(c)) || candidatas.find(Boolean) || `http://localhost:${env.PORT || 3001}/api`;
}

/* ── Regla de los avisos (ver arriba) ── */

export interface AvisoPrevio {
  abiertos: number; // cuántos llevaba cuando se escribió ese aviso
  leida: boolean;
  creado_at: string | Date | null;
}

/** Cuántos tramos (25 / 50 / 75 %) alcanzan `abiertos` sobre `enviados`. */
export function tramoDeApertura(abiertos: number, enviados: number): number {
  const base = Math.max(1, Number(enviados) || 0);
  const parte = (Number(abiertos) || 0) / base;
  return TRAMOS_AVISO.filter((t) => parte >= t).length;
}

export function decidirAvisoApertura(p: { abiertos: number; enviados: number; previo: AvisoPrevio | null; ahora?: Date }): 'crear' | 'actualizar' | 'nada' {
  const abiertos = Number(p.abiertos) || 0;
  if (abiertos <= 0) return 'nada';
  if (!p.previo) return 'crear';
  if (abiertos <= (Number(p.previo.abiertos) || 0)) return 'nada';
  if (!p.previo.leida) return 'actualizar';
  if (tramoDeApertura(abiertos, p.enviados) <= tramoDeApertura(p.previo.abiertos, p.enviados)) return 'nada';
  const antes = p.previo.creado_at ? new Date(p.previo.creado_at).getTime() : 0;
  const minutos = ((p.ahora || new Date()).getTime() - (Number.isFinite(antes) ? antes : 0)) / 60000;
  return minutos >= MINUTOS_ENTRE_AVISOS ? 'crear' : 'nada';
}

export interface AvisoApertura {
  destinatario: string;
  mensaje: string;
  link: string;
  metadata: { envio_id: number; asunto: string; abiertos: number; enviados: number; porcentaje: number; origen: string | null };
}

/** El aviso para quien envió. null si no se sabe quién fue o no hay aperturas. */
export function avisoApertura(
  envio: { id: number; asunto?: string | null; total?: number | null; enviados?: number | null; creado_por?: string | null; origen?: string | null },
  abiertos: number,
): AvisoApertura | null {
  const destinatario = String(envio?.creado_por || '').trim().toLowerCase();
  const n = Number(abiertos) || 0;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario) || n <= 0) return null;
  // Mientras el envío sigue saliendo, `enviados` va atrasado: nunca menos que los que ya abrieron.
  const enviados = Math.max(Number(envio.enviados) || Number(envio.total) || 0, n);
  const porcentaje = Math.round((n / enviados) * 100);
  const asunto = String(envio.asunto || '').trim().slice(0, 120) || 'sin asunto';
  const mensaje = n === 1
    ? `1 persona abrió tu correo «${asunto}»${enviados > 1 ? ` (de ${enviados.toLocaleString('es-CL')} enviados)` : ''}.`
    : `${n.toLocaleString('es-CL')} personas abrieron tu correo «${asunto}»: ${porcentaje} % de los ${enviados.toLocaleString('es-CL')} enviados.`;
  const origen = envio.origen ? String(envio.origen) : null;
  return {
    destinatario,
    mensaje,
    // Los de Comunidad abren su pestaña Mailing con el envío desplegado; los demás, Comunicaciones.
    link: origen === 'comunidad' ? `/comunidad-registros?vista=mailing&envio=${envio.id}` : '/comunicaciones',
    metadata: { envio_id: Number(envio.id), asunto, abiertos: n, enviados, porcentaje, origen },
  };
}

/* ── Freno contra abuso del píxel ──
   El píxel es público (el programa de correo no manda sesión) y responde
   siempre la imagen; lo que se limita es cuántas veces llega a la base:
     · el mismo token no vuelve a contar antes de 20 segundos (las cargas
       dobles de un mismo correo no inflan el contador);
     · una misma dirección IP, a lo más 240 consultas por minuto.
   Quien se pasa recibe igual su GIF, pero no toca la base. Vive en memoria:
   se reinicia con el servidor, que para un freno básico basta. */
export class LimitadorAperturas {
  private porToken = new Map<string, number>();
  private porIp = new Map<string, { desde: number; n: number }>();

  constructor(private opciones: { esperaTokenMs?: number; porMinutoIp?: number; maxEntradas?: number } = {}) {}

  /** ¿Esta carga del píxel puede llegar a la base? */
  permitir(ip: string, token: string, ahora: number = Date.now()): boolean {
    const esperaToken = this.opciones.esperaTokenMs ?? 20_000;
    const tope = this.opciones.porMinutoIp ?? 240;
    this.limpiar(ahora, esperaToken);
    const clave = String(ip || 'sin-ip');
    const v = this.porIp.get(clave);
    if (!v || ahora - v.desde >= 60_000) this.porIp.set(clave, { desde: ahora, n: 1 });
    else if (++v.n > tope) return false;
    const ultimo = this.porToken.get(token);
    if (ultimo !== undefined && ahora - ultimo < esperaToken) return false;
    this.porToken.set(token, ahora);
    return true;
  }

  private limpiar(ahora: number, esperaToken: number) {
    const max = this.opciones.maxEntradas ?? 20_000;
    if (this.porToken.size + this.porIp.size < max) return;
    for (const [k, t] of this.porToken) if (ahora - t >= esperaToken) this.porToken.delete(k);
    for (const [k, v] of this.porIp) if (ahora - v.desde >= 60_000) this.porIp.delete(k);
    // Si aun así no baja (un ataque con miles de tokens distintos), se parte de cero.
    if (this.porToken.size + this.porIp.size >= max) { this.porToken.clear(); this.porIp.clear(); }
  }
}
