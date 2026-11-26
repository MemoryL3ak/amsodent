import { esc, filaImagenAdjunta, leerUrl, marcoMailing, mensajeHtml, OpcionesMarco, personalizar } from './comunidad-mailing';

/* ── Plantillas de campaña para el mailing de Comunidad (2026-11-26) ─────────
   Pedido de Ariel: «generar funcionalidad para generar templates de mailing de
   campañas de marketing. Presentación de plataforma, presentación de productos
   nuevos, lanzamiento de marca, invitación a workshop, hands-on, campañas de
   descuentos».

   Cada plantilla es un dato: qué campos pide (los propios de su tipo) y cómo
   se arma su correo. Todo vive aquí, en el servidor: la pantalla pide el
   catálogo (para dibujar el formulario y la galería) y la vista previa, así
   no hay una segunda copia del diseño que se pueda desincronizar.

   Reglas del HTML (Gmail y Outlook): tablas, estilos en línea, 600 px, sin JS
   ni fuentes externas; el marco (franja, logo propio, pie con la baja) es el
   de comunidad-mailing.ts. Todo lo que escribe la persona pasa por `esc`, y
   los enlaces solo pueden ser http(s).

   El formulario parte con la redacción general ya escrita (`inicial`), pero
   los datos de la campaña —fecha, lugar, productos, precios, código, enlaces—
   parten vacíos: el `ejemplo` solo se ve como texto gris de guía y en la
   miniatura de la galería. Así nadie envía por descuido un dato inventado. */

export type TipoCampo = 'texto' | 'parrafo' | 'lineas' | 'url' | 'productos';

export interface CampoPlantilla {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  obligatorio?: boolean;
  max?: number;
  /** Texto de guía del formulario y contenido de la miniatura de la galería. */
  ejemplo?: any;
  /** Con qué parte el formulario. Solo redacción general: nunca fechas, precios ni enlaces. */
  inicial?: any;
  ayuda?: string;
  /** Cabe en media fila del formulario. */
  corto?: boolean;
}

interface Tema {
  acento: string; // botón, franja de arriba y detalles
  fondo: string; // fondo del encabezado
  kicker: string;
  titulo: string;
  bajada: string;
}

export interface ProductoPlantilla {
  nombre: string;
  descripcion: string;
  precio: string;
  imagen: string | null;
  enlace: string | null;
}

interface Plantilla {
  clave: string;
  nombre: string;
  descripcion: string;
  asunto: string;
  tema: Tema;
  campos: CampoPlantilla[];
  /** El cuerpo del correo. `x.t` es el tema de la plantilla; `x.imagen` y `x.boton` ya vienen armados. */
  filas: (d: Record<string, any>, x: { t: Tema; imagen: string; boton: string }) => string;
}

export const MAX_PRODUCTOS = 8;
const MAX_LINEAS = 8;

/** Lo que se pide de cada producto de «Productos nuevos» (la pantalla dibuja el formulario con esto). */
export const CAMPOS_PRODUCTO: CampoPlantilla[] = [
  { clave: 'nombre', etiqueta: 'Producto', tipo: 'texto', obligatorio: true, max: 120, ejemplo: 'Resina compuesta universal', corto: true },
  { clave: 'precio', etiqueta: 'Precio', tipo: 'texto', max: 40, ejemplo: '$18.990 + IVA', corto: true },
  { clave: 'descripcion', etiqueta: 'Descripción', tipo: 'texto', max: 300, ejemplo: 'Jeringa de 4 g. Alta estética y pulido duradero.' },
  { clave: 'imagen', etiqueta: 'Imagen (dirección web)', tipo: 'url', ejemplo: 'https://…/foto-del-producto.jpg', corto: true },
  { clave: 'enlace', etiqueta: 'Link del producto', tipo: 'url', ejemplo: 'https://…/producto', corto: true },
];

/* ── Piezas del correo (cada una es una fila <tr> de la tabla de 600 px) ── */

