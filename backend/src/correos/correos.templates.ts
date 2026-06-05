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

// URL de seguimiento según la empresa de despacho. Devuelve '' si no hay
// rastreo en línea (ej. despacho interno / otro).
function urlTracking(empresa: string, codigo: string): string {
  const cod = encodeURIComponent(String(codigo || '').trim());
  if (!cod) return '';
  const e = String(empresa || '').toLowerCase();
  if (e.includes('starken')) return `https://www.starken.cl/seguimiento?codigo=${cod}`;
  if (e.includes('blue')) return `https://www.blue.cl/seguimiento/?n_seguimiento=${cod}`;
  return '';
}

// Igual que filaDato, pero el valor es un enlace clickeable (para el N° de
// seguimiento que redirige al tracking del courier). Si no hay href, cae a
// texto plano.
function filaDatoLink(
  icono: string,
  etiqueta: string,
  valor: string,
  href: string,
  ultima = false,
): string {
  const borde = ultima ? '' : `border-bottom:1px solid ${C.bordeTenue};`;
  const valorHtml = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="color:${C.acentoOsc};font-weight:700;text-decoration:underline;">${escapeHtml(valor)}</a>`
    : escapeHtml(valor);
  return `<tr>
    <td style="padding:12px 0;${borde}width:28px;font-size:16px;vertical-align:middle;">${icono}</td>
    <td style="padding:12px 0;${borde}color:${C.suave};font-size:12px;text-transform:uppercase;letter-spacing:.5px;vertical-align:middle;width:44%;">${escapeHtml(etiqueta)}</td>
    <td style="padding:12px 0;${borde}font-size:15px;font-weight:700;text-align:right;vertical-align:middle;">${valorHtml}</td>
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
      Queremos agradecer por confiar en <strong style="color:${C.texto};">Amsodent Medical</strong>.
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

export type ItemAlertaStock = {
  nombre: string;
  unidad?: string | null;
  stock_actual: number;
  stock_minimo: number;
  semaforo: 'verde' | 'amarillo' | 'rojo';
};

export type DatosAlertaStock = {
  razonSocial: string;
  rutFmt: string;
  totales: { rojos: number; amarillos: number; verdes: number };
  items: ItemAlertaStock[];
  enlace?: string; // URL opcional al monitoreo (admin)
};

// Plantilla para alertar a un usuario interno de Amsodent cuando un cliente
// declara stock con productos en amarillo/rojo. Mantiene el mismo lenguaje
// visual que las otras plantillas (header con logo, línea turquesa, footer).
export function plantillaAlertaStock(datos: DatosAlertaStock): PlantillaResultado {
  const esCritico = datos.totales.rojos > 0;
  const razonSocial = String(datos.razonSocial || '').trim() || datos.rutFmt;
  const totalAlertas = datos.totales.rojos + datos.totales.amarillos;

  // Solo mostramos los productos con alerta (no inundar con verdes).
  const itemsAlerta = datos.items.filter(
    (it) => it.semaforo === 'rojo' || it.semaforo === 'amarillo',
  );

  const filasProductos = itemsAlerta
    .map((it) => {
      const cfg =
        it.semaforo === 'rojo'
          ? { color: '#b91c1c', bg: '#fee2e2', label: 'Crítico' }
          : { color: '#b45309', bg: '#fef3c7', label: 'Bajo' };
      const unidad = it.unidad ? ` · ${escapeHtml(String(it.unidad))}` : '';
      return `<tr>
        <td style="padding:11px 14px;border-bottom:1px solid ${C.bordeTenue};font-size:13px;color:${C.titulo};">
          <strong>${escapeHtml(it.nombre)}</strong>
          <span style="color:${C.tenue};font-size:11px;">${unidad}</span>
        </td>
        <td style="padding:11px 14px;border-bottom:1px solid ${C.bordeTenue};text-align:right;font-size:13px;color:${C.titulo};font-weight:700;">
          ${escapeHtml(String(it.stock_actual))}
        </td>
        <td style="padding:11px 14px;border-bottom:1px solid ${C.bordeTenue};text-align:right;font-size:12px;color:${C.tenue};">
          mín. ${escapeHtml(String(it.stock_minimo))}
        </td>
        <td style="padding:11px 14px;border-bottom:1px solid ${C.bordeTenue};text-align:center;">
          <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${cfg.bg};color:${cfg.color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">${cfg.label}</span>
        </td>
      </tr>`;
    })
    .join('');

  // KPIs en tres pastillas (Crítico / Bajo / OK)
  const pillCritico = `
    <td width="33%" align="center" style="padding:0 6px;">
      <table cellpadding="0" cellspacing="0" align="center" style="width:100%;">
        <tr><td align="center" style="padding:16px 12px;background:#fee2e2;border-radius:12px;">
          <div style="font-size:26px;font-weight:800;color:#b91c1c;line-height:1;">${datos.totales.rojos}</div>
          <div style="font-size:10px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.7px;margin-top:6px;">Crítico</div>
        </td></tr>
      </table>
    </td>`;
  const pillBajo = `
    <td width="33%" align="center" style="padding:0 6px;">
      <table cellpadding="0" cellspacing="0" align="center" style="width:100%;">
        <tr><td align="center" style="padding:16px 12px;background:#fef3c7;border-radius:12px;">
          <div style="font-size:26px;font-weight:800;color:#b45309;line-height:1;">${datos.totales.amarillos}</div>
          <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.7px;margin-top:6px;">Bajo</div>
        </td></tr>
      </table>
    </td>`;
  const pillOk = `
    <td width="33%" align="center" style="padding:0 6px;">
      <table cellpadding="0" cellspacing="0" align="center" style="width:100%;">
        <tr><td align="center" style="padding:16px 12px;background:#dcfce7;border-radius:12px;">
          <div style="font-size:26px;font-weight:800;color:#15803d;line-height:1;">${datos.totales.verdes}</div>
          <div style="font-size:10px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.7px;margin-top:6px;">OK</div>
        </td></tr>
      </table>
    </td>`;

  const filasCliente = [
    filaDato('🏢', 'Cliente', razonSocial),
    filaDato('🪪', 'RUT', datos.rutFmt),
    filaDato('📅', 'Recibida', fechaLarga(), true),
  ].join('');

  const cta = datos.enlace
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 22px;">
        <tr><td align="center" style="border-radius:10px;background:${C.acento};">
          <a href="${escapeHtml(datos.enlace)}" target="_blank" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:.2px;">
            Abrir monitoreo de stock →
          </a>
        </td></tr>
      </table>`
    : '';

  const tituloTxt = esCritico ? 'Cliente con stock crítico' : 'Cliente con stock bajo';
  const subtitulo = esCritico
    ? `${razonSocial} reportó productos en nivel crítico que requieren reposición.`
    : `${razonSocial} reportó productos cercanos al mínimo.`;

  const insigniaAlerta = `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;">
    <tr>
      <td width="64" height="64" align="center" valign="middle"
          style="width:64px;height:64px;background:${esCritico ? '#fee2e2' : '#fef3c7'};border-radius:50%;font-size:30px;line-height:64px;text-align:center;">
        ${esCritico ? '🚨' : '⚠️'}
      </td>
    </tr>
  </table>`;

  const contenido = `
    ${insigniaAlerta}
    ${titulo(tituloTxt, subtitulo)}
    ${tarjetaDatos('Datos del cliente', filasCliente)}
    ${etiquetaSeccion('Resumen del semáforo')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr>${pillCritico}${pillBajo}${pillOk}</tr>
    </table>
    ${
      itemsAlerta.length > 0
        ? `${etiquetaSeccion('Productos en alerta')}
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;background:#ffffff;border:1px solid ${C.borde};border-radius:12px;overflow:hidden;">
             <thead>
               <tr style="background:${C.panel};">
                 <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:${C.suave};text-transform:uppercase;letter-spacing:.5px;">Producto</th>
                 <th style="text-align:right;padding:10px 14px;font-size:11px;font-weight:700;color:${C.suave};text-transform:uppercase;letter-spacing:.5px;">Stock</th>
                 <th style="text-align:right;padding:10px 14px;font-size:11px;font-weight:700;color:${C.suave};text-transform:uppercase;letter-spacing:.5px;">Mínimo</th>
                 <th style="text-align:center;padding:10px 14px;font-size:11px;font-weight:700;color:${C.suave};text-transform:uppercase;letter-spacing:.5px;">Estado</th>
               </tr>
             </thead>
             <tbody>${filasProductos}</tbody>
           </table>`
        : ''
    }
    ${cta}
    ${nota('🔔&nbsp;&nbsp;Esta alerta fue generada automáticamente cuando el cliente actualizó su gestión de stock desde el portal. Si necesitas reconfigurar quién recibe estas alertas, hazlo desde el monitoreo.')}
  `;

  const preheader = esCritico
    ? `${razonSocial} reportó ${datos.totales.rojos} producto(s) en estado crítico.`
    : `${razonSocial} reportó ${totalAlertas} producto(s) que requieren atención.`;

  return {
    asunto: esCritico
      ? `[Stock crítico] ${razonSocial}`
      : `[Stock bajo] ${razonSocial}`,
    html: envolver({ preheader, contenido }),
  };
}

export type ItemSolicitudCotizacion = {
  nombre: string;
  unidad?: string | null;
  cantidad: number;
};

export type DatosSolicitudCotizacion = {
  razonSocial: string;
  rutFmt: string;
  contactoNombre?: string;
  contactoEmail?: string;
  contactoTelefono?: string;
  nota?: string;
  items: ItemSolicitudCotizacion[];
  enlace?: string;
};

// Plantilla para una solicitud de cotización enviada por un cliente desde
// el portal de stock. Llega al equipo comercial con el detalle del pedido.
export function plantillaSolicitudCotizacion(
  datos: DatosSolicitudCotizacion,
): PlantillaResultado {
  const razonSocial = String(datos.razonSocial || '').trim() || datos.rutFmt;
  const items = Array.isArray(datos.items) ? datos.items : [];

  const filasProductos = items
    .map((it) => {
      const unidad = it.unidad ? ` · ${escapeHtml(String(it.unidad))}` : '';
      return `<tr>
        <td style="padding:11px 14px;border-bottom:1px solid ${C.bordeTenue};font-size:13px;color:${C.titulo};">
          <strong>${escapeHtml(it.nombre)}</strong>
          <span style="color:${C.tenue};font-size:11px;">${unidad}</span>
        </td>
        <td style="padding:11px 14px;border-bottom:1px solid ${C.bordeTenue};text-align:right;font-size:14px;color:${C.titulo};font-weight:800;">
          ${escapeHtml(String(it.cantidad))}
        </td>
      </tr>`;
    })
    .join('');

  const filasCliente = [
    filaDato('🏢', 'Cliente', razonSocial),
    filaDato('🪪', 'RUT', datos.rutFmt),
    datos.contactoNombre
      ? filaDato('🙋', 'Solicita', datos.contactoNombre)
      : '',
    datos.contactoEmail
      ? filaDato('✉️', 'Correo', datos.contactoEmail)
      : '',
    datos.contactoTelefono
      ? filaDato('📞', 'Teléfono', datos.contactoTelefono)
      : '',
    filaDato('📅', 'Fecha', fechaLarga(), true),
  ]
    .filter(Boolean)
    .join('');

  const notaHtml = datos.nota
    ? nota(`💬&nbsp;&nbsp;<strong>Comentario del cliente:</strong><br/>${escapeHtml(datos.nota)}`)
    : '';

  const cta = datos.enlace
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 22px;">
        <tr><td align="center" style="border-radius:10px;background:${C.acento};">
          <a href="${escapeHtml(datos.enlace)}" target="_blank" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:.2px;">
            Abrir en monitoreo →
          </a>
        </td></tr>
      </table>`
    : '';

  const totalProductos = items.length;
  const subtitulo = `${razonSocial} solicita cotización por ${totalProductos} producto${totalProductos === 1 ? '' : 's'}.`;

  const insigniaSolicitud = `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 20px;">
    <tr>
      <td width="64" height="64" align="center" valign="middle"
          style="width:64px;height:64px;background:${C.acentoSuave};border-radius:50%;font-size:30px;line-height:64px;text-align:center;">
        🧾
      </td>
    </tr>
  </table>`;

  const contenido = `
    ${insigniaSolicitud}
    ${titulo('Nueva solicitud de cotización', subtitulo)}
    ${tarjetaDatos('Datos del cliente', filasCliente)}
    ${etiquetaSeccion('Productos solicitados')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;background:#ffffff;border:1px solid ${C.borde};border-radius:12px;overflow:hidden;">
      <thead>
        <tr style="background:${C.panel};">
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:${C.suave};text-transform:uppercase;letter-spacing:.5px;">Producto</th>
          <th style="text-align:right;padding:10px 14px;font-size:11px;font-weight:700;color:${C.suave};text-transform:uppercase;letter-spacing:.5px;">Cantidad</th>
        </tr>
      </thead>
      <tbody>${filasProductos}</tbody>
    </table>
    ${notaHtml}
    ${cta}
  `;

  return {
    asunto: `Solicitud de cotización · ${razonSocial}`,
    html: envolver({
      preheader: `${razonSocial} solicita cotización por ${totalProductos} producto${totalProductos === 1 ? '' : 's'}.`,
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

  const trackingUrl = urlTracking(empresa, seguimiento);
  const filasArr = [
    numeroOc ? filaDato('📋', 'N° Orden de Compra', numeroOc) : '',
    numeroGuia ? filaDato('📄', 'N° Guía de Despacho', numeroGuia) : '',
    empresa ? filaDato('🚚', 'Empresa de despacho', empresa) : '',
    seguimiento ? filaDatoLink('🔎', 'N° de seguimiento', seguimiento, trackingUrl) : '',
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
    ${nota(
      trackingUrl
        ? '🔎&nbsp;&nbsp;Haz clic en el N° de seguimiento para ver el estado de tu envío en línea. Adjuntamos además la guía de despacho en PDF y puedes responder a este correo ante cualquier consulta.'
        : '📎&nbsp;&nbsp;Adjuntamos la guía de despacho en PDF. Ante cualquier consulta sobre el envío, puedes responder directamente a este correo.',
    )}
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

// Botón principal (CTA) turquesa centrado.
function botonCta(texto: string, href: string): string {
  if (!href) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 24px;">
    <tr><td align="center" style="border-radius:10px;background:${C.acento};">
      <a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:.2px;">
        ${escapeHtml(texto)} →
      </a>
    </td></tr>
  </table>`;
}

// Lista numerada de pasos (paso a paso de acceso).
function listaPasos(items: string[]): string {
  const filas = items
    .map(
      (txt, i) => `<tr>
        <td valign="top" style="width:30px;padding:7px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="24" height="24" align="center" valign="middle"
                style="width:24px;height:24px;background:${C.acentoSuave};color:${C.acentoOsc};border-radius:50%;font-size:12px;font-weight:800;line-height:24px;text-align:center;">${i + 1}</td>
          </tr></table>
        </td>
        <td valign="middle" style="padding:7px 0 7px 12px;color:${C.texto};font-size:14px;line-height:1.55;">${txt}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;">${filas}</table>`;
}

export type DatosBienvenidaPortal = {
  razonSocial: string;
  rutFmt: string;
  passwordTemporal: string;
  // Texto legible del período: "1 mes", "3 meses", "Acceso indefinido".
  vigenciaTexto: string;
  // Fecha de expiración legible (vacío si es indefinido).
  expiraTexto?: string;
  urlPortal: string;
};

// Correo de bienvenida cuando el admin habilita el acceso al Portal del
// Cliente (stock). Entrega la clave temporal, el período de acceso y el
// paso a paso para ingresar.
export function plantillaBienvenidaPortal(
  datos: DatosBienvenidaPortal,
): PlantillaResultado {
  const razonSocial = String(datos.razonSocial || '').trim() || datos.rutFmt;
  const clave = String(datos.passwordTemporal || '').trim();
  const url = String(datos.urlPortal || '').trim();

  const filasAcceso = [
    filaDato('🪪', 'RUT de acceso', datos.rutFmt),
    filaDato('🔑', 'Clave temporal', clave),
    filaDato('🗓️', 'Vigencia del acceso', datos.vigenciaTexto),
    datos.expiraTexto
      ? filaDato('⏳', 'Acceso válido hasta', datos.expiraTexto, true)
      : filaDato('♾️', 'Sin fecha de término', 'Acceso indefinido', true),
  ]
    .filter(Boolean)
    .join('');

  const pasosAcceso = [
    `Ingrese al portal desde el botón de abajo${url ? '' : ' (le compartiremos el enlace)'}.`,
    `Escriba su <strong>RUT</strong> y la <strong>clave temporal</strong> indicada en este correo.`,
    `Por seguridad, el sistema le pedirá <strong>cambiar la clave</strong> en su primer ingreso.`,
    `Acepte el acuerdo de confidencialidad y comience a declarar su stock y a solicitar cotizaciones.`,
  ];

  const contenido = `
    ${insignia('👋')}
    ${titulo('Bienvenido al Portal del Cliente', 'Ya tiene acceso para gestionar su stock con Amsodent.')}
    <p style="margin:0 0 14px;">Estimado(a) <strong>${escapeHtml(razonSocial)}</strong>,</p>
    <p style="margin:0 0 20px;color:${C.suave};">
      Habilitamos su acceso al <strong style="color:${C.texto};">Portal del Cliente</strong> de
      Amsodent Medical. Desde ahí podrá declarar el stock de su empresa, recibir alertas
      cuando un producto se acerque al mínimo y solicitar cotizaciones de reposición.
    </p>
    ${tarjetaDatos('Sus datos de acceso', filasAcceso)}
    ${botonCta('Ingresar al portal', url)}
    ${etiquetaSeccion('Cómo acceder, paso a paso')}
    ${listaPasos(pasosAcceso)}
    ${nota('🔒&nbsp;&nbsp;Por su seguridad, no comparta esta clave. Si no solicitó este acceso o necesita ayuda, responda a este correo y le asistiremos.')}
  `;

  return {
    asunto: 'Acceso habilitado · Portal del Cliente Amsodent',
    html: envolver({
      preheader: `Su acceso al Portal del Cliente está habilitado (${datos.vigenciaTexto}). Clave temporal incluida.`,
      contenido,
    }),
  };
}

export type DatosBienvenidaChofer = {
  nombre: string;
  rutFmt: string;
  passwordTemporal: string;
  // Texto legible del período: "1 mes", "3 meses", "Acceso indefinido".
  vigenciaTexto: string;
  // Fecha de expiración legible (vacío si es indefinido).
  expiraTexto?: string;
  urlPortal: string;
};

// Correo de bienvenida cuando el admin habilita el acceso del chofer al Portal
// de Despachos. Entrega la clave temporal, el período y el paso a paso (incluye
// activar la ubicación para el tracking en ruta).
export function plantillaBienvenidaChofer(
  datos: DatosBienvenidaChofer,
): PlantillaResultado {
  const nombre = String(datos.nombre || '').trim() || datos.rutFmt;
  const clave = String(datos.passwordTemporal || '').trim();
  const url = String(datos.urlPortal || '').trim();

  const filasAcceso = [
    filaDato('🪪', 'RUT de acceso', datos.rutFmt),
    filaDato('🔑', 'Clave temporal', clave),
    filaDato('🗓️', 'Vigencia del acceso', datos.vigenciaTexto),
    datos.expiraTexto
      ? filaDato('⏳', 'Acceso válido hasta', datos.expiraTexto, true)
      : filaDato('♾️', 'Sin fecha de término', 'Acceso indefinido', true),
  ]
    .filter(Boolean)
    .join('');

  const pasosAcceso = [
    `Ingresa al portal desde el botón de abajo${url ? '' : ' (te compartiremos el enlace)'}.`,
    `Escribe tu <strong>RUT</strong> y la <strong>clave temporal</strong> indicada en este correo.`,
    `Por seguridad, el sistema te pedirá <strong>cambiar la clave</strong> en tu primer ingreso.`,
    `Acepta el permiso de <strong>ubicación</strong> para que podamos seguir tus despachos mientras estás en ruta.`,
  ];

  const contenido = `
    ${insignia('🚚')}
    ${titulo('Bienvenido al Portal de Despachos', 'Revisa tus viajes asignados y comparte tu ubicación en ruta.')}
    <p style="margin:0 0 14px;">Hola <strong>${escapeHtml(nombre)}</strong>,</p>
    <p style="margin:0 0 20px;color:${C.suave};">
      Habilitamos tu acceso al <strong style="color:${C.texto};">Portal de Despachos</strong> de
      Amsodent Medical. Desde ahí podrás ver los despachos y viajes que tienes asignados,
      actualizar su estado (en ruta, entregado) y reportar tu ubicación en tiempo real.
    </p>
    ${tarjetaDatos('Tus datos de acceso', filasAcceso)}
    ${botonCta('Ingresar al portal', url)}
    ${etiquetaSeccion('Cómo ingresar, paso a paso')}
    ${listaPasos(pasosAcceso)}
    ${nota('🔒&nbsp;&nbsp;Por tu seguridad, no compartas esta clave. Si no solicitaste este acceso o necesitas ayuda, responde a este correo y te asistiremos.')}
  `;

  return {
    asunto: 'Acceso habilitado · Portal de Despachos Amsodent',
    html: envolver({
      preheader: `Tu acceso al Portal de Despachos está habilitado (${datos.vigenciaTexto}). Clave temporal incluida.`,
      contenido,
    }),
  };
}
