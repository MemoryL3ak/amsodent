import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';

// Scheduler liviano (setInterval, sin dependencias extra) que genera
// recordatorios de cotización: cierre próximo (3 h / 1 h antes) y resultados
// publicados (1 día después). Crea una notificación (popup en la app) y envía
// un correo al vendedor. Marca columnas para no repetir.
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
    metadata?: Record<string, any>;
  }) {
    await this.supabase.getClient().from('notificaciones').insert([
      {
        user_email: args.email,
        tipo: args.tipo,
        mensaje: args.mensaje,
        link: `/detalle/${args.licitacionId}`,
        metadata: { licitacion_id: args.licitacionId, ...(args.metadata || {}) },
      },
    ]);
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

  // ── Factoring por vencer (1 semana antes de factoring_vencimiento) ───────
  // Avisa por notificación y correo a contabilidad/jefatura cuando faltan 7 días
  // o menos para el vencimiento del factoring. Marca factoring_recordatorio_at
  // para no reenviar. Si la columna no está migrada, el SELECT falla y salimos
  // sin enviar nada (evita reenvíos en bucle).
  private static readonly FACTORING_AVISO = [
    'jer.consorcio@gmail.com',
    'benja.alarcon.z@gmail.com',
  ];

  private async recordatoriosFactoring() {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitacion_documentos')
      .select(
        'id, licitacion_id, numero, monto, factoring_empresa, factoring_vencimiento, factoring_recordatorio_at',
      )
      .in('tipo', ['factura', 'factura_boleta'])
      .eq('forma_pago', 'factoring')
      .not('factoring_vencimiento', 'is', null)
      .is('factoring_recordatorio_at', null);
    if (error) {
      this.logger.warn(`factoring: ${error.message}`);
      return;
    }
    if (!data?.length) return;

    const licIds = [...new Set((data as any[]).map((d) => d.licitacion_id).filter(Boolean))];
    const licMap: Record<number, any> = {};
    if (licIds.length) {
      const { data: lics } = await client
        .from('licitaciones')
        .select('id, id_licitacion, nombre_entidad')
        .in('id', licIds);
      (lics || []).forEach((l: any) => { licMap[l.id] = l; });
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    for (const doc of data as any[]) {
      const venc = new Date(`${String(doc.factoring_vencimiento).slice(0, 10)}T00:00:00`);
      if (Number.isNaN(venc.getTime())) continue;
      const dias = Math.round((venc.getTime() - hoy.getTime()) / 86_400_000);
      if (dias > 7) continue; // todavía falta más de una semana

      const lic = licMap[doc.licitacion_id] || {};
      const entidad = lic.nombre_entidad || `#${doc.licitacion_id}`;
      const fechaTxt = String(doc.factoring_vencimiento).slice(0, 10);
      const empresa = doc.factoring_empresa || 'sin empresa';
      const numero = doc.numero || 'S/N';
      const cuando =
        dias < 0 ? `venció hace ${Math.abs(dias)} día(s)`
        : dias === 0 ? 'vence hoy'
        : `vence en ${dias} día(s)`;
      const asunto = `🏦 Factoring por vencer: factura ${numero} (${entidad})`;
      const html =
        `<p>El plazo de factoring de la factura <strong>${numero}</strong> de <strong>${entidad}</strong> ${cuando} (<strong>${fechaTxt}</strong>).</p>` +
        `<p>Empresa de factoring: <strong>${empresa}</strong>.</p>`;
      const mensaje = `Factoring de la factura ${numero} (${entidad}) ${cuando} — vence ${fechaTxt}.`;

      for (const email of RecordatoriosService.FACTORING_AVISO) {
        await this.crearNotificacion({
          email,
          tipo: 'factoring_por_vencer',
          mensaje,
          licitacionId: doc.licitacion_id,
          metadata: { documento_id: doc.id, vencimiento: fechaTxt },
        });
        await this.enviarCorreo(email, asunto, html);
      }
      await client
        .from('licitacion_documentos')
        .update({ factoring_recordatorio_at: new Date().toISOString() })
        .eq('id', doc.id);
    }
  }
}