function filaEncabezado(t: Tema, kicker: string, titulo: string, bajada?: string, arriba = ''): string {
  return `<tr><td style="padding:0 26px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.fondo}" style="background:${t.fondo};border-radius:12px;">
          <tr><td align="center" style="padding:26px 22px;">
            <div style="font-size:11.5px;line-height:1.4;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.kicker};margin:0 0 8px;">${esc(kicker)}</div>
            ${arriba}
            ${titulo ? `<div style="font-size:25px;line-height:1.25;font-weight:bold;color:${t.titulo};margin:0;">${esc(titulo)}</div>` : ''}
            ${bajada ? `<div style="font-size:14.5px;line-height:1.5;color:${t.bajada};margin:10px 0 0;">${esc(bajada)}</div>` : ''}
          </td></tr>
        </table>
      </td></tr>`;
}

function filaTexto(texto: string): string {
  const html = mensajeHtml(texto);
  return html ? `<tr><td style="padding:2px 26px 4px;">${html}</td></tr>` : '';
}

function filaBoton(texto: string, url: string | null, color: string): string {
  if (!texto || !url) return '';
  return `<tr><td align="center" style="padding:8px 26px 22px;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td align="center" bgcolor="${color}" style="border-radius:12px;background:${color};">
          <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:12px;">${esc(texto)}</a>
        </td></tr></table>
      </td></tr>`;
}

