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
     MP_ESTADOS_LOTE=120   → cuántas se consultan por tanda
     MP_ESTADOS_MAX=0      → tope de cotizaciones por pasada; 0 = todas

   Cada pasada recorre TODAS las cotizaciones abiertas con código de Mercado
   Público, en tandas, y al final reintenta las que la API dejó sin responder
   —la v2 de Compra Ágil devuelve 504 con frecuencia—. Si se agota la cuota
   diaria del ticket, corta y sigue en la pasada siguiente.
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.MP_ESTADOS_HORAS || '9,15')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

/* Tamano de cada tanda de consultas. No es un tope: la pasada recorre TODAS
   las candidatas en tandas de este tamano. */
const LOTE = Math.max(5, Math.min(500, Number(process.env.MP_ESTADOS_LOTE || process.env.MP_ESTADOS_LIMITE) || 120));

/* Tope de cotizaciones por pasada. 0 = sin tope, que es lo correcto: si una
   cotizacion sigue abierta hay que preguntar por ella. Existe solo por si la
   cuota del ticket resulta mas chica de lo que aguanta esto y hay que frenarlo
   en caliente desde Railway, sin desplegar. */
const MAX_POR_PASADA = Math.max(0, Math.trunc(Number(process.env.MP_ESTADOS_MAX) || 0));

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
      `Cambio automático de estados MP activo: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}), 
` +
      `tandas de ${LOTE}, ${MAX_POR_PASADA ? `tope ${MAX_POR_PASADA} por pasada` : 'sin tope (todas las abiertas)'}.`,
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

  /** Una pasada: recorre TODAS las candidatas en tandas, aplica lo concluyente
      de cada tanda y al final reintenta las que la API dejó sin responder. */
  async correr() {
    /* Primero la lista de candidatas (sin gastar consultas a Mercado Público) y
       después se recorren ESOS ids. Paginar por posición no sirve: cada
       cotización que se cierra durante la pasada sale del filtro de "abiertas"
       y corre la lista, con lo que se saltarían filas. */
    const lista = await this.licitaciones.diagnosticoMpCotizaciones({ soloCandidatas: true });
    const todas: number[] = ((lista as any).ids || []).slice();
    const objetivo = MAX_POR_PASADA ? todas.slice(0, MAX_POR_PASADA) : todas;
    if (!objetivo.length) {
      this.log.log('No hay cotizaciones abiertas con código de Mercado Público.');
      return { revisadas: 0, candidatas: 0, aplicados: 0, con_error: 0, cuota_agotada: false };
    }
    this.log.log(`Pasada iniciada: ${objetivo.length} candidatas en tandas de ${LOTE}.`);

    let revisadas = 0;
    let aplicados = 0;
    let conError = 0;
    let sinCuota = false;
    const fallidas: number[] = [];

    for (let i = 0; i < objetivo.length; i += LOTE) {
      const ids = objetivo.slice(i, i + LOTE);
      const diag = await this.licitaciones.diagnosticoMpCotizaciones({ ids, limite: ids.length });
      revisadas += diag.revisadas;
      conError += diag.con_error;
      for (const f of (diag.filas || []) as any[]) {
        if (f.error && f.id) fallidas.push(f.id);
      }
      aplicados += await this.aplicarYNotificar(diag.filas || []);
      // Sin cuota del ticket no sirve seguir: solo gastaría llamadas en vano.
      if ((diag.filas || []).some((f: any) => /cuota/i.test(String(f.error || '')))) {
        sinCuota = true;
        break;
      }
    }

    /* Segunda vuelta para las que fallaron por culpa de la API (504, timeouts:
       la v2 de Compra Ágil los da a menudo). Sin esto, una cotización ya
       resuelta en ChileCompra se quedaba sin actualizar hasta la pasada
       siguiente por un error ajeno. */
    if (!sinCuota && fallidas.length) {
      let rescatados = 0;
      let siguenFallando = 0;
      for (let i = 0; i < fallidas.length; i += LOTE) {
        const ids = fallidas.slice(i, i + LOTE);
        const reintento = await this.licitaciones.diagnosticoMpCotizaciones({ ids, limite: ids.length });
        siguenFallando += reintento.con_error;
        rescatados += await this.aplicarYNotificar(reintento.filas || []);
      }
      aplicados += rescatados;
      this.log.log(
        `Reintento de ${fallidas.length} sin respuesta: ${siguenFallando} volvieron a fallar · ${rescatados} cambio(s) rescatado(s).`,
      );
    }

    this.log.log(
      `Pasada completa: ${revisadas} de ${objetivo.length} candidatas · ${aplicados} cambio(s) de estado · ` +
      `${conError} sin respuesta de Mercado Público${sinCuota ? ' · CUOTA DIARIA AGOTADA' : ''}.`,
    );
    return { revisadas, candidatas: objetivo.length, aplicados, con_error: conError, cuota_agotada: sinCuota };
  }

  /** Aplica los desenlaces concluyentes de un lote y avisa a cada vendedor. */
  private async aplicarYNotificar(filas: any[]): Promise<number> {
    const aplicables = (filas || []).filter((f: any) => f.discrepancia && f.sugerencia && f.id);
    if (!aplicables.length) return 0;

    const r = await this.licitaciones.aplicarEstadoMp(
      { cambios: aplicables.map((f: any) => ({ id: f.id, estado: f.sugerencia })) },
      'automático (Mercado Público)',
    );
    if (r.errores.length) this.log.warn(`Errores al aplicar: ${r.errores.join(' · ')}`);

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
    return r.aplicados;
  }
}
