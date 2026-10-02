import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';

// Scheduler liviano (setInterval, sin dependencias extra) que genera
// recordatorios de cotización: cierre próximo (3 h / 1 h antes) y resultados
// publicados (1 día después). Crea una notificación (popup en la app) y envía
// un correo al vendedor. Marca columnas para no repetir. También lleva el
// calendario de avisos del plazo de factoring (ver recordatoriosFactoring).
@Injectable()
export class RecordatoriosService implements OnModuleInit {
  private readonly logger = new Logger('Recordatorios');
  private corriendo = false;
  private readonly INTERVALO_MS = 5 * 60 * 1000; // cada 5 minutos

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
  ) {}

  onModuleInit() {
    // Primera pasada a los 30 s del arranque y luego cada 5 min.
    setTimeout(() => this.ejecutar().catch(() => {}), 30 * 1000);
    setInterval(() => this.ejecutar().catch(() => {}), this.INTERVALO_MS);
  }

  private async ejecutar() {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.recordatoriosCierre();
      await this.recordatoriosResultados();
      await this.recordatoriosFactoring();
    } catch (e: any) {
      this.logger.warn(`fallo en recordatorios: ${e?.message || e}`);
    } finally {
      this.corriendo = false;
    }
  }

  private destinatario(lic: any): string {
    return String(lic?.vendedor_correo || lic?.creado_por || '').trim().toLowerCase();
  }

  private async crearNotificacion(args: {
    email: string;
    tipo: string;
    mensaje: string;
    licitacionId: number;
    link?: string;
    metadata?: Record<string, any>;
  }): Promise<boolean> {
    const { error } = await this.supabase.getClient().from('notificaciones').insert([
      {
        user_email: args.email,
        tipo: args.tipo,
        mensaje: args.mensaje,
        link: args.link || `/detalle/${args.licitacionId}`,
        metadata: { licitacion_id: args.licitacionId, ...(args.metadata || {}) },
      },
    ]);
    if (error) this.logger.warn(`no se pudo notificar a ${args.email}: ${error.message}`);
    return !error;
  }

  private async enviarCorreo(email: string, asunto: string, html: string) {
    try {
      await this.mailings.enviarUno({ para: email, asunto, cuerpoHtml: html });
    } catch (e: any) {
      this.logger.warn(`no se pudo enviar correo a ${email}: ${e?.message || e}`);
    }
  }

  // ── Cierre próximo (3 h y 1 h antes de fecha_hora_cierre) ───────────────
  // Solo aplica a LICITACIONES (no a compras ágiles/directas ni particulares):
  // son las únicas con fecha y hora de cierre real de postulación.
  private static readonly TIPOS_LICITACION = [
    'Licitación 0 a 8 meses',
    'Licitación 9 a 24 meses',
  ];

  private async recordatoriosCierre() {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitaciones')
      .select(
        'id, nombre, nombre_entidad, creado_por, vendedor_correo, fecha_hora_cierre, recordatorio_cierre_3h_at, recordatorio_cierre_1h_at',
      )
      .in('estado', ['En espera', 'Pendiente Aprobación'])
      .in('tipo_compra', RecordatoriosService.TIPOS_LICITACION)
      .eq('postulada', false)
      .not('fecha_hora_cierre', 'is', null);
    if (error) {
      this.logger.warn(`cierre: ${error.message}`);
      return;
    }

    const ahora = Date.now();
    for (const lic of data || []) {
      const cierre = new Date(lic.fecha_hora_cierre).getTime();
      if (Number.isNaN(cierre) || cierre <= ahora) continue; // ya cerró
      const horas = (cierre - ahora) / 3_600_000;
      const email = this.destinatario(lic);
      if (!email) continue;
      const nombreCot = lic.nombre || lic.nombre_entidad || `#${lic.id}`;

      // Ventana de 1 h (tiene prioridad sobre la de 3 h si ambas aplican).
      if (horas <= 1 && !lic.recordatorio_cierre_1h_at) {
        await this.crearNotificacion({
          email,
          tipo: 'cierre_proximo',
          mensaje: `La cotización "${nombreCot}" cierra en menos de 1 hora. ¿Ya realizaste la postulación?`,
          licitacionId: lic.id,
          metadata: { ventana: '1h' },
        });
        await this.enviarCorreo(
          email,
          `⏰ Cierra en 1 hora: ${nombreCot}`,
          `<p>La cotización <strong>${nombreCot}</strong> cierra en menos de <strong>1 hora</strong>.</p><p>Recuerda realizar la postulación antes del cierre.</p>`,
        );
        await client.from('licitaciones').update({ recordatorio_cierre_1h_at: new Date().toISOString() }).eq('id', lic.id);
        continue;
      }

      // Ventana de 3 h.
      if (horas <= 3 && !lic.recordatorio_cierre_3h_at) {
        await this.crearNotificacion({
          email,
          tipo: 'cierre_proximo',
          mensaje: `La cotización "${nombreCot}" cierra en aproximadamente 3 horas. ¿Ya realizaste la postulación?`,
          licitacionId: lic.id,
          metadata: { ventana: '3h' },
        });
        await this.enviarCorreo(
          email,
          `⏰ Cierra en ~3 horas: ${nombreCot}`,
          `<p>La cotización <strong>${nombreCot}</strong> cierra en aproximadamente <strong>3 horas</strong>.</p><p>Recuerda realizar la postulación antes del cierre.</p>`,
        );
        await client.from('licitaciones').update({ recordatorio_cierre_3h_at: new Date().toISOString() }).eq('id', lic.id);
      }
    }
  }

  // ── Resultados publicados (1 día después de fecha_publicacion_resultados) ─
  private async recordatoriosResultados() {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitaciones')
      .select('id, nombre, nombre_entidad, creado_por, vendedor_correo, fecha_publicacion_resultados, recordatorio_resultados_at')
      .not('fecha_publicacion_resultados', 'is', null)
      .is('recordatorio_resultados_at', null);
    if (error) {
      this.logger.warn(`resultados: ${error.message}`);
      return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    for (const lic of data || []) {
      const fp = new Date(`${String(lic.fecha_publicacion_resultados).slice(0, 10)}T00:00:00`);
      if (Number.isNaN(fp.getTime())) continue;
      const diasDesde = Math.floor((hoy.getTime() - fp.getTime()) / 86_400_000);
      if (diasDesde < 1) continue; // aún no pasa 1 día
      const email = this.destinatario(lic);
      if (!email) continue;
      const nombreCot = lic.nombre || lic.nombre_entidad || `#${lic.id}`;

      await this.crearNotificacion({
        email,
        tipo: 'resultados_publicados',
        mensaje: `Ya pasó un día desde la fecha de publicación de resultados de "${nombreCot}". Revisa si fue adjudicada.`,
        licitacionId: lic.id,
      });
      await this.enviarCorreo(
        email,
        `📣 Revisa resultados: ${nombreCot}`,
        `<p>La cotización <strong>${nombreCot}</strong> tenía publicación de resultados hace al menos un día.</p><p>Revisa el portal y actualiza el estado de la cotización.</p>`,
      );
      await client.from('licitaciones').update({ recordatorio_resultados_at: new Date().toISOString() }).eq('id', lic.id);
    }
  }

  // ── Plazo de factoring: avisos antes y después del vencimiento ───────────
  // Calendario de avisos (campana + correo a contabilidad/jefatura) sobre
  // factoring_vencimiento, en días corridos: 7 y 3 días antes, el mismo día, y
  // 1, 7 y 15 días después. Va de la mano del semáforo del módulo Factoring:
  // el primer aviso sale cuando la factura pasa a amarillo y el de "+1" cuando
  // pasa a rojo.
  //
  // Cada (destinatario, factura, hito, vencimiento) se avisa UNA sola vez: el
  // dedupe se lee de las notificaciones ya creadas, así que no necesita
  // columnas propias (factoring_recordatorio_at quedó sin uso). Se gatilla el
  // hito MÁS AVANZADO alcanzado (>=, no igualdad): si el backend estuvo caído
  // o el plazo se cargó tarde, sale un solo aviso con el estado actual. Si se
  // corrige la fecha de vencimiento, el calendario parte de nuevo.
  private static readonly FACTORING_AVISO = [
    'jer.consorcio@gmail.com',
    'benja.alarcon.z@gmail.com',
  ];

  // Los avisos salen desde esta hora de Chile (el día se cuenta en hora de
  // Chile, no del servidor): nada de correos de madrugada.
  private static readonly FACTORING_HORA_DESDE = 8;

  private static readonly FACTORING_TIPOS = ['factoring_por_vencer', 'factoring_vencido'];

  private ahoraEnChile() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const v = (t: string) => partes.find((p) => p.type === t)?.value || '';
    return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')) % 24 };
  }

  /** Claves `email|documento|hito|vencimiento` ya avisadas. null = no se pudo leer. */
  private async factoringYaAvisados(): Promise<Set<string> | null> {
    const client = this.supabase.getClient();
    const ya = new Set<string>();
    for (let p = 0; ; p++) {
      const { data, error } = await client
        .from('notificaciones')
        .select('user_email, metadata')
        .in('tipo', RecordatoriosService.FACTORING_TIPOS)
        .order('id', { ascending: true })
        .range(p * 1000, p * 1000 + 999);
      if (error) {
        this.logger.warn(`factoring (avisos previos): ${error.message}`);
        return null;
      }
      for (const n of (data || []) as any[]) {
        const m = n?.metadata || {};
        if (m.documento_id == null || !m.hito) continue;
        ya.add(claveFactoring(n.user_email, m.documento_id, m.hito, m.vencimiento));
      }
      if ((data || []).length < 1000) break;
    }
    return ya;
  }

  private async recordatoriosFactoring() {
    // FACTORING_AVISOS=off lo apaga (backend local: apunta a la misma base de
    // producción y duplicaría los avisos de Railway).
    if (String(process.env.FACTORING_AVISOS || '').toLowerCase() === 'off') return;
    const { fecha: hoy, hora } = this.ahoraEnChile();
    if (hora < RecordatoriosService.FACTORING_HORA_DESDE) return;

    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitacion_documentos')
      .select('id, licitacion_id, numero, monto, factoring_empresa, factoring_vencimiento')
      .in('tipo', ['factura', 'factura_boleta'])
      .eq('forma_pago', 'factoring')
      .not('factoring_vencimiento', 'is', null);
    if (error) {
      this.logger.warn(`factoring: ${error.message}`);
      return;
    }

    // 1) Hito alcanzado por cada factura (el más avanzado).
    const alcanzados: AvisoFactoring[] = [];
    for (const doc of (data || []) as any[]) {
      const venc = String(doc.factoring_vencimiento).slice(0, 10);
      const atraso = diasEntre(venc, hoy);
      if (atraso == null) continue;
      const hito = hitoFactoring(atraso);
      if (hito) alcanzados.push({ doc, venc, atraso, hito, lic: null });
    }
    if (!alcanzados.length) return;

    // 2) Solo cotizaciones adjudicadas: las mismas que muestra el módulo.
    const licIds = [...new Set(alcanzados.map((a) => a.doc.licitacion_id).filter(Boolean))];
    const { data: lics, error: errLics } = await client
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, total_con_iva, estado')
      .in('id', licIds);
    if (errLics) {
      this.logger.warn(`factoring (cotizaciones): ${errLics.message}`);
      return;
    }
    const licMap = new Map<number, any>((lics || []).map((l: any) => [Number(l.id), l]));
    const vigentes = alcanzados.filter((a) => {
      a.lic = licMap.get(Number(a.doc.licitacion_id)) || null;
      return a.lic?.estado === 'Adjudicada';
    });
    if (!vigentes.length) return;

    // 3) Dedupe. Sin poder leer lo ya avisado no se envía nada: mejor perder
    //    una pasada que repetir el correo cada 5 minutos.
    const ya = await this.factoringYaAvisados();
    if (!ya) return;

    for (const email of RecordatoriosService.FACTORING_AVISO) {
      const nuevos = vigentes.filter(
        (a) => !ya.has(claveFactoring(email, a.doc.id, a.hito.key, a.venc)),
      );
      if (!nuevos.length) continue;

      // La notificación es el registro del aviso: el correo solo lleva las
      // facturas cuya notificación quedó guardada.
      const avisados: AvisoFactoring[] = [];
      for (const a of nuevos) {
        const ok = await this.crearNotificacion({
          email,
          tipo: a.atraso > 0 ? 'factoring_vencido' : 'factoring_por_vencer',
          mensaje:
            `Factoring de la factura N° ${a.doc.numero || 'S/N'} (${entidadFactoring(a)}) ` +
            `${cuandoFactoring(a.atraso)} — vencimiento ${fmtDiaCL(a.venc)}` +
            (a.doc.factoring_empresa ? ` · ${a.doc.factoring_empresa}` : '') +
            ` · ${fmtCLP(montoFactoring(a))} con IVA.`,
          licitacionId: a.doc.licitacion_id,
          link: '/factoring',
          metadata: {
            documento_id: a.doc.id,
            hito: a.hito.key,
            vencimiento: a.venc,
            semaforo: a.atraso > 0 ? 'rojo' : 'amarillo',
          },
        });
        if (ok) avisados.push(a);
      }
      if (!avisados.length) continue;

      const { asunto, html } = correoFactoring(avisados);
      await this.enviarCorreo(email, asunto, html);
      this.logger.log(`factoring: ${avisados.length} aviso(s) de plazo a ${email}.`);
    }
  }
}