function filaLista(titulo: string, items: string[], color: string): string {
  if (!items?.length) return '';
  const filas = items
    .map((i) => `<tr><td width="26" valign="top" style="padding:5px 0;color:${color};font-size:15px;line-height:1.5;font-weight:bold;">&#10003;</td><td valign="top" style="padding:5px 0;color:#344054;font-size:14.5px;line-height:1.5;">${esc(i)}</td></tr>`)
    .join('');
  return `<tr><td style="padding:0 26px 14px;">
        ${titulo ? `<div style="font-size:11.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#667085;margin:0 0 4px;">${esc(titulo)}</div>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
      </td></tr>`;
}

/** Ficha de la actividad: «Fecha · Hora · Lugar · Cupos», solo las filas que tienen dato. */
function filaFicha(pares: [string, string][], color: string): string {
  const conDato = pares.filter(([, v]) => v);
  if (!conDato.length) return '';
  const filas = conDato
    .map(([k, v], i) => {
      const borde = i < conDato.length - 1 ? 'border-bottom:1px solid #eef2f6;' : '';
      return `<tr><td width="112" valign="top" style="padding:11px 8px 11px 16px;${borde}font-size:11.5px;line-height:1.6;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:${color};">${esc(k)}</td><td valign="top" style="padding:11px 16px 11px 0;${borde}font-size:14.5px;line-height:1.45;font-weight:bold;color:#101828;">${esc(v)}</td></tr>`;
    })
    .join('');
  return `<tr><td style="padding:0 26px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e7ec;border-radius:12px;border-collapse:separate;">${filas}</table>
      </td></tr>`;
}

function filaProductos(productos: ProductoPlantilla[], color: string): string {
  if (!productos?.length) return '';
  const tarjetas = productos
    .map((p) => {
      const img = p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="120" style="display:block;width:120px;height:auto;border:0;border-radius:8px;" />` : '';
      const celdaImagen = img ? `<td width="132" valign="top" style="padding:12px 0 12px 12px;">${p.enlace ? `<a href="${esc(p.enlace)}" target="_blank" style="text-decoration:none;">${img}</a>` : img}</td>` : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e7ec;border-radius:12px;border-collapse:separate;margin:0 0 10px;"><tr>
          ${celdaImagen}
          <td valign="top" style="padding:12px 14px;">
            <div style="font-size:15.5px;line-height:1.3;font-weight:bold;color:#101828;">${esc(p.nombre)}</div>
            ${p.descripcion ? `<div style="font-size:13.5px;line-height:1.5;color:#475467;margin-top:4px;">${esc(p.descripcion)}</div>` : ''}
            ${p.precio ? `<div style="font-size:16px;line-height:1.3;font-weight:bold;color:${color};margin-top:8px;">${esc(p.precio)}</div>` : ''}
            ${p.enlace ? `<div style="margin-top:8px;"><a href="${esc(p.enlace)}" target="_blank" style="font-size:13px;font-weight:bold;color:${color};text-decoration:underline;">Ver producto</a></div>` : ''}
          </td>
        </tr></table>`;
    })
    .join('');
  return `<tr><td style="padding:4px 26px 8px;">${tarjetas}</td></tr>`;
}

function filaOferta(t: Tema, kicker: string, oferta: string, sobre: string, vigencia: string): string {
  return `<tr><td style="padding:0 26px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${t.fondo}" style="background:${t.fondo};border-radius:12px;">
          <tr><td align="center" style="padding:26px 22px;">
            ${kicker ? `<div style="font-size:11.5px;line-height:1.4;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.kicker};margin:0 0 10px;">${esc(kicker)}</div>` : ''}
            ${oferta ? `<div style="font-size:38px;line-height:1.1;font-weight:bold;color:${t.titulo};margin:0;">${esc(oferta)}</div>` : ''}
            ${sobre ? `<div style="font-size:15.5px;line-height:1.45;color:${t.bajada};margin:10px 0 0;">${esc(sobre)}</div>` : ''}
            ${vigencia ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:14px auto 0;"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:999px;padding:6px 14px;font-size:12.5px;line-height:1.3;font-weight:bold;color:${t.bajada};">${esc(vigencia)}</td></tr></table>` : ''}
          </td></tr>
        </table>
      </td></tr>`;
}

function filaCupon(codigo: string, color: string): string {
  if (!codigo) return '';
  return `<tr><td align="center" style="padding:6px 26px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="border:2px dashed ${color};border-radius:10px;border-collapse:separate;"><tr><td align="center" style="padding:10px 28px;">
          <div style="font-size:11px;line-height:1.4;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#667085;">Tu código</div>
          <div style="font-family:'Courier New',Courier,monospace;font-size:22px;line-height:1.3;font-weight:bold;letter-spacing:2px;color:#101828;">${esc(codigo)}</div>
        </td></tr></table>
      </td></tr>`;
}

function filaNota(texto: string): string {
  return texto ? `<tr><td style="padding:0 26px 16px;"><div style="font-size:12px;line-height:1.5;color:#667085;">${esc(texto)}</div></td></tr>` : '';
}

/* ── Las seis plantillas ── */

const SALUDO = 'Hola {nombre}:';
const campoTexto = (inicial: string, ejemplo?: string): CampoPlantilla => ({
  clave: 'texto', etiqueta: 'Mensaje', tipo: 'parrafo', max: 4000, inicial, ejemplo: ejemplo || inicial,
  ayuda: '{nombre} pone el nombre de cada persona. Una línea en blanco separa los párrafos.',
});
const camposBoton = (texto: string, ejemploUrl: string, etiquetaUrl = 'Link del botón'): CampoPlantilla[] => [
  { clave: 'boton_texto', etiqueta: 'Texto del botón', tipo: 'texto', obligatorio: true, max: 60, inicial: texto, ejemplo: texto, corto: true },
  { clave: 'boton_url', etiqueta: etiquetaUrl, tipo: 'url', obligatorio: true, ejemplo: ejemploUrl, corto: true },
];
const camposActividad = (ejemploNombre: string): CampoPlantilla[] => [
  { clave: 'actividad', etiqueta: 'Nombre de la actividad', tipo: 'texto', obligatorio: true, max: 140, ejemplo: ejemploNombre },
  { clave: 'fecha', etiqueta: 'Fecha', tipo: 'texto', obligatorio: true, max: 80, ejemplo: 'Jueves 10 de diciembre de 2026', corto: true },
  { clave: 'hora', etiqueta: 'Hora', tipo: 'texto', max: 60, ejemplo: '18:30 a 21:00 h', corto: true },
  { clave: 'lugar', etiqueta: 'Lugar', tipo: 'texto', obligatorio: true, max: 200, ejemplo: 'Av. Ejemplo 1234, Santiago' },
  { clave: 'cupos', etiqueta: 'Cupos', tipo: 'texto', max: 80, ejemplo: '20 cupos', corto: true },
  { clave: 'relator', etiqueta: 'Relator(a)', tipo: 'texto', max: 140, ejemplo: 'Dra. Nombre Apellido', corto: true },
];

function plantillas(appUrl: string): Plantilla[] {
  const app = String(appUrl || '').replace(/\/+$/, '');
  return [
    {
      clave: 'presentacion_plataforma',
      nombre: 'Presentación de la plataforma',
      descripcion: 'Da a conocer la plataforma en línea de Amsodent y lo que se puede hacer en ella.',
      asunto: 'Conoce la plataforma en línea de Amsodent',
      tema: { acento: '#1e9295', fondo: '#e8f7f7', kicker: '#1e9295', titulo: '#0b4f51', bajada: '#35686a' },
      campos: [
        { clave: 'titulo', etiqueta: 'Título', tipo: 'texto', obligatorio: true, max: 140, inicial: 'Tu clínica, más simple con Amsodent' },
        campoTexto(`${SALUDO}\n\nQueremos presentarte nuestra plataforma en línea: un solo lugar para hacer tus pedidos, revisar tus cotizaciones y facturas y llevar el control del inventario de tu clínica.`),
        {
          clave: 'beneficios', etiqueta: 'Qué puedes hacer (una idea por línea)', tipo: 'lineas',
          inicial: 'Haz y repite tus pedidos en minutos\nRevisa tus cotizaciones, facturas y pagos\nControla el stock de tu clínica y recibe avisos de reposición\nHabla directo con tu ejecutivo',
        },
        ...camposBoton('Conocer la plataforma', `${app}/portal-cliente`),
      ],
      filas: (d, x) => filaEncabezado(x.t, 'Plataforma Amsodent', d.titulo) + x.imagen + filaTexto(d.texto) + filaLista('', d.beneficios, x.t.acento) + x.boton,
    },
    {
      clave: 'productos_nuevos',
      nombre: 'Presentación de productos nuevos',
      descripcion: 'Muestra los productos recién llegados, cada uno con su descripción, precio e imagen.',
      asunto: 'Novedades: productos nuevos en Amsodent',
      tema: { acento: '#0e7490', fondo: '#ecfeff', kicker: '#0e7490', titulo: '#164e63', bajada: '#155e75' },
      campos: [
        { clave: 'titulo', etiqueta: 'Título', tipo: 'texto', obligatorio: true, max: 140, inicial: 'Llegaron novedades a nuestro catálogo' },
        campoTexto(`${SALUDO}\n\nSumamos productos nuevos a nuestro catálogo. Te contamos los destacados:`),
        {
          clave: 'productos', etiqueta: 'Productos', tipo: 'productos', obligatorio: true,
          ejemplo: [
            { nombre: 'Resina compuesta universal', descripcion: 'Jeringa de 4 g. Alta estética y pulido duradero.', precio: '$18.990 + IVA' },
            { nombre: 'Adhesivo de un solo paso', descripcion: 'Frasco de 5 ml. Grabado, imprimación y adhesión en una aplicación.', precio: '$24.990 + IVA' },
          ],
          ayuda: `Hasta ${MAX_PRODUCTOS}. La imagen va por su dirección web (debe ser pública y empezar con https://).`,
        },
        ...camposBoton('Ver el catálogo', 'https://amsodentmedical.cl'),
      ],
      filas: (d, x) => filaEncabezado(x.t, 'Productos nuevos', d.titulo) + x.imagen + filaTexto(d.texto) + filaProductos(d.productos, x.t.acento) + x.boton,
    },
    {
      clave: 'lanzamiento_marca',
      nombre: 'Lanzamiento de marca',
      descripcion: 'Anuncia una marca que se suma al catálogo, con su logo y lo que la distingue.',
      asunto: 'Una nueva marca llega a Amsodent',
      tema: { acento: '#1e9295', fondo: '#0f172a', kicker: '#6fd0d2', titulo: '#ffffff', bajada: '#cbd5e1' },
      campos: [
        { clave: 'marca', etiqueta: 'Nombre de la marca', tipo: 'texto', obligatorio: true, max: 80, ejemplo: 'Marca Ejemplo', corto: true },
        { clave: 'logo_url', etiqueta: 'Logo de la marca (dirección web)', tipo: 'url', ejemplo: 'https://…/logo-de-la-marca.png', corto: true },
        { clave: 'titulo', etiqueta: 'Frase de presentación', tipo: 'texto', max: 160, inicial: 'Ya disponible en Amsodent' },
        campoTexto(`${SALUDO}\n\nNos alegra contarte que sumamos una nueva marca a nuestro catálogo, pensada para el trabajo diario de tu clínica.`),
        { clave: 'destacados', etiqueta: 'Qué la distingue (una idea por línea)', tipo: 'lineas', ejemplo: 'Línea completa de restauración\nRespaldo y garantía del fabricante\nStock disponible para despacho inmediato' },
        ...camposBoton('Conocer la marca', 'https://amsodentmedical.cl'),
      ],
      filas: (d, x) => {
        const logo = d.logo_url
          ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:4px auto 14px;"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:10px;padding:12px 18px;"><img src="${esc(d.logo_url)}" alt="${esc(d.marca)}" width="180" style="display:block;width:180px;max-width:100%;height:auto;border:0;" /></td></tr></table>`
          : '';
        return filaEncabezado(x.t, 'Nueva marca en Amsodent', d.marca, d.titulo, logo) + x.imagen + filaTexto(d.texto) + filaLista('', d.destacados, x.t.acento) + x.boton;
      },
    },
    {
      clave: 'workshop',
      nombre: 'Invitación a workshop',
      descripcion: 'Invita a una charla o taller con su fecha, hora, lugar, cupos y link de inscripción.',
      asunto: 'Te invitamos a nuestro próximo workshop',
      tema: { acento: '#4338ca', fondo: '#eef2ff', kicker: '#4338ca', titulo: '#1e1b4b', bajada: '#4338ca' },
      campos: [
        ...camposActividad('Workshop de estética dental'),
        campoTexto(`${SALUDO}\n\nTe invitamos a nuestro próximo workshop: una instancia para aprender, resolver dudas y compartir con colegas.`),
        ...camposBoton('Inscribirme', 'https://…/inscripcion', 'Link de inscripción'),
      ],
      filas: (d, x) =>
        filaEncabezado(x.t, 'Workshop', d.actividad, d.relator ? `Con ${d.relator}` : '') + x.imagen + filaTexto(d.texto) +
        filaFicha([['Fecha', d.fecha], ['Hora', d.hora], ['Lugar', d.lugar], ['Cupos', d.cupos]], x.t.acento) + x.boton,
    },
    {
      clave: 'hands_on',
      nombre: 'Invitación a hands-on',
      descripcion: 'Invita a una jornada práctica: datos de la actividad, qué incluye y link de inscripción.',
      asunto: 'Hands-on Amsodent: cupos limitados',
      tema: { acento: '#c2410c', fondo: '#fff7ed', kicker: '#c2410c', titulo: '#7c2d12', bajada: '#9a3412' },
      campos: [
        ...camposActividad('Hands-on de carillas directas'),
        campoTexto(`${SALUDO}\n\nTe invitamos a un hands-on: una jornada práctica, con cupos limitados, para trabajar directamente con los materiales y la guía de un especialista.`),
        { clave: 'incluye', etiqueta: 'Qué incluye (una idea por línea)', tipo: 'lineas', ejemplo: 'Materiales e instrumental para la práctica\nCertificado de participación\nCoffee break' },
        ...camposBoton('Reservar mi cupo', 'https://…/inscripcion', 'Link de inscripción'),
      ],
      filas: (d, x) =>
        filaEncabezado(x.t, 'Hands-on · Curso práctico', d.actividad, d.relator ? `Con ${d.relator}` : '') + x.imagen + filaTexto(d.texto) +
        filaFicha([['Fecha', d.fecha], ['Hora', d.hora], ['Lugar', d.lugar], ['Cupos', d.cupos]], x.t.acento) +
        filaLista('Incluye', d.incluye, x.t.acento) + x.boton,
    },
    {
      clave: 'descuentos',
      nombre: 'Campaña de descuentos',
      descripcion: 'Destaca una oferta: el descuento, sobre qué aplica, su vigencia y el código.',
      asunto: 'Oferta especial para la Comunidad Amsodent',
      tema: { acento: '#be123c', fondo: '#fff1f2', kicker: '#be123c', titulo: '#be123c', bajada: '#9f1239' },
      campos: [
        { clave: 'oferta', etiqueta: 'La oferta', tipo: 'texto', obligatorio: true, max: 60, ejemplo: '20 % de descuento', corto: true, ayuda: 'El porcentaje o el texto de la oferta: va en grande.' },
        { clave: 'sobre', etiqueta: 'Sobre qué aplica', tipo: 'texto', max: 160, ejemplo: 'en toda la línea de resinas', corto: true },
        { clave: 'vigencia', etiqueta: 'Vigencia', tipo: 'texto', max: 100, ejemplo: 'Hasta el 30 de noviembre de 2026', corto: true },
        { clave: 'codigo', etiqueta: 'Código de descuento', tipo: 'texto', max: 40, ejemplo: 'COMUNIDAD20', corto: true },
        { clave: 'titulo', etiqueta: 'Encabezado', tipo: 'texto', max: 80, inicial: 'Oferta para la Comunidad Amsodent' },
        campoTexto(`${SALUDO}\n\nPreparamos un descuento pensado para ti.`),
        { clave: 'condiciones', etiqueta: 'Condiciones (letra chica)', tipo: 'texto', max: 300, ejemplo: 'No acumulable con otras promociones. Hasta agotar stock.' },
        ...camposBoton('Aprovechar la oferta', 'https://amsodentmedical.cl'),
      ],
      filas: (d, x) => filaOferta(x.t, d.titulo, d.oferta, d.sobre, d.vigencia) + x.imagen + filaTexto(d.texto) + filaCupon(d.codigo, x.t.acento) + x.boton + filaNota(d.condiciones),
    },
  ];
}

export const CLAVES_PLANTILLA = plantillas('').map((p) => p.clave);

const buscar = (clave: any, appUrl = ''): Plantilla | null => plantillas(appUrl).find((p) => p.clave === String(clave || '')) || null;

const limpio = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const parrafo = (v: any, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const lineas = (v: any) =>
  (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((l) => limpio(l, 160)).filter(Boolean).slice(0, MAX_LINEAS);

/** Los datos de la plantilla tal como llegan: un objeto, o su JSON (el formulario viaja como multipart). */
export function leerDatosPlantilla(v: any): Record<string, any> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const o = JSON.parse(v);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch {
      /* no era JSON: sin datos */
    }
  }
  return {};
}

/**
 * Revisa y ordena lo escrito en el formulario de una plantilla. Devuelve los
 * datos limpios (textos recortados, listas sin líneas vacías, enlaces con
 * https://) y qué falta o está mal. `datos` sirve para la vista previa aunque
 * haya problemas: lo que falta simplemente no se dibuja.
 */
export function validarPlantilla(clave: any, crudo: any): { clave: string | null; datos: Record<string, any>; problemas: string[] } {
  const p = buscar(clave);
  if (!p) return { clave: null, datos: {}, problemas: ['Esa plantilla no existe: elige una de la galería.'] };
  const entrada = leerDatosPlantilla(crudo);
  const datos: Record<string, any> = {};
  const problemas: string[] = [];
  const falta = (c: CampoPlantilla) => problemas.push(`Falta completar «${c.etiqueta.replace(/\s*\(.*\)$/, '')}».`);
  const enlace = (v: any, que: string): string | null => {
    const r = leerUrl(v);
    if (!r.url && !r.vacia) problemas.push(`${que} no es una dirección web válida.`);
    return r.url;
  };
  for (const c of p.campos) {
    const v = entrada[c.clave];
    if (c.tipo === 'texto') {
      datos[c.clave] = limpio(v, c.max || 160);
      if (!datos[c.clave] && c.obligatorio) falta(c);
    } else if (c.tipo === 'parrafo') {
      datos[c.clave] = parrafo(v, c.max || 4000);
      if (!datos[c.clave] && c.obligatorio) falta(c);
    } else if (c.tipo === 'lineas') {
      datos[c.clave] = lineas(v);
      if (!datos[c.clave].length && c.obligatorio) falta(c);
    } else if (c.tipo === 'url') {
      datos[c.clave] = enlace(v, `«${c.etiqueta.replace(/\s*\(.*\)$/, '')}»`);
      if (!datos[c.clave] && c.obligatorio && leerUrl(v).vacia) falta(c);
    } else {
      const lista: ProductoPlantilla[] = [];
      (Array.isArray(v) ? v : []).slice(0, MAX_PRODUCTOS).forEach((crudoProducto: any, i: number) => {
        const prod = {
          nombre: limpio(crudoProducto?.nombre, 120),
          descripcion: limpio(crudoProducto?.descripcion, 300),
          precio: limpio(crudoProducto?.precio, 40),
          imagen: enlace(crudoProducto?.imagen, `La imagen del producto ${i + 1}`),
          enlace: enlace(crudoProducto?.enlace, `El link del producto ${i + 1}`),
        };
        const algo = prod.nombre || prod.descripcion || prod.precio || prod.imagen || prod.enlace || String(crudoProducto?.imagen || crudoProducto?.enlace || '').trim();
        if (!algo) return; // una tarjeta que quedó en blanco no cuenta
        if (!prod.nombre) problemas.push(`Al producto ${i + 1} le falta el nombre.`);
        lista.push(prod);
      });
      datos[c.clave] = lista;
      if (!lista.length && c.obligatorio) problemas.push('Agrega al menos un producto.');
    }
  }
  return { clave: p.clave, datos, problemas };
}

/** ¿Algún texto de la plantilla usa {nombre}? (para avisar de los destinatarios sin nombre). */
export function plantillaUsaNombre(datos: Record<string, any>): boolean {
  return /\{\s*nombre\s*\}/i.test(JSON.stringify(datos || {}));
}

/** {nombre} en todos los textos (no en los enlaces): así no queda ningún marcador sin reemplazar. */
function personalizarDatos(p: Plantilla, datos: Record<string, any>, nombre: string): Record<string, any> {
  const out: Record<string, any> = { ...datos };
  for (const c of p.campos) {
    const v = datos[c.clave];
    if (c.tipo === 'texto' || c.tipo === 'parrafo') out[c.clave] = personalizar(String(v ?? ''), nombre).trim();
    else if (c.tipo === 'lineas') out[c.clave] = (Array.isArray(v) ? v : []).map((l: string) => personalizar(l, nombre).trim()).filter(Boolean);
    else if (c.tipo === 'productos') {
      out[c.clave] = (Array.isArray(v) ? v : []).map((x: ProductoPlantilla) => ({
        ...x, nombre: personalizar(x.nombre, nombre).trim(), descripcion: personalizar(x.descripcion, nombre).trim(), precio: personalizar(x.precio, nombre).trim(),
      }));
    } else out[c.clave] = v || null;
  }
  return out;
}

export interface OpcionesPlantilla extends OpcionesMarco {
  conImagen?: boolean; // lleva la imagen adjunta (cid), bajo el encabezado
  imagenUrl?: string | null;
  /** Vista previa mientras se escribe: el botón se dibuja aunque todavía no tenga su link. */
  borrador?: boolean;
}

/**
 * El correo completo de una persona con la plantilla `clave`. `datos` son los
 * de `validarPlantilla` (ya limpios). Devuelve '' si la plantilla no existe.
 */
export function htmlPlantilla(clave: any, datos: Record<string, any>, d: { nombre: string }, opciones: OpcionesPlantilla): string {
  const p = buscar(clave);
  if (!p) return '';
  const x = personalizarDatos(p, datos || {}, d?.nombre || '');
  const boton = filaBoton(x.boton_texto, x.boton_url || (opciones.borrador ? '#' : null), p.tema.acento);
  const imagen = filaImagenAdjunta(opciones.conImagen, opciones.imagenUrl);
  return marcoMailing(p.filas(x, { t: p.tema, imagen, boton }), { logoUrl: opciones.logoUrl, urlBaja: opciones.urlBaja, anio: opciones.anio, barra: `background:${p.tema.acento};` });
}

const valorDe = (c: CampoPlantilla, cual: 'inicial' | 'ejemplo') => {
  const v = cual === 'ejemplo' ? (c.ejemplo ?? c.inicial) : c.inicial;
  if (c.tipo === 'productos') return Array.isArray(v) ? v.map((x: any) => ({ nombre: '', descripcion: '', precio: '', imagen: '', enlace: '', ...x })) : [];
  return String(v ?? '');
};

/**
 * El catálogo para la pantalla: cada plantilla con sus campos (para dibujar el
 * formulario), con qué parte el formulario (`inicial`) y su correo de ejemplo
 * (`html_ejemplo`, la miniatura de la galería).
 */
export function catalogoPlantillas(opciones: { appUrl: string; logoUrl: string; anio?: number }) {
  return plantillas(opciones.appUrl).map((p) => {
    const ejemplo = Object.fromEntries(p.campos.map((c) => [c.clave, valorDe(c, 'ejemplo')]));
    // Los links de ejemplo con «…» son solo texto de guía: en la miniatura el botón apunta a la aplicación.
    for (const c of p.campos) if (c.tipo === 'url' && String(ejemplo[c.clave]).includes('…')) ejemplo[c.clave] = c.clave === 'boton_url' ? opciones.appUrl : '';
    const v = validarPlantilla(p.clave, ejemplo);
    return {
      clave: p.clave,
      nombre: p.nombre,
      descripcion: p.descripcion,
      asunto: p.asunto,
      color: p.tema.acento,
      campos: p.campos.map((c) => ({
        clave: c.clave, etiqueta: c.etiqueta, tipo: c.tipo, obligatorio: !!c.obligatorio, max: c.max || null, corto: !!c.corto, ayuda: c.ayuda || null,
        ejemplo: c.tipo === 'productos' ? null : String(c.ejemplo ?? c.inicial ?? ''),
      })),
      inicial: Object.fromEntries(p.campos.map((c) => [c.clave, valorDe(c, 'inicial')])),
      html_ejemplo: htmlPlantilla(p.clave, v.datos, { nombre: 'Ana' }, { logoUrl: opciones.logoUrl, urlBaja: null, anio: opciones.anio }),
    };
  });
}

export function nombreDePlantilla(clave: any): string | null {
  return buscar(clave)?.nombre || null;
}
