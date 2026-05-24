import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Etiquetas legibles para cada rol — se muestran en la firma si el usuario no
// definió uno libre en `firma_cargo`.
const ROL_LABELS: Record<string, string> = {
  admin: 'Administrador',
  jefe_ventas: 'Jefe de Ventas',
  jefe_ventas_especial: 'Jefe de Ventas Especial',
  ventas: 'Ejecutivo de Ventas',
  ventas_especial: 'Ejecutivo de Ventas Especial',
  contabilidad: 'Contabilidad',
};

type PerfilFirma = {
  id: string;
  email: string;
  nombre: string | null;
  rol: string | null;
  firma_html: string | null;
  firma_celular: string | null;
  firma_cargo: string | null;
};

@Injectable()
export class FirmasService {
  private readonly logger = new Logger(FirmasService.name);

  constructor(private supabase: SupabaseService) {}

  private async perfilDe(userId: string): Promise<PerfilFirma | null> {
    const id = String(userId || '').trim();
    if (!id) return null;
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, email, nombre, rol, firma_html, firma_celular, firma_cargo')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      this.logger.warn(`No se pudo leer perfil para firma: ${error.message}`);
      return null;
    }
    return (data as PerfilFirma) || null;
  }

  // Devuelve la firma efectiva (la del usuario o la por defecto).
  // También devuelve los campos editables para el modo simple.
  async getFirma(userId: string) {
    const p = await this.perfilDe(userId);
    if (!p) {
      throw new BadRequestException('No se pudo cargar tu perfil.');
    }
    const cargo = (p.firma_cargo || '').trim() || ROL_LABELS[p.rol || ''] || 'Equipo AMSODENT';
    const html = (p.firma_html || '').trim() || generarFirmaDefault({
      nombre: p.nombre || p.email,
      cargo,
      email: p.email,
      celular: p.firma_celular || '',
    });
    return {
      html,
      personalizada: Boolean((p.firma_html || '').trim()),
      campos: {
        nombre: p.nombre || '',
        cargo,
        email: p.email,
        celular: p.firma_celular || '',
      },
    };
  }

  // Devuelve el HTML de la firma directamente, listo para anexarla al correo.
  // Se usa al enviar correos: si el usuario tiene firma, se anexa a la HTML.
  async htmlParaEnviar(userId: string): Promise<string> {
    try {
      const r = await this.getFirma(userId);
      return r.html;
    } catch {
      return '';
    }
  }

  // Guarda HTML personalizado. Si llega vacío, se borra para volver al default.
  async setFirmaHtml(userId: string, html: string) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('Usuario no válido.');
    const limpio = sanitizarHtml(String(html || '').trim());
    const valor = limpio.length > 0 ? limpio : null;
    if (valor && valor.length > 20000) {
      throw new BadRequestException('La firma es demasiado larga.');
    }
    const { error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({ firma_html: valor })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.getFirma(id);
  }

  // Guarda los campos del modo simple: regenera el HTML con la plantilla.
  async setFirmaCampos(
    userId: string,
    body: { cargo?: string; celular?: string },
  ) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('Usuario no válido.');
    const cargo = String(body?.cargo || '').trim().slice(0, 120);
    const celular = String(body?.celular || '').trim().slice(0, 60);
    const { error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({
        firma_cargo: cargo || null,
        firma_celular: celular || null,
        firma_html: null, // borrar custom para usar plantilla actualizada
      })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.getFirma(id);
  }

  // Restablece la firma al default eliminando la personalizada.
  async resetFirma(userId: string) {
    const id = String(userId || '').trim();
    if (!id) throw new BadRequestException('Usuario no válido.');
    const { error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({ firma_html: null })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return this.getFirma(id);
  }
}

// ── Generador de la firma por defecto ──────────────────────────────────
// HTML usando <table> + estilos inline + logo corporativo real. Diseñada
// para máxima compatibilidad con Gmail, Outlook, Apple Mail, etc.
const LOGO_URL =
  'https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png';
