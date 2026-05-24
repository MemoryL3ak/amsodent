// Plantillas HTML para correos transaccionales de AMSODENT.
// Estilo "claro y minimalista": fondo gris muy claro, tarjetas blancas,
// acento turquesa del logo. HTML compatible con clientes de correo
// (tablas + estilos inline + emoji como iconos, sin imágenes externas).

const LOGO_URL =
  'https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png';
const SITIO_WEB = 'https://amsodentmedical.cl';

const C = {
  acento: '#25b7bd', // turquesa del logo
  acentoOsc: '#178a8f',
  acentoSuave: '#e7f8f8', // turquesa muy claro (fondos de icono)
  titulo: '#111827', // casi negro (títulos)
  texto: '#1f2937', // gris oscuro (cuerpo)
  suave: '#6b7280', // gris secundario
  tenue: '#9ca3af', // gris terciario
  borde: '#e5e7eb',
  bordeTenue: '#f1f3f4',
  fondo: '#f4f6f7', // fondo general gris muy claro
  panel: '#f9fafb', // tarjetas/paneles tenues
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export type PlantillaResultado = {
  asunto: string;
  html: string;
};

function escapeHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fechaLarga(): string {
  return new Date().toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Marco corporativo: preheader oculto + header blanco con logo + footer claro.
function envolver(opts: { preheader: string; contenido: string }): string {
  const anio = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>AMSODENT</title>
</head>
<body style="margin:0;padding:0;background:${C.fondo};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.fondo};font-size:1px;line-height:1px;">
    ${escapeHtml(opts.preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${C.borde};box-shadow:0 4px 24px rgba(15,23,42,.06);">
          <!-- Header blanco con logo -->
          <tr>
            <td style="background:#ffffff;padding:32px 32px 22px;text-align:center;">
              <img src="${LOGO_URL}" alt="Amsodent Medical" width="180" style="display:inline-block;width:180px;max-width:70%;height:auto;" />
            </td>
          </tr>
          <!-- Línea de acento turquesa -->
          <tr><td style="height:3px;background:${C.acento};line-height:3px;font-size:0;">&nbsp;</td></tr>
          <!-- Contenido -->
          <tr>
            <td style="padding:34px 34px 12px;color:${C.texto};font-size:15px;line-height:1.65;">
              ${opts.contenido}
            </td>
          </tr>
          <!-- Footer claro -->
          <tr>
            <td style="background:${C.panel};border-top:1px solid ${C.borde};padding:24px 32px;text-align:center;">
              <img src="${LOGO_URL}" alt="Amsodent Medical" width="118" style="display:inline-block;width:118px;height:auto;opacity:.92;" />
              <div style="color:${C.tenue};font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-top:8px;">
                Insumos y equipamiento dental
              </div>
              <div style="margin:12px 0 0;">
                <a href="${SITIO_WEB}" style="color:${C.acento};font-size:12px;text-decoration:none;font-weight:600;">amsodentmedical.cl</a>
              </div>
              <div style="color:${C.tenue};font-size:11px;line-height:1.6;margin-top:14px;border-top:1px solid ${C.borde};padding-top:13px;">
                Este correo fue enviado automáticamente desde el sistema de gestión de AMSODENT.<br/>
                &copy; ${anio} AMSODENT &middot; Todos los derechos reservados.
              </div>
            </td>
          </tr>
        </table>
        <div style="color:${C.tenue};font-size:11px;margin-top:14px;">${fechaLarga()}</div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Icono circular suave (fondo turquesa claro) centrado.
function insignia(simbolo: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;">
    <tr>
      <td width="64" height="64" align="center" valign="middle"
          style="width:64px;height:64px;background:${C.acentoSuave};border-radius:50%;font-size:28px;line-height:64px;text-align:center;">
        ${simbolo}
      </td>
    </tr>
  </table>`;
}

// Fila de dato con icono dentro de la tarjeta.
function filaDato(icono: string, etiqueta: string, valor: string, ultima = false): string {
  const borde = ultima ? '' : `border-bottom:1px solid ${C.bordeTenue};`;
  return `<tr>
    <td style="padding:12px 0;${borde}width:28px;font-size:16px;vertical-align:middle;">${icono}</td>
    <td style="padding:12px 0;${borde}color:${C.suave};font-size:12px;text-transform:uppercase;letter-spacing:.5px;vertical-align:middle;width:44%;">${escapeHtml(etiqueta)}</td>
    <td style="padding:12px 0;${borde}color:${C.titulo};font-size:15px;font-weight:700;text-align:right;vertical-align:middle;">${escapeHtml(valor)}</td>
  </tr>`;
}

// Tarjeta de datos: panel claro con borde y título de sección turquesa.
function tarjetaDatos(titulo: string, filas: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px;background:${C.panel};border:1px solid ${C.borde};border-radius:12px;">
    <tr><td style="padding:15px 20px 2px;color:${C.acentoOsc};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">${escapeHtml(titulo)}</td></tr>
    <tr><td style="padding:0 20px 7px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
    </td></tr>
  </table>`;
}

// Tracker horizontal de 3 pasos.
function pasos(activo: number): string {
  const data = [
    { emoji: '📥', label: 'Recibida' },
    { emoji: '📦', label: 'En preparación' },
    { emoji: '🚚', label: 'Despacho' },
  ];
  const celdas = data
    .map((p, i) => {
      const on = i <= activo;
      const bg = on ? C.acento : '#edf0f2';
      const txt = on ? C.titulo : C.tenue;
      const op = on ? '1' : '.55';
      return `<td align="center" width="33%" style="padding:0 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
          <td width="44" height="44" align="center" valign="middle"
              style="width:44px;height:44px;background:${bg};border-radius:50%;font-size:19px;line-height:44px;text-align:center;opacity:${op};">${p.emoji}</td>
        </tr></table>
        <div style="margin-top:7px;font-size:11px;font-weight:700;color:${txt};">${p.label}</div>
      </td>`;
    })
    .join(`<td width="18" valign="middle" style="font-size:0;line-height:0;"><div style="height:2px;background:${C.borde};"></div></td>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 26px;"><tr>${celdas}</tr></table>`;
}

function firma(vendedorNombre: string, vendedorCorreo: string, vendedorCelular: string): string {
  const partes = [
    vendedorCorreo
      ? `<a href="mailto:${escapeHtml(vendedorCorreo)}" style="color:${C.acentoOsc};text-decoration:none;">✉️ ${escapeHtml(vendedorCorreo)}</a>`
      : '',
    vendedorCelular ? `<span style="color:${C.suave};">📞 ${escapeHtml(vendedorCelular)}</span>` : '',
  ].filter(Boolean);
  const contacto = partes.length
    ? `<div style="margin-top:7px;font-size:13px;">${partes.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid ${C.borde};">
    <tr><td style="padding-top:18px;">
      <div style="color:${C.suave};font-size:13px;">Saludos cordiales,</div>
      <div style="color:${C.titulo};font-size:16px;font-weight:800;margin-top:3px;">${escapeHtml(vendedorNombre)}</div>
      <div style="color:${C.acentoOsc};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;margin-top:1px;">Equipo Comercial &middot; AMSODENT</div>
      ${contacto}
    </td></tr>
  </table>`;
}

// Bloque de nota tenue al pie del contenido.
function nota(texto: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 4px;background:${C.panel};border:1px solid ${C.borde};border-radius:10px;">
    <tr><td style="padding:13px 17px;color:${C.suave};font-size:13px;line-height:1.6;">${texto}</td></tr>
  </table>`;
}

function titulo(texto: string, subtitulo: string): string {
  return `<h1 style="margin:0 0 6px;font-size:23px;font-weight:800;color:${C.titulo};text-align:center;letter-spacing:-.3px;">${escapeHtml(texto)}</h1>
    <p style="margin:0 0 24px;color:${C.suave};font-size:14px;text-align:center;">${escapeHtml(subtitulo)}</p>`;
}

function etiquetaSeccion(texto: string): string {
  return `<div style="color:${C.acentoOsc};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:2px;">${escapeHtml(texto)}</div>`;
}

export type DatosAgradecimientoOC = {
  nombreCliente?: string;
  numeroOc?: string;
  vendedorNombre?: string;
  vendedorCorreo?: string;
  vendedorCelular?: string;
};

// #1 + #2: agradecimiento al recibir la orden de compra. Asunto = N° de OC.
export function plantillaAgradecimientoOC(
  datos: DatosAgradecimientoOC,
): PlantillaResultado {
  const cliente = String(datos.nombreCliente || '').trim() || 'Estimado cliente';
  const numeroOc = String(datos.numeroOc || '').trim();
  const vendedor = String(datos.vendedorNombre || '').trim() || 'Equipo AMSODENT';
  const vCorreo = String(datos.vendedorCorreo || '').trim();
  const vCelular = String(datos.vendedorCelular || '').trim();

  const filas = [
    numeroOc ? filaDato('📋', 'N° Orden de Compra', numeroOc) : '',
    filaDato('🏢', 'Cliente', cliente),
    filaDato('📅', 'Fecha de recepción', fechaLarga(), true),
  ]
    .filter(Boolean)
    .join('');

  const contenido = `
    ${insignia(`<span style="color:${C.acentoOsc};font-weight:700;">✓</span>`)}
    ${titulo('¡Gracias por tu orden de compra!', 'Recibimos tu pedido y ya estamos trabajando en él.')}
    <p style="margin:0 0 14px;">Estimado(a) <strong>${escapeHtml(cliente)}</strong>,</p>
    <p style="margin:0 0 20px;color:${C.suave};">
      Queremos agradecerte por confiar en <strong style="color:${C.texto};">AMSODENT</strong>.
      Tu orden de compra fue recibida correctamente y entró en proceso. A continuación
      te dejamos el detalle y el estado de tu pedido.
    </p>
    ${tarjetaDatos('Detalle de tu pedido', filas)}
    ${etiquetaSeccion('Estado del pedido')}
    ${pasos(0)}
    ${nota('💬&nbsp;&nbsp;Si tienes cualquier consulta sobre tu pedido, puedes responder directamente a este correo y te atenderemos a la brevedad.')}
    ${firma(vendedor, vCorreo, vCelular)}`;

  return {
    // #2: el asunto es el N° de la OC.
    asunto: numeroOc || 'Orden de Compra recibida',
    html: envolver({
      preheader: `Recibimos tu orden de compra${numeroOc ? ` N° ${numeroOc}` : ''}. ¡Gracias por tu compra!`,
      contenido,
    }),
  };
}

export type DatosGuiaDespacho = {
  nombreCliente?: string;
  numeroOc?: string;
  numeroGuia?: string;
  numeroSeguimiento?: string;
  empresaDespacho?: string;
  vendedorNombre?: string;
  vendedorCorreo?: string;
  vendedorCelular?: string;
};

// #4 + #2: envío de la guía de despacho. Asunto = N° de OC.
export function plantillaGuiaDespacho(
  datos: DatosGuiaDespacho,
): PlantillaResultado {
  const cliente = String(datos.nombreCliente || '').trim() || 'Estimado cliente';
  const numeroOc = String(datos.numeroOc || '').trim();
  const numeroGuia = String(datos.numeroGuia || '').trim();
  const seguimiento = String(datos.numeroSeguimiento || '').trim();
  const empresa = String(datos.empresaDespacho || '').trim();
  const vendedor = String(datos.vendedorNombre || '').trim() || 'Equipo AMSODENT';
  const vCorreo = String(datos.vendedorCorreo || '').trim();
  const vCelular = String(datos.vendedorCelular || '').trim();

  const filasArr = [
    numeroOc ? filaDato('📋', 'N° Orden de Compra', numeroOc) : '',
    numeroGuia ? filaDato('📄', 'N° Guía de Despacho', numeroGuia) : '',
    empresa ? filaDato('🚚', 'Empresa de despacho', empresa) : '',
    seguimiento ? filaDato('🔎', 'N° de seguimiento', seguimiento) : '',
  ].filter(Boolean);
  const filas = filasArr
    .map((f, i) =>
      i === filasArr.length - 1
        ? f.replace(new RegExp(`border-bottom:1px solid ${C.bordeTenue};`, 'g'), '')
        : f,
    )
    .join('');

  const contenido = `
    ${insignia('🚚')}
    ${titulo('¡Tu pedido está en camino!', 'Despachamos tu pedido. Adjuntamos la guía de despacho.')}
    <p style="margin:0 0 14px;">Estimado(a) <strong>${escapeHtml(cliente)}</strong>,</p>
    <p style="margin:0 0 20px;color:${C.suave};">
      Te informamos que tu pedido ya fue despachado. Encontrarás la guía de despacho
      adjunta a este correo y, a continuación, los datos para hacer el seguimiento del envío.
    </p>
    ${tarjetaDatos('Datos del despacho', filas)}
    ${etiquetaSeccion('Estado del pedido')}
    ${pasos(2)}
    ${nota('📎&nbsp;&nbsp;Adjuntamos la guía de despacho en PDF. Ante cualquier consulta sobre el envío, puedes responder directamente a este correo.')}
    ${firma(vendedor, vCorreo, vCelular)}`;

  return {
    // #2: el asunto es el N° de la OC.
    asunto: numeroOc || 'Guía de Despacho de tu pedido',
    html: envolver({
      preheader: `Tu pedido${numeroOc ? ` (OC N° ${numeroOc})` : ''} fue despachado. Revisa el seguimiento.`,
      contenido,
    }),
  };
}
