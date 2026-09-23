import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from './licitaciones.service';

/* ============================================================================
   Cambio automático de estado según Mercado Público (pedido 2026-09-17)
   ----------------------------------------------------------------------------
   Dos veces al día (9:00 y 15:00 de Chile) revisa las cotizaciones con
   código de Mercado Público que siguen abiertas en el sistema y, cuando
   ChileCompra ya publicó un desenlace CONCLUYENTE, aplica el cambio solo:

     · Adjudicada a nuestro RUT      → Adjudicada (con fecha_adjudicada)
     · Adjudicada a otro proveedor   → Perdida
     · Desierta / Revocada           → Descartada

   Cada cambio deja su registro en el historial de la cotización (vía
   aplicarEstadoMp) y una notificación en la campanita del dueño de la
   cotización. Los procesos sin desenlace o que la API no publica se dejan
   tal cual; los errores (cuota del ticket, timeouts de MP) se reintentan
   solos en la siguiente pasada porque la cotización sigue abierta.

   El diagnóstico manual de Análisis Mercado Público sigue existiendo para
   revisar a demanda; este cron usa exactamente el mismo motor.

   Interruptores:
     MP_ESTADOS_AUTO=off   → apagado (ej. backend local de desarrollo)
     MP_ESTADOS_HORAS=9,15 → horas de Chile en que corre
     MP_ESTADOS_LIMITE=120 → máx. de procesos consultados por pasada (cuida
                             la cuota diaria del ticket de ChileCompra). La
                             ventana ROTA: cada pasada arranca donde terminó la
                             anterior, así que con el tiempo se revisan todas.
                             Con ~800 abiertas y 2 pasadas al día a 120, el
                             ciclo completo tarda ~3 días; subirlo lo acorta.
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.MP_ESTADOS_HORAS || '9,15')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

const LIMITE = Math.max(5, Math.min(500, Number(process.env.MP_ESTADOS_LIMITE) || 120));

@Injectable()
export class MpEstadosCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MpEstadosCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly licitaciones: LicitacionesService,
  ) {}

  onModuleInit() {
    if (String(process.env.MP_ESTADOS_AUTO || '').toLowerCase() === 'off') {
      this.log.log('Cambio automático de estados MP DESACTIVADO (MP_ESTADOS_AUTO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('MP_ESTADOS_HORAS sin horas válidas: no se programó el cambio automático de estados.');
      return;
    }
    this.log.log(
      `Cambio automático de estados MP activo: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}), hasta ${LIMITE} procesos por pasada.`,
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
    this.corriendo = true;
    try {
      await this.correr();
    } catch (e: any) {
      this.log.warn(`Pasada fallida: ${String(e?.message || e).slice(0, 160)}`);
    } finally {
      this.corriendo = false;
    }
  }

  /** Una pasada completa: diagnóstico → aplicar concluyentes → notificar. */
  async correr() {
    /* Punto de partida rotatorio: media jornada = un bloque, y cada bloque
       corre la ventana un cupo entero. Sin esto se revisaban siempre las
       mismas primeras y el resto no se consultaba jamás. */
    const bloque = Math.floor(Date.now() / (12 * 3600_000));
    const diag = await this.licitaciones.diagnosticoMpCotizaciones({
      limite: LIMITE,
      desde: bloque * LIMITE,
    });
    const aplicables = (diag.filas || []).filter((f: any) => f.discrepancia && f.sugerencia && f.id);
    this.log.log(
      `Revisadas ${diag.revisadas}/${diag.candidatas} (desde la ${(diag as any).desde ?? 0}) · ` +
      `concluyentes ${aplicables.length} · errores ${diag.con_error}`,
    );
    if (!aplicables.length) return;

    const r = await this.licitaciones.aplicarEstadoMp(
      { cambios: aplicables.map((f: any) => ({ id: f.id, estado: f.sugerencia })) },
      'automático (Mercado Público)',
    );
    this.log.log(`Aplicados ${r.aplicados} cambio(s) de estado.${r.errores.length ? ` Errores: ${r.errores.join(' · ')}` : ''}`);

    // Notificación en la campanita al dueño de cada cotización cambiada.
    const client = this.supabase.getClient();
    const { data: duenos } = await client
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, vendedor_correo, creado_por')
      .in('id', r.ids);
    for (const f of aplicables) {
      if (!r.ids.includes(f.id)) continue;
      const lic = (duenos || []).find((l: any) => l.id === f.id);
      const destinatario = String(lic?.vendedor_correo || lic?.creado_por || '').trim().toLowerCase();
      if (!destinatario) continue;
      const { error } = await client.from('notificaciones').insert([{
        user_email: destinatario,
        tipo: 'mp_estado_auto',
        mensaje: `Mercado Público resolvió la ${lic?.id_licitacion || `#${f.id}`} (${lic?.nombre_entidad || 'cliente'}): estado actualizado automáticamente a "${f.sugerencia}". ${String(f.motivo || '').trim()}`,
        link: `/detalle/${f.id}`,
        metadata: { licitacion_id: f.id, estado: f.sugerencia, origen: 'mp_estados_cron' },
      }]);
      if (error) this.log.warn(`Sin notificación para #${f.id}: ${error.message}`);
    }
  }
}
