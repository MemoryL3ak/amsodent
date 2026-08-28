import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Alerta de facturas vencidas (pedido 2026-08-27)
   ----------------------------------------------------------------------------
   Una vez al día (08:00 de Chile) revisa las facturas SIN pagar de
   cotizaciones adjudicadas cuya fecha de vencimiento (fecha de factura +
   plazo de la condición de venta, la misma regla del módulo Seguimiento de
   Pagos) se cumplió HOY o en los últimos 3 días (ventana de gracia por si el
   backend estuvo caído). A cada usuario con rol jefe_ventas_especial le deja
   UNA notificación en la campanita con el detalle, apuntando a Seguimiento de
   Pagos, desde donde puede GENERAR el correo de cobro (el envío siempre lo
   decide la persona; aquí no se envía nada).

   Cada factura se avisa UNA sola vez por usuario: los ids ya notificados se
   leen de las notificaciones anteriores (metadata.factura_ids).

   Mismo patrón de reloj que los otros crones (temporizador + Intl con zona
   explícita, el servidor corre en UTC). Interruptores:
     FACT_VENC_AVISO=off      → apagado (ej. backend local de desarrollo)
     FACT_VENC_HORAS=8        → hora(s) de Chile en que revisa
============================================================================ */

const ZONA = 'America/Santiago';
const VENTANA_DIAS = 3; // venció hoy o hace hasta 3 días

const HORAS = String(process.env.FACT_VENC_HORAS || '8')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

// Misma regla que el frontend (SeguimientoPagos.plazoDias): el primer número
// de la condición de venta son los días; "contado" = 0; sin dato = 30.
function plazoDias(condVenta: any): number {
  const c = String(condVenta || '').toLowerCase();
  const m = c.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (c.includes('contado')) return 0;
  return 30;
}

function fmtCLP(v: any): string {
  return `$${Math.round(Number(v) || 0).toLocaleString('es-CL')}`;
}

function fmtDia(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd || '');
}