/* ── Calendario de avisos del plazo de factoring (funciones puras) ───────── */

// Umbral del semáforo. MISMA regla que el módulo (src/pages/Factoring.jsx →
// DIAS_AMARILLO): verde = faltan más de 7 días; amarillo = 7 o menos (incluye
// el día del vencimiento); rojo = vencido. Si cambia aquí, cambia allá.
export const FACTORING_DIAS_AMARILLO = 7;

// off = días corridos respecto del vencimiento (negativo = antes). El orden
// importa: se gatilla el hito más avanzado alcanzado.
export const HITOS_FACTORING: Array<{ key: string; off: number }> = [
  { key: 'pre7', off: -FACTORING_DIAS_AMARILLO },
  { key: 'pre3', off: -3 },
  { key: 'venc', off: 0 },
  { key: 'post1', off: 1 },
  { key: 'post7', off: 7 },
  { key: 'post15', off: 15 },
];

type AvisoFactoring = {
  doc: any;
  lic: any;
  venc: string;
  atraso: number;
  hito: (typeof HITOS_FACTORING)[number];
};

/** Días corridos de `desde` a `hasta` (ambas YYYY-MM-DD); null si alguna no es fecha. */
export function diasEntre(desde: string, hasta: string): number | null {
  const utc = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  const dif = (utc(hasta) - utc(desde)) / 86_400_000;
  return Number.isFinite(dif) ? Math.round(dif) : null;
}

