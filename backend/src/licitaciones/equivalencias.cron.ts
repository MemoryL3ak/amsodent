import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from './licitaciones.service';

/* ============================================================================
   Recordatorio de equivalencias sin aprovechar
   ----------------------------------------------------------------------------
   Una vez al día (09:00 de Chile) revisa las cotizaciones MADRE del mes que
   siguen vigentes, cuyos ítems tienen productos con equivalencias registradas
   en el catálogo, y que aún no generaron la cotización alternativa (hija).
   A cada vendedor dueño le deja UNA notificación en la campanita con el
   resumen y el detalle de códigos (pedido 2026-08-13).

   No insiste: si el usuario ya recibió el aviso HOY, no se repite — mañana
   vuelve a avisar si la oportunidad sigue pendiente, que es exactamente lo
   que pide un recordatorio.

   Mismo patrón de reloj que los otros crones: temporizador + Intl con zona
   explícita, porque el servidor corre en UTC. Interruptores:
     EQUIV_AVISO=off          → apagado (ej. backend local de desarrollo)
     EQUIV_AVISO_HORAS=9      → hora(s) de Chile en que revisa
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.EQUIV_AVISO_HORAS || '9')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

// Estados donde ya no tiene sentido crear la alternativa: resueltas o bajadas.
const ESTADOS_SIN_ACCION = new Set([
  'adjudicada', 'perdida', 'descartada', 'cancelada', 'desierta',
]);

@Injectable()
export class EquivalenciasCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('EquivalenciasCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly licitaciones: LicitacionesService,
  ) {}

  onModuleInit() {
    if (String(process.env.EQUIV_AVISO || '').toLowerCase() === 'off') {
      this.log.log('Recordatorio de equivalencias DESACTIVADO (EQUIV_AVISO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('EQUIV_AVISO_HORAS no tiene horas válidas: no se programó el recordatorio.');
      return;
    }
    this.log.log(
      `Recordatorio de equivalencias activo: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}).`,
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
  async correr(fechaChile: string) {
    if (this.corriendo) return { omitida: true };
    this.corriendo = true;
    try {
      const client = this.supabase.getClient();

      // 1) SKUs con al menos una equivalencia VÁLIDA (que existe en el catálogo).
      const { data: prods, error: errProds } = await client
        .from('productos')
        .select('sku, equivalente_1, equivalente_2, equivalente_3')
        .range(0, 49999);
      if (errProds) throw new Error(errProds.message);
      const skus = new Set(
        (prods || []).map((p: any) => String(p.sku || '').trim().toUpperCase()).filter(Boolean),
      );
      const conEquiv = new Set<string>();
      (prods || []).forEach((p: any) => {
        const sku = String(p.sku || '').trim().toUpperCase();
        if (!sku) return;
        const eqs = [p.equivalente_1, p.equivalente_2, p.equivalente_3]
          .map((s: any) => String(s || '').trim().toUpperCase())
          .filter((s: string) => s && s !== sku && skus.has(s));
        if (eqs.length) conEquiv.add(sku);
      });
      if (!conEquiv.size) return { avisadas: 0, motivo: 'sin equivalencias en el catálogo' };

      // 2) Cotizaciones del mes: madres vigentes + hijas existentes.
      const inicioMes = `${fechaChile.slice(0, 7)}-01`;
      const { data: lics, error: errLics } = await client
        .from('licitaciones')
        .select('id, id_licitacion, nombre, creado_por, madre_id, estado, fecha')
        .gte('fecha', inicioMes)
        .range(0, 49999);
      if (errLics) throw new Error(errLics.message);
      const madresConHija = new Set(
        (lics || []).map((l: any) => Number(l.madre_id || 0)).filter(Boolean),
      );
      const madres = (lics || []).filter((l: any) => {
        if (l.madre_id) return false;
        if (madresConHija.has(Number(l.id))) return false;
        const estado = String(l.estado || '').trim().toLowerCase();
        return !ESTADOS_SIN_ACCION.has(estado);
      });
      if (!madres.length) return { avisadas: 0, motivo: 'sin cotizaciones pendientes' };

      // 3) ¿Cuáles de esas madres tienen ítems con equivalencia?
      const items = await this.licitaciones.getItemsByFilter(
        madres.map((l: any) => Number(l.id)),
        'licitacion_id,sku',
      );
      const licsConEquiv = new Set<number>();
      (items || []).forEach((it: any) => {
        const sku = String(it.sku || '').trim().toUpperCase();
        if (sku && conEquiv.has(sku)) licsConEquiv.add(Number(it.licitacion_id));
      });
      const pendientes = madres.filter((l: any) => licsConEquiv.has(Number(l.id)));
      if (!pendientes.length) return { avisadas: 0, motivo: 'sin oportunidades sin aprovechar' };

      // 4) Agrupar por dueño y descartar a quienes ya recibieron el aviso HOY.
      const porUsuario = new Map<string, any[]>();
      pendientes.forEach((l: any) => {
        const email = String(l.creado_por || '').trim().toLowerCase();
        if (!email) return;
        if (!porUsuario.has(email)) porUsuario.set(email, []);
        porUsuario.get(email)!.push(l);
      });
      const { data: hoy } = await client
        .from('notificaciones')
        .select('user_email')
        .eq('tipo', 'equivalencias_pendientes')
        .gte('created_at', `${fechaChile}T00:00:00-04:00`);
      const yaAvisados = new Set((hoy || []).map((n: any) => String(n.user_email || '').toLowerCase()));

      // 5) Una notificación por usuario, con los códigos a la vista.
      let avisadas = 0;
      for (const [email, lista] of porUsuario) {
        if (yaAvisados.has(email)) continue;
        const codigos = lista.map((l: any) => l.id_licitacion || l.nombre || `Cot. ${l.id}`);
        const detalle = codigos.slice(0, 3).join(', ') + (codigos.length > 3 ? ` y ${codigos.length - 3} más` : '');
        const { error: errNotif } = await client.from('notificaciones').insert([
          {
            user_email: email,
            tipo: 'equivalencias_pendientes',
            mensaje:
              `Tienes ${lista.length} cotización${lista.length > 1 ? 'es' : ''} con productos ` +
              `equivalentes y sin cotización alternativa: ${detalle}. ` +
              `Genera la alternativa para aumentar las opciones de adjudicar.`,
            link: '/listar',
            metadata: { licitacion_ids: lista.map((l: any) => l.id) },
          },
        ]);
        if (errNotif) this.log.warn(`No se pudo notificar a ${email}: ${errNotif.message}`);
        else avisadas++;
      }
      this.log.log(`Equivalencias sin aprovechar: ${pendientes.length} cotizaciones · ${avisadas} usuarios avisados.`);
      return { pendientes: pendientes.length, avisadas };
    } catch (e: any) {
      this.log.error(`Recordatorio de equivalencias interrumpido: ${String(e?.message || e)}`);
      return { error: String(e?.message || e) };
    } finally {
      this.corriendo = false;
    }
  }
}
