import { createHmac, timingSafeEqual } from 'crypto';
import { CATEGORIAS_COMUNIDAD, FilaComunidad, nombreCategoria } from './comunidad-categorias';

/* ── Mailing a la Comunidad Amsodent (2026-11-19) ────────────────────────────
   Pedido de Ariel: «generar funcionalidad de mailing para clientes de la
   comunidad».

   Desde Comunidad se elige a quién escribir (todas las filas, por categoría,
   las del filtro o las marcadas), se redacta el correo (asunto, mensaje con
   {nombre}, imagen y botón opcionales) y se envía uno por persona, con la
   plantilla de la marca, seguimiento de aperturas y un enlace para darse de
   baja. Simular muestra a cuántos llega y cómo se ve, sin enviar nada.

   Aquí está la lógica sin base de datos ni correo, para poder probarla:
   a quién le llega (y por qué no a los demás), el texto de cada persona, la
   plantilla y la firma del enlace de baja. */

export const CID_IMAGEN = 'imagen-comunidad';
export const MAX_DESTINATARIOS = 5000;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DestinatarioMailing {
  correo: string;
  nombre: string;
  categoria: string;
  ref: string;
}

export interface SeleccionMailing {
  destinatarios: DestinatarioMailing[];
  /** Filas elegidas que no reciben el correo, por motivo. */
  excluidos: { sin_correo: number; correo_invalido: number; repetidos: number; de_baja: number; no_encontradas: number };
  filas: number;
  por_categoria: { clave: string; nombre: string; n: number }[];
}

/** Primer nombre para el saludo: «ana maría PÉREZ» → «Ana». Una clínica conserva su nombre completo. */
export function nombreParaSaludo(f: Pick<FilaComunidad, 'nombre' | 'fuente' | 'perfil'>): string {
  const nombre = String(f?.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!nombre) return '';
  if (f.fuente === 'rastreo' || f.perfil === 'clinica') return nombre;
  const primero = nombre.split(' ')[0];
  // Solo se «arregla» lo que vino todo en mayúsculas o todo en minúsculas.
  if (primero === primero.toUpperCase() || primero === primero.toLowerCase()) return primero.charAt(0).toUpperCase() + primero.slice(1).toLowerCase();
  return primero;
}

/**
 * De las filas de Comunidad elegidas (`refs`; vacío = todas), a quién le llega
 * el correo: una vez por dirección, sin los que no tienen correo válido ni los
 * que se dieron de baja.
 */
export function elegirDestinatarios(filas: FilaComunidad[], refs: string[] | null, bajas: Iterable<string>): SeleccionMailing {
  const deBaja = new Set([...bajas].map((c) => String(c || '').trim().toLowerCase()));
  const pedidas = refs && refs.length ? new Set(refs.map(String)) : null;
  const elegidas = pedidas ? filas.filter((f) => pedidas.has(f.ref)) : filas;
  const excluidos = { sin_correo: 0, correo_invalido: 0, repetidos: 0, de_baja: 0, no_encontradas: pedidas ? Math.max(0, pedidas.size - elegidas.length) : 0 };
  const vistos = new Set<string>();
  const destinatarios: DestinatarioMailing[] = [];
  // Las personas antes que las clínicas rastreadas: si comparten correo, el saludo es para la persona.
  const orden = [...elegidas].sort((a, b) => Number(a.fuente === 'rastreo') - Number(b.fuente === 'rastreo'));
  for (const f of orden) {
    const correo = String(f.correo || '').trim().toLowerCase();
    if (!correo) { excluidos.sin_correo++; continue; }
    if (!RE_CORREO.test(correo)) { excluidos.correo_invalido++; continue; }
    if (deBaja.has(correo)) { excluidos.de_baja++; continue; }
    if (vistos.has(correo)) { excluidos.repetidos++; continue; }
    vistos.add(correo);
    destinatarios.push({ correo, nombre: nombreParaSaludo(f), categoria: f.categoria, ref: f.ref });
  }
  const cuenta = new Map<string, number>();
  for (const d of destinatarios) cuenta.set(d.categoria, (cuenta.get(d.categoria) || 0) + 1);
  const por_categoria = CATEGORIAS_COMUNIDAD.map((c) => ({ clave: c.clave as string, nombre: c.nombre as string, n: cuenta.get(c.clave) || 0 })).filter((c) => c.n > 0);
  return { destinatarios, excluidos, filas: elegidas.length, por_categoria };
}

/** Reemplaza {nombre}; sin nombre no deja «Hola :» ni «Hola ,». */
export function personalizar(texto: string, nombre: string): string {
  const n = String(nombre || '').trim();
  let s = String(texto ?? '');
  if (n) return s.replace(/\{\s*nombre\s*\}/gi, n);
  s = s.replace(/[ \t]*\{\s*nombre\s*\}/gi, '');
  // «{nombre}, te invitamos…» al comienzo de una línea queda sin la coma suelta.
  return s.replace(/^[ \t]*[,:;][ \t]*/gm, '');
}

export interface ContenidoMailing {
  asunto: string;
  mensaje: string;
  boton_texto?: string | null;
  boton_url?: string | null;
  con_imagen?: boolean;
  imagen_url?: string | null; // a dónde lleva la imagen al pincharla
}