/** Hito más avanzado alcanzado. `atraso` = días desde el vencimiento (negativo = faltan). */
export function hitoFactoring(atraso: number) {
  let hito: (typeof HITOS_FACTORING)[number] | null = null;
  for (const h of HITOS_FACTORING) {
    if (atraso >= h.off) hito = h;
  }
  return hito;
}

export function cuandoFactoring(atraso: number): string {
  if (atraso === 0) return 'vence hoy';
  if (atraso === -1) return 'vence mañana';
  if (atraso < 0) return `vence en ${-atraso} días`;
  if (atraso === 1) return 'venció ayer';
  return `venció hace ${atraso} días`;
}

function claveFactoring(email: any, documentoId: any, hito: any, vencimiento: any): string {
  return [String(email || '').trim().toLowerCase(), documentoId, hito, String(vencimiento || '').slice(0, 10)].join('|');
}

function entidadFactoring(a: AvisoFactoring): string {
  return a.lic?.nombre_entidad || `#${a.doc.licitacion_id}`;
}

// Monto cedido CON IVA: los documentos se guardan en neto (igual que el módulo).
function montoFactoring(a: AvisoFactoring): number {
  const neto = Number(a.doc.monto) || 0;
  return neto > 0 ? Math.round(neto * 1.19) : Number(a.lic?.total_con_iva) || 0;
}