@Injectable()
export class FacturasVencidasCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FacturasVencidasCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    if (String(process.env.FACT_VENC_AVISO || '').toLowerCase() === 'off') {
      this.log.log('Alerta de facturas vencidas DESACTIVADA (FACT_VENC_AVISO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('FACT_VENC_HORAS no tiene horas válidas: no se programó la alerta.');
      return;
    }
    this.log.log(
      `Alerta de facturas vencidas activa: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}).`,
    );
    this.timer = setInterval(() => void this.revisar(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private ahoraEnChile() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const v = (t: string) => partes.find((p) => p.type === t)?.value || '';
    return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')), minuto: Number(v('minute')) };
  }

  private async revisar() {
    if (this.corriendo) return;
    const { fecha, hora, minuto } = this.ahoraEnChile();
    if (!HORAS.includes(hora)) return;
    if (minuto > 4) return;
    const marca = `${fecha}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    await this.correr(fecha);
  }

  /** Revisa y notifica. Expuesto para poder dispararlo a mano si hiciera falta. */
  async correr(hoyChile: string) {
    if (this.corriendo) return { omitida: true };
    this.corriendo = true;
    try {
      const client = this.supabase.getClient();

      // 1) Cotizaciones adjudicadas (aportan la condición de venta y la entidad).
      const lics: any[] = [];
      for (let p = 0; ; p++) {
        const { data, error } = await client
          .from('licitaciones')
          .select('id, id_licitacion, nombre_entidad, condicion_venta')
          .eq('estado', 'Adjudicada')
          .range(p * 1000, p * 1000 + 999);
        if (error) throw new Error(error.message);
        lics.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
      const licPorId = new Map(lics.map((l) => [Number(l.id), l]));
      if (!lics.length) return { avisadas: 0, motivo: 'sin adjudicadas' };

      // 2) Facturas sin pagar de esas cotizaciones.
      const ids = lics.map((l) => Number(l.id));
      const facturas: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await client
          .from('licitacion_documentos')
          .select('id, licitacion_id, tipo, numero, monto, fecha_factura, pagada')
          .in('licitacion_id', ids.slice(i, i + 200))
          .in('tipo', ['factura', 'factura_boleta'])
          .range(0, 9999);
        if (error) throw new Error(error.message);
        facturas.push(...(data || []));
      }

      // 3) Las que VENCIERON dentro de la ventana (hoy o hace ≤3 días).
      const hoy = new Date(`${hoyChile}T00:00:00`);
      const vencidas = facturas.filter((f) => {
        if (f.pagada) return false;
        const ff = String(f.fecha_factura || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ff)) return false;
        const lic = licPorId.get(Number(f.licitacion_id));
        if (!lic) return false;
        const venc = new Date(`${ff}T00:00:00`);
        venc.setDate(venc.getDate() + plazoDias(lic.condicion_venta));
        const dias = Math.floor((hoy.getTime() - venc.getTime()) / 86_400_000);
        return dias >= 0 && dias <= VENTANA_DIAS;
      });
      if (!vencidas.length) return { avisadas: 0, motivo: 'sin vencimientos en la ventana' };

      // 4) Destinatarios: rol jefe_ventas_especial.
      const { data: jefes, error: errJefes } = await client
        .from('profiles')
        .select('email')
        .eq('rol', 'jefe_ventas_especial');
      if (errJefes) throw new Error(errJefes.message);
      const emails = (jefes || [])
        .map((j: any) => String(j.email || '').trim().toLowerCase())
        .filter(Boolean);
      if (!emails.length) return { avisadas: 0, motivo: 'sin usuarios jefe_ventas_especial' };

      // 5) Qué facturas ya se avisaron a cada usuario (metadata.factura_ids).
      const { data: previas } = await client
        .from('notificaciones')
        .select('user_email, metadata')
        .eq('tipo', 'factura_vencida')
        .range(0, 9999);
      const yaAvisadas = new Set<string>();
      for (const n of previas || []) {
        const email = String(n.user_email || '').toLowerCase();
        for (const fid of n?.metadata?.factura_ids || []) yaAvisadas.add(`${email}|${fid}`);
      }

      // 6) Una notificación por usuario con las facturas NUEVAS de su ventana.
      let avisadas = 0;
      for (const email of emails) {
        const nuevas = vencidas.filter((f) => !yaAvisadas.has(`${email}|${f.id}`));
        if (!nuevas.length) continue;
        const detalle = nuevas
          .slice(0, 3)
          .map((f) => {
            const lic = licPorId.get(Number(f.licitacion_id));
            return `N° ${f.numero || 's/n'} de ${lic?.nombre_entidad || '—'} (${fmtCLP(Math.round(Number(f.monto || 0) * 1.19))})`;
          })
          .join('; ');
        const extra = nuevas.length > 3 ? ` y ${nuevas.length - 3} más` : '';
        const { error: errNotif } = await client.from('notificaciones').insert([
          {
            user_email: email,
            tipo: 'factura_vencida',
            mensaje:
              `Venció el plazo de pago de ${nuevas.length} factura${nuevas.length > 1 ? 's' : ''}: ` +
              `${detalle}${extra}. En Seguimiento de Pagos puedes generar el correo de cobro (tú decides el envío).`,
            link: '/seguimiento-pagos',
            metadata: {
              factura_ids: nuevas.map((f) => f.id),
              licitacion_ids: [...new Set(nuevas.map((f) => Number(f.licitacion_id)))],
              vencidas_al: hoyChile,
            },
          },
        ]);
        if (errNotif) this.log.warn(`No se pudo notificar a ${email}: ${errNotif.message}`);
        else avisadas++;
      }
      this.log.log(`Facturas vencidas en ventana: ${vencidas.length} · ${avisadas} usuario(s) notificado(s).`);
      return { vencidas: vencidas.length, avisadas };
    } catch (e: any) {
      this.log.error(`Alerta de facturas vencidas interrumpida: ${String(e?.message || e)}`);
      return { error: String(e?.message || e) };
    } finally {
      this.corriendo = false;
    }
  }
}
