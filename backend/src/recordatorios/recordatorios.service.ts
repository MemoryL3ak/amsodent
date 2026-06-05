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
  private async recordatoriosCierre() {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('licitaciones')
      .select(
        'id, nombre, nombre_entidad, creado_por, vendedor_correo, fecha_hora_cierre, recordatorio_cierre_3h_at, recordatorio_cierre_1h_at',
      )
      .in('estado', ['En espera', 'Pendiente Aprobación'])
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
}