function fmtCLP(v: any): string {
  return `$${Math.round(Number(v) || 0).toLocaleString('es-CL')}`;
}

function fmtDiaCL(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd || '');
}

function esc(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');

/** Un solo correo por destinatario con todas las facturas del aviso. */
function correoFactoring(items: AvisoFactoring[]): { asunto: string; html: string } {
  // Lo más urgente primero.
  const orden = [...items].sort((a, b) => b.atraso - a.atraso);
  const vencidos = orden.filter((a) => a.atraso > 0).length;
  const porVencer = orden.length - vencidos;

  let asunto: string;
  if (orden.length === 1) {
    const a = orden[0];
    asunto =
      `🏦 Factoring ${a.atraso > 0 ? 'vencido' : 'por vencer'}: factura N° ${a.doc.numero || 'S/N'} ` +
      `(${entidadFactoring(a)}) ${cuandoFactoring(a.atraso)}`;
  } else {
    const partes: string[] = [];
    if (vencidos) partes.push(`${vencidos} vencido${vencidos > 1 ? 's' : ''}`);
    if (porVencer) partes.push(`${porVencer} por vencer`);
    asunto = `🏦 Factoring: ${partes.join(' y ')}`;
  }

  const celda = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;';
  const filas = orden
    .map((a) => {
      const rojo = a.atraso > 0;
      const pastilla =
        `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;white-space:nowrap;` +
        `color:${rojo ? '#b91c1c' : '#a16207'};background:${rojo ? '#fee2e2' : '#fef9c3'};">` +
        `${esc(cuandoFactoring(a.atraso))}</span>`;
      return (
        `<tr>` +
        `<td style="${celda}"><strong>N° ${esc(a.doc.numero || 'S/N')}</strong></td>` +
        `<td style="${celda}">${esc(entidadFactoring(a))}` +
        (a.lic?.id_licitacion ? `<br><span style="color:#6b7280;font-size:11px;">${esc(a.lic.id_licitacion)}</span>` : '') +
        `</td>` +
        `<td style="${celda}">${esc(a.doc.factoring_empresa || '—')}</td>` +
        `<td style="${celda}text-align:right;white-space:nowrap;">${fmtCLP(montoFactoring(a))}</td>` +
        `<td style="${celda}white-space:nowrap;">${fmtDiaCL(a.venc)}</td>` +
        `<td style="${celda}">${pastilla}</td>` +
        `</tr>`
      );
    })
    .join('');

  const th = 'padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;border-bottom:2px solid #e5e7eb;';
  const html =
    `<p>Plazo de factoring — ${orden.length === 1 ? 'esta factura requiere' : 'estas facturas requieren'} atención:</p>` +
    `<table style="border-collapse:collapse;width:100%;max-width:760px;">` +
    `<thead><tr>` +
    `<th style="${th}">Factura</th><th style="${th}">Cliente</th><th style="${th}">Empresa factoring</th>` +
    `<th style="${th}text-align:right;">Monto con IVA</th><th style="${th}">Vencimiento</th><th style="${th}">Estado</th>` +
    `</tr></thead><tbody>${filas}</tbody></table>` +
    `<p style="margin-top:16px;"><a href="${APP_URL}/factoring">Abrir el módulo Factoring</a></p>` +
    `<p style="color:#6b7280;font-size:12px;">Aviso automático: se envía ${FACTORING_DIAS_AMARILLO} y 3 días antes del vencimiento, ` +
    `el mismo día, y 1, 7 y 15 días después.</p>`;

  return { asunto, html };
}