export function validarContenido(c: any): { contenido: ContenidoMailing; problemas: string[] } {
  const problemas: string[] = [];
  const asunto = String(c?.asunto ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const mensaje = String(c?.mensaje ?? '').replace(/\r/g, '').trim().slice(0, 20000);
  const conImagen = c?.con_imagen === true || c?.con_imagen === 'true';
  if (asunto.length < 3) problemas.push('Escribe el asunto del correo.');
  if (!mensaje && !conImagen) problemas.push('Escribe el mensaje (o adjunta una imagen).');
  const url = (v: any, que: string) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const conProtocolo = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    try {
      const u = new URL(conProtocolo);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new Error('x');
      return u.toString();
    } catch {
      problemas.push(`El link ${que} no es una dirección web válida.`);
      return null;
    }
  };
  const botonTexto = String(c?.boton_texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
  const botonUrl = url(c?.boton_url, 'del botón');
  if (botonTexto && !botonUrl && !problemas.some((p) => p.includes('del botón'))) problemas.push('El botón necesita su link.');
  if (!botonTexto && botonUrl) problemas.push('Escribe el texto del botón (o borra su link).');
  const imagenUrl = url(c?.imagen_url, 'de la imagen');
  return { contenido: { asunto, mensaje, boton_texto: botonTexto, boton_url: botonTexto ? botonUrl : null, con_imagen: conImagen, imagen_url: conImagen ? imagenUrl : null }, problemas };
}

/** El mensaje (texto simple) como HTML de correo: párrafos y saltos de línea; los links quedan pinchables. */
function mensajeHtml(texto: string): string {
  const conLinks = (t: string) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" style="color:#1e9295;">$1</a>');
  return String(texto || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;color:#344054;font-size:14.5px;line-height:1.65;">${conLinks(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

/**
 * El correo completo de una persona (tablas y estilos en línea, como los demás
 * correos de la marca). `urlBaja` vacío = pie con «responde BAJA».
 */
export function htmlMailing(c: ContenidoMailing, d: { nombre: string }, opciones: { logoUrl: string; urlBaja?: string | null; anio?: number }): string {
  const cuerpo = mensajeHtml(personalizar(c.mensaje, d.nombre));
  const img = `<img src="cid:${CID_IMAGEN}" alt="" width="548" style="display:block;width:100%;max-width:548px;height:auto;border:0;border-radius:10px;" />`;
  const imagen = c.con_imagen
    ? `<tr><td style="padding:0 26px 18px;">${c.imagen_url ? `<a href="${esc(c.imagen_url)}" target="_blank" style="text-decoration:none;">${img}</a>` : img}</td></tr>`
    : '';
  const boton = c.boton_texto && c.boton_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 18px;"><tr><td align="center" style="border-radius:12px;background:#1e9295;background:linear-gradient(135deg,#28aeb1,#1e9295);">
        <a href="${esc(c.boton_url)}" target="_blank" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:12px;">${esc(c.boton_texto)}</a>
      </td></tr></table>`
    : '';
  const baja = opciones.urlBaja
    ? `Si no quieres recibir más correos de Amsodent, <a href="${esc(opciones.urlBaja)}" target="_blank" style="color:#667085;text-decoration:underline;">date de baja aquí</a>.`
    : 'Si no quieres recibir más correos de Amsodent, responde este mensaje con la palabra BAJA.';
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e7ec;">
      <tr><td style="height:6px;background:#28aeb1;background:linear-gradient(90deg,#28aeb1,#6fd0d2,#1e9295);font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td align="center" style="padding:24px 24px 16px;">
        <img src="${esc(opciones.logoUrl)}" alt="AMSODENT" width="160" style="display:block;width:160px;max-width:60%;height:auto;" />
      </td></tr>
      ${imagen}
      <tr><td style="padding:4px 26px 6px;">
        ${cuerpo}
        ${boton}
      </td></tr>
      <tr><td style="padding:14px 26px;background:#f8fafc;border-top:1px solid #eef2f6;">
        <span style="color:#98a2b3;font-size:11.5px;line-height:1.5;">© ${opciones.anio || new Date().getFullYear()} AMSODENT MEDICAL · Recibes este correo porque eres parte de la Comunidad Amsodent.<br/>${baja}</span>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

/* ── Enlace de baja: el correo viaja firmado, así nadie puede dar de baja a otra persona adivinando la dirección. */
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s: string) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export function firmaBaja(correo: string, secreto: string): string {
  return createHmac('sha256', `comunidad-baja:${secreto}`).update(String(correo || '').trim().toLowerCase()).digest('hex').slice(0, 32);
}

export function enlaceBaja(appUrl: string, correo: string, secreto: string): string {
  const c = String(correo || '').trim().toLowerCase();
  return `${String(appUrl || '').replace(/\/+$/, '')}/comunidad/baja?c=${b64url(c)}&f=${firmaBaja(c, secreto)}`;
}

/** El correo del enlace si la firma calza; null si el enlace está alterado o incompleto. */
export function leerEnlaceBaja(c: any, f: any, secreto: string): string | null {
  let correo = '';
  try { correo = deB64url(String(c || '')).trim().toLowerCase(); } catch { return null; }
  if (!RE_CORREO.test(correo)) return null;
  const esperada = Buffer.from(firmaBaja(correo, secreto));
  const recibida = Buffer.from(String(f || ''));
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  return correo;
}

/** Cómo va un envío, a partir de sus destinatarios. */
export function estadoDeEnvio(total: number, dest: { enviado_at?: any; fallo?: any; abierto_at?: any }[], enCurso: boolean) {
  const enviados = dest.filter((d) => d.enviado_at && !d.fallo).length;
  const fallidos = dest.filter((d) => d.fallo).length;
  const abiertos = dest.filter((d) => d.abierto_at).length;
  const pendientes = Math.max(0, (dest.length || total) - enviados - fallidos);
  const estado = enCurso ? 'enviando' : pendientes > 0 ? 'interrumpido' : fallidos > 0 && enviados === 0 ? 'fallido' : 'terminado';
  return { enviados, fallidos, abiertos, pendientes, estado };
}

export { nombreCategoria };