const ACENTO = '#25b7bd'; // turquesa del logo
const ACENTO_OSC = '#178a8f';
const ACENTO_SUAVE = '#e7f8f8';

// Datos corporativos compartidos en la firma.
const EMPRESA = {
  nombre: 'AMSODENT MEDICAL',
  tagline: 'Insumos y equipamiento dental',
  direccion: 'Santiago, Chile',
  telefono: '+56 2 2854 0000',
  email: 'contacto@amsodentmedical.cl',
  web: 'amsodentmedical.cl',
  webUrl: 'https://amsodentmedical.cl',
  instagram: 'https://www.instagram.com/amsodentmedical',
};

// Iconos de redes como PNG en color real desde icons8 (CDN estable y rápido).
// El icono "web" usa el logo real de AMSODENT (no un globo genérico).
const ICONO_INSTAGRAM = 'https://img.icons8.com/color/48/instagram-new.png';
const ICONO_WHATSAPP = 'https://img.icons8.com/color/48/whatsapp.png';
const ICONO_WEB = LOGO_URL; // logo Amsodent en miniatura para "Ir al sitio web"

// Botón social como celda de tabla — garantiza alineación perfecta en todos
// los clientes de correo (mejor que inline-block).
// El icono "web" usa el logo Amsodent y necesita ajuste de tamaño/proporción
// porque es horizontal en vez de cuadrado.
function celdaRed(
  href: string,
  iconoUrl: string,
  alt: string,
  esLogo: boolean = false,
): string {
  const imgStyle = esLogo
    ? 'display:block;width:24px;height:auto;border:0;margin:11px auto;'
    : 'display:block;width:20px;height:20px;border:0;margin:7px auto;';
  return `<td style="padding:0 8px 0 0;vertical-align:middle;"><a class="amso-social" href="${href}" target="_blank" rel="noopener" style="display:inline-block;width:34px;height:34px;border-radius:10px;background:#ffffff;border:1px solid #e6ebef;text-decoration:none;box-shadow:0 1px 2px rgba(15,23,42,.04);"><img src="${iconoUrl}" alt="${alt}" style="${imgStyle}" /></a></td>`;
}

