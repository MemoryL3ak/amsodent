import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FeriadosService } from '../feriados/feriados.service';

/* ============================================================================
   Calendario de cobranza por vencimiento de facturas
   ----------------------------------------------------------------------------
   (pedido 2026-08-27, ampliado 2026-09-04 al calendario de 6 acciones)

   Una vez al día (08:00 de Chile) revisa las facturas SIN pagar de
   cotizaciones adjudicadas. El vencimiento = fecha de factura + plazo de la
   condición de venta (misma regla del módulo Seguimiento de Pagos). Sobre ese
   vencimiento corre un calendario de acciones medido en DÍAS HÁBILES
   (feriados de Chile vía FeriadosService + fines de semana):

     1ª acción → 3 días hábiles ANTES de vencer → Correo
     2ª acción → fecha de vencimiento           → Correo
     3ª acción → 5 días hábiles de atraso       → Correo
     4ª acción → 7 días hábiles de atraso       → Llamada
     5ª acción → 10 días hábiles de atraso      → Correo
     6ª acción → 15 días hábiles de atraso      → Visita

   Por cada acción que se gatilla:
     - Notificación en la campanita a cada usuario con rol jefe_ventas_especial
       (apunta a Seguimiento de Pagos, donde puede GENERAR el correo de cobro;
       el envío siempre lo decide la persona — aquí no se envía nada).
     - Una actividad en la Bitácora de cada jefe (tipo correo/llamada/visita,
       estado pendiente) para que la gestión quede agendada y trazable.

   Cada (factura, acción) se gatilla UNA sola vez: el dedupe se lee de las
   notificaciones anteriores (tipo cobranza_accion, metadata.factura_id+hito).
   Si un hito cae en fin de semana o el backend estuvo caído, se gatilla al
   día siguiente que corra (se compara con >= y no con igualdad exacta).

   Mismo patrón de reloj que los otros crones. Interruptores:
     FACT_VENC_AVISO=off      → apagado (ej. backend local de desarrollo)
     FACT_VENC_HORAS=8        → hora(s) de Chile en que revisa
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.FACT_VENC_HORAS || '8')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

// Calendario de acciones: off = días hábiles respecto del vencimiento
// (negativo = antes). El orden importa: se gatilla el hito MÁS AVANZADO
// alcanzado que aún no se haya avisado.
const HITOS: Array<{ key: string; off: number; accion: 'correo' | 'llamada' | 'visita'; label: string }> = [
  { key: 'pre3', off: -3, accion: 'correo', label: 'Correo preventivo (a 3 días hábiles de vencer)' },
  { key: 'venc', off: 0, accion: 'correo', label: 'Correo de cobro (factura vencida)' },
  { key: 'post5', off: 5, accion: 'correo', label: 'Correo de cobro (5 días hábiles de atraso)' },
  { key: 'post7', off: 7, accion: 'llamada', label: 'Llamada de cobro (7 días hábiles de atraso)' },
  { key: 'post10', off: 10, accion: 'correo', label: 'Correo de cobro (10 días hábiles de atraso)' },
  { key: 'post15', off: 15, accion: 'visita', label: 'Visita de cobro (15 días hábiles de atraso)' },
];

const ACCION_LABEL: Record<string, string> = {
  correo: 'enviar correo de cobro',
  llamada: 'llamar al cliente',
  visita: 'coordinar visita de cobro',
};

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

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class FacturasVencidasCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FacturasVencidasCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly feriados: FeriadosService,
  ) {}

  onModuleInit() {
    if (String(process.env.FACT_VENC_AVISO || '').toLowerCase() === 'off') {
      this.log.log('Calendario de cobranza DESACTIVADO (FACT_VENC_AVISO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('FACT_VENC_HORAS no tiene horas válidas: no se programó el calendario de cobranza.');
      return;
    }
    this.log.log(
      `Calendario de cobranza activo: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}).`,
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

  /** Días hábiles de Chile entre a (exclusivo) y b (inclusivo). a <= b. */
  private habilesEntre(a: Date, b: Date, feriados: Set<string>): number {
    let n = 0;
    const d = new Date(a);
    while (d < b) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      if (feriados.has(ymd(d))) continue;
      n++;
    }
    return n;
  }

  /** Revisa y gatilla las acciones del día. Expuesto para dispararlo a mano. */
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
      if (!lics.length) return { acciones: 0, motivo: 'sin adjudicadas' };

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

      // 3) Feriados de los años involucrados (para contar días hábiles).
      const hoy = new Date(`${hoyChile}T00:00:00`);
      const anios = new Set<number>([hoy.getFullYear(), hoy.getFullYear() - 1]);
      const feriadosSet = new Set<string>();
      for (const y of anios) {
        for (const f of await this.feriados.getYear(y)) feriadosSet.add(f.fecha);
      }

      // 4) Hito alcanzado por cada factura impaga (el más avanzado).
      type Pendiente = { factura: any; lic: any; hito: (typeof HITOS)[number]; venc: string; atrasoHabiles: number };
      const alcanzados: Pendiente[] = [];
      for (const f of facturas) {
        if (f.pagada) continue;
        const ff = String(f.fecha_factura || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ff)) continue;
        const lic = licPorId.get(Number(f.licitacion_id));
        if (!lic) continue;
        const venc = new Date(`${ff}T00:00:00`);
        venc.setDate(venc.getDate() + plazoDias(lic.condicion_venta));

        let hito: (typeof HITOS)[number] | null = null;
        let atrasoHabiles = 0;
        if (hoy < venc) {
          // Faltan N días hábiles para vencer → correo preventivo desde 3.
          const faltan = this.habilesEntre(hoy, venc, feriadosSet);
          if (faltan <= 3) hito = HITOS[0];
        } else {
          atrasoHabiles = this.habilesEntre(venc, hoy, feriadosSet);
          for (const h of HITOS) {
            if (h.off >= 0 && atrasoHabiles >= h.off) hito = h; // el más avanzado alcanzado
          }
        }
        if (hito) alcanzados.push({ factura: f, lic, hito, venc: ymd(venc), atrasoHabiles });
      }
      if (!alcanzados.length) return { acciones: 0, motivo: 'sin hitos alcanzados' };

      // 5) Dedupe: (factura, hito) ya gatillados, desde las notificaciones.
      const { data: previas } = await client
        .from('notificaciones')
        .select('metadata')
        .eq('tipo', 'cobranza_accion')
        .range(0, 9999);
      const yaGatillados = new Set<string>();
      for (const n of previas || []) {
        for (const it of n?.metadata?.items || []) {
          if (it?.factura_id != null && it?.hito) yaGatillados.add(`${it.factura_id}|${it.hito}`);
        }
      }
      const nuevos = alcanzados.filter((a) => !yaGatillados.has(`${a.factura.id}|${a.hito.key}`));
      if (!nuevos.length) return { acciones: 0, motivo: 'todo ya avisado' };

      // 6) Destinatarios: rol jefe_ventas_especial (con nombre para la bitácora).
      const { data: jefes, error: errJefes } = await client
        .from('profiles')
        .select('email, nombre')
        .eq('rol', 'jefe_ventas_especial');
      if (errJefes) throw new Error(errJefes.message);
      const destinatarios = (jefes || [])
        .map((j: any) => ({ email: String(j.email || '').trim().toLowerCase(), nombre: String(j.nombre || '').trim() }))
        .filter((j) => j.email);
      if (!destinatarios.length) return { acciones: 0, motivo: 'sin usuarios jefe_ventas_especial' };

      // 7) Por usuario: UNA notificación agrupada por tipo de acción, y una
      //    actividad en bitácora por cada factura-acción.
      let notifs = 0;
      let actividades = 0;
      const porAccion = new Map<string, Pendiente[]>();
      for (const a of nuevos) {
        const arr = porAccion.get(a.hito.accion) || [];
        arr.push(a);
        porAccion.set(a.hito.accion, arr);
      }

      for (const dest of destinatarios) {
        for (const [accion, items] of porAccion) {
          const detalle = items
            .slice(0, 3)
            .map((a) => `N° ${a.factura.numero || 's/n'} de ${a.lic?.nombre_entidad || '—'} (${fmtCLP(Math.round(Number(a.factura.monto || 0) * 1.19))}, vence ${fmtDia(a.venc)})`)
            .join('; ');
          const extra = items.length > 3 ? ` y ${items.length - 3} más` : '';
          const { error: errNotif } = await client.from('notificaciones').insert([{
            user_email: dest.email,
            tipo: 'cobranza_accion',
            mensaje:
              `Cobranza — ${ACCION_LABEL[accion] || accion} (${items.length} factura${items.length > 1 ? 's' : ''}): ` +
              `${detalle}${extra}. Las gestiones quedaron agendadas en tu Bitácora; el correo se genera desde Seguimiento de Pagos.`,
            link: '/seguimiento-pagos',
            metadata: {
              accion,
              corrida: hoyChile,
              items: items.map((a) => ({
                factura_id: a.factura.id,
                licitacion_id: Number(a.factura.licitacion_id),
                hito: a.hito.key,
                vencimiento: a.venc,
              })),
            },
          }]);
          if (errNotif) this.log.warn(`No se pudo notificar a ${dest.email}: ${errNotif.message}`);
          else notifs++;

          // Una actividad de bitácora por factura (agendada para HOY).
          const filas = items.map((a) => ({
            user_email: dest.email,
            user_nombre: dest.nombre || dest.email,
            cliente_nombre: a.lic?.nombre_entidad || null,
            licitacion_id: Number(a.factura.licitacion_id),
            titulo: `Cobranza: ${a.hito.label} — factura N° ${a.factura.numero || 's/n'}`,
            tipo: accion,
            motivo: 'Gestión Administrativa',
            comentario:
              `Generada por el calendario de cobranza. Factura N° ${a.factura.numero || 's/n'} de ` +
              `${a.lic?.nombre_entidad || '—'} (${a.lic?.id_licitacion || `#${a.factura.licitacion_id}`}), ` +
              `${fmtCLP(Math.round(Number(a.factura.monto || 0) * 1.19))} bruto, vencimiento ${fmtDia(a.venc)}` +
              (a.atrasoHabiles > 0 ? `, ${a.atrasoHabiles} día(s) hábil(es) de atraso.` : '.'),
            fecha: hoyChile,
            todo_el_dia: true,
            estado: 'pendiente',
            adjuntos: [],
          }));
          const { error: errAct } = await client.from('actividades_cliente').insert(filas);
          if (errAct) this.log.warn(`No se pudo agendar en bitácora de ${dest.email}: ${errAct.message}`);
          else actividades += filas.length;
        }
      }

      this.log.log(
        `Calendario de cobranza: ${nuevos.length} acción(es) nueva(s) · ${notifs} notificación(es) · ${actividades} actividad(es) en bitácora.`,
      );
      return { acciones: nuevos.length, notificaciones: notifs, actividades };
    } catch (e: any) {
      this.log.error(`Calendario de cobranza interrumpido: ${String(e?.message || e)}`);
      return { error: String(e?.message || e) };
    } finally {
      this.corriendo = false;
    }
  }
}