export function generarFirmaDefault(d: {
  nombre: string;
  cargo: string;
  email: string;
  celular: string;
}): string {
  const nombre = escapeHtml((d.nombre || '').trim()) || 'Equipo AMSODENT';
  const cargo = escapeHtml((d.cargo || '').trim()) || 'Equipo AMSODENT';
  const email = escapeHtml((d.email || '').trim());
  const celular = escapeHtml((d.celular || '').trim());
  const celularLimpio = celular.replace(/[^0-9+]/g, '');
  const waNumero = celularLimpio.replace(/^\+/, '');

  return `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  .amso-firma, .amso-firma * { font-family: 'Inter','SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif !important; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  .amso-firma { font-feature-settings: 'cv11','ss01','ss03'; }

  @keyframes amso-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes amso-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes amso-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes amso-logo-in { 0% { opacity: 0; transform: scale(.92) translateY(10px); filter: blur(5px); } 100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); } }
  @keyframes amso-shine { 0% { left: -70%; } 55% { left: 120%; } 100% { left: 120%; } }
  @keyframes amso-halo { 0%,100% { box-shadow: 0 8px 24px -8px rgba(37,183,189,.25), inset 0 0 0 1px rgba(37,183,189,.10); } 50% { box-shadow: 0 14px 36px -8px rgba(37,183,189,.45), inset 0 0 0 1px rgba(37,183,189,.20); } }

  .amso-bar { transform-origin: left center; animation: amso-bar .9s cubic-bezier(.2,.9,.2,1) both; animation-delay: .05s; }
  .amso-hero { border-radius: 16px; animation: amso-halo 4s ease-in-out infinite; }
  .amso-logo-wrap { position: relative; display: inline-block; overflow: hidden; border-radius: 8px; }
  .amso-logo { display: block; animation: amso-logo-in 1.2s cubic-bezier(.16,1,.3,1) both; animation-delay: .2s; filter: drop-shadow(0 8px 20px rgba(37,183,189,.30)); transition: transform .4s cubic-bezier(.2,.9,.2,1), filter .4s ease; }
  .amso-logo:hover { transform: scale(1.04); filter: drop-shadow(0 16px 36px rgba(37,183,189,.60)); }
  .amso-logo-wrap::after {
    content: '';
    position: absolute;
    top: 0; left: -70%;
    width: 50%; height: 100%;
    background: linear-gradient(110deg, transparent 0%, rgba(255,255,255,0) 20%, rgba(37,183,189,0.55) 50%, rgba(255,255,255,0) 80%, transparent 100%);
    animation: amso-shine 4.5s ease-in-out infinite;
    animation-delay: 1.6s;
    pointer-events: none;
  }

  .amso-rise { animation: amso-rise .7s cubic-bezier(.16,1,.3,1) both; }
  .amso-fade { animation: amso-fade .9s ease-out both; }
  .amso-d1 { animation-delay: .35s; }
  .amso-d2 { animation-delay: .50s; }
  .amso-d3 { animation-delay: .65s; }
  .amso-d4 { animation-delay: .80s; }
  .amso-d5 { animation-delay: .95s; }

  .amso-social { transition: transform .22s cubic-bezier(.2,.9,.2,1), box-shadow .22s ease, border-color .22s ease; }
  .amso-social:hover { transform: translateY(-3px); box-shadow: 0 8px 18px -4px rgba(15,23,42,.20) !important; border-color: ${ACENTO} !important; }
</style>
<table class="amso-firma" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;color:#111827;max-width:600px;">
  <tr>
    <td style="padding:0;">
      <!-- Cintillo turquesa superior con gradiente -->
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;">
        <tr>
          <td style="height:3px;line-height:3px;font-size:0;">
            <div class="amso-bar" style="height:3px;background:linear-gradient(90deg,${ACENTO_OSC} 0%,${ACENTO} 60%,${ACENTO_SUAVE} 100%);border-radius:2px;">&nbsp;</div>
          </td>
        </tr>
      </table>

      <!-- Bloque principal: logo (limpio, sin marco) + datos personales -->
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;padding-top:20px;">
        <tr>
          <!-- Columna izquierda: logo con entrada elegante + sheen sweep -->
          <td valign="middle" style="padding:18px 28px 0 4px;width:170px;">
            <span class="amso-logo-wrap">
              <img class="amso-logo" src="${LOGO_URL}" alt="Amsodent Medical" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
            </span>
          </td>

          <!-- Columna derecha: nombre, cargo y contacto -->
          <td valign="top" style="padding:4px 0 0 0;border-left:2px solid ${ACENTO_SUAVE};padding-left:22px;">
            <div class="amso-rise amso-d1" style="font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.028em;line-height:1.05;margin:0;">
              ${nombre}
            </div>
            <div class="amso-rise amso-d2" style="font-size:10.5px;font-weight:700;color:${ACENTO_OSC};text-transform:uppercase;letter-spacing:0.22em;line-height:1.2;margin:8px 0 0 0;">
              ${cargo}
            </div>
            <div class="amso-fade amso-d3" style="height:1px;background:linear-gradient(90deg,${ACENTO} 0%,${ACENTO_SUAVE} 50%,transparent 100%);margin:14px 0;line-height:1px;font-size:0;">&nbsp;</div>
            <table class="amso-rise amso-d3" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-size:13px;color:#374151;line-height:1.55;">
              ${email ? `
              <tr>
                <td style="padding:0 10px 5px 0;width:22px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:${ACENTO_SUAVE};text-align:center;line-height:22px;color:${ACENTO_OSC};font-size:12px;font-weight:700;">@</span>
                </td>
                <td style="padding:0 0 5px 0;vertical-align:middle;">
                  <a href="mailto:${email}" style="color:#374151;text-decoration:none;font-weight:600;">${email}</a>
                </td>
              </tr>` : ''}
              ${celular ? `
              <tr>
                <td style="padding:0 10px 5px 0;width:22px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:${ACENTO_SUAVE};text-align:center;line-height:22px;color:${ACENTO_OSC};font-size:12px;font-weight:700;">✆</span>
                </td>
                <td style="padding:0 0 5px 0;vertical-align:middle;">
                  <a href="tel:${celularLimpio}" style="color:#374151;text-decoration:none;font-weight:600;">${celular}</a>
                </td>
              </tr>` : ''}
              <tr>
                <td style="padding:0 10px 5px 0;width:22px;vertical-align:middle;">
                  <span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:${ACENTO_SUAVE};text-align:center;line-height:22px;color:${ACENTO_OSC};font-size:12px;font-weight:700;">⌂</span>
                </td>
                <td style="padding:0 0 5px 0;vertical-align:middle;">
                  <a href="${EMPRESA.webUrl}" style="color:#374151;text-decoration:none;font-weight:600;">${EMPRESA.web}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Bloque corporativo: dirección + teléfono fijo -->
      <table class="amso-rise amso-d4" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;margin-top:22px;">
        <tr>
          <td style="background:linear-gradient(135deg,#f7fafa 0%,${ACENTO_SUAVE} 100%);border-left:3px solid ${ACENTO};border-radius:0 12px 12px 0;padding:16px 20px;">
            <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;">
              <tr>
                <td valign="middle">
                  <div style="font-size:15px;font-weight:900;letter-spacing:0.04em;line-height:1.1;text-transform:uppercase;">
                    <span style="color:${ACENTO_OSC};font-weight:900;">AMSODENT</span><span style="color:#0f172a;font-weight:300;margin-left:7px;">MEDICAL</span>
                  </div>
                  <div style="font-size:9.5px;color:#9ca3af;font-weight:600;letter-spacing:0.22em;margin-top:6px;text-transform:uppercase;">
                    ${EMPRESA.tagline}
                  </div>
                </td>
                <td valign="middle" align="right" style="font-size:11.5px;color:#374151;line-height:1.65;">
                  <div style="color:#6b7280;font-weight:500;">
                    <span style="color:${ACENTO_OSC};font-weight:700;margin-right:3px;">📍</span>${EMPRESA.direccion}
                  </div>
                  <div style="color:#6b7280;margin-top:2px;font-weight:500;">
                    <span style="color:${ACENTO_OSC};font-weight:700;margin-right:3px;">☎</span>
                    <a href="tel:${EMPRESA.telefono.replace(/\s+/g, '')}" style="color:#374151;text-decoration:none;font-weight:600;">${EMPRESA.telefono}</a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Redes sociales con logos reales + footer legal -->
      <table class="amso-rise amso-d5" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;margin-top:18px;">
        <tr>
          <td valign="middle" style="white-space:nowrap;">
            <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;display:inline-table;vertical-align:middle;">
              <tr>
                <td style="padding-right:14px;vertical-align:middle;">
                  <span style="font-size:10px;color:#9ca3af;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;">Síguenos</span>
                </td>
                ${celdaRed(EMPRESA.instagram, ICONO_INSTAGRAM, 'Instagram')}
                ${waNumero ? celdaRed('https://wa.me/' + waNumero, ICONO_WHATSAPP, 'WhatsApp') : ''}
                ${celdaRed(EMPRESA.webUrl, ICONO_WEB, 'amsodentmedical.cl', true)}
              </tr>
            </table>
          </td>
          <td valign="middle" align="right" style="font-size:10px;color:#b6c2cf;font-style:italic;line-height:1.5;max-width:260px;font-weight:400;">
            Este correo y sus adjuntos son confidenciales.<br/>
            Si no eres el destinatario, por favor elimínalo.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

function obtenerIniciales(nombre: string): string {
  const partes = String(nombre || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return 'AM';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Quita scripts y event-handlers del HTML personalizado para no permitir XSS.
function sanitizarHtml(html: string): string {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, (m) => m) // permitimos style tags
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}
