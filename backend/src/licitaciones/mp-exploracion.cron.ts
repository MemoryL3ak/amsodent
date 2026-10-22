import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { LicitacionesService } from './licitaciones.service';
import { MercadopublicoCron } from '../mercadopublico/mercadopublico.cron';
import { correTareasDeFondo, MOTIVO_SIN_FONDO } from '../rol-proceso';

/* ============================================================================
   Exploración automática de Mercado Público
   ----------------------------------------------------------------------------
   Corre la búsqueda del explorador (todo el catálogo de palabras clave, ~90
   términos, ~4 minutos) dos veces al día —08:00 y 15:00 de Chile— y guarda el
   resultado en `mp_exploracion`. La pestaña «Explorar» lee esa fila al abrir:
   instantánea y sin gastar cuota. La búsqueda manual quedó restringida a los
   correos de MP_EXPLORAR_EMAILS justamente porque cada ejecución son ~90
   consultas de una cuota compartida.

   (2026-10-02) Antes corría a las 14:00 y 23:00: la de la noche encontraba
   oportunidades que nadie miraba hasta el otro día. Ahora el equipo parte la
   mañana con el listado fresco y lo vuelve a tener a media tarde.

   Convivencia con los otros crones de Mercado Público. Esta búsqueda usa 6
   conexiones; la sincronización del Análisis y el cambio automático de estados
   usan 12 cada uno, y 18 simultáneas quedan demasiado cerca del colapso medido
   de la API (24):
     · con la SINCRONIZACIÓN (23:00): si alguna vez comparten hora, esta
       búsqueda le cede el paso y corre al terminar ella;
     · con el CAMBIO DE ESTADOS (9:00 y 15:00): a las 15:00 comparten hora, y
       ahí es al revés — el cambio de estados espera a que esta búsqueda
       termine (son ~4 min), porque el listado de las 15:00 es lo que el
       equipo está esperando. Ver MpEstadosCron.cederPasoALaExploracion.

   Mismo patrón de reloj que MercadopublicoCron: temporizador propio + Intl con
   zona explícita, porque el servidor corre en UTC y un cron ingenuo se
   correría una hora con cada cambio de horario de verano.
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.MP_EXPLORAR_AUTO_HORAS || '8,15')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

// Cuánto se espera, como máximo, a que la sincronización desocupe la API.
const ESPERA_SYNC_MS = 90 * 60 * 1000; // 90 min: una pasada nocturna holgada
const REVISA_SYNC_MS = 2 * 60 * 1000;

@Injectable()
export class MpExploracionCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MpExploracionCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(
    private readonly licitaciones: LicitacionesService,
    private readonly mpCron: MercadopublicoCron,
  ) {}

  onModuleInit() {
    if (!correTareasDeFondo()) {
      this.log.log(`Exploración automática MP: no corre en este proceso (${MOTIVO_SIN_FONDO}).`);
      return;
    }
    // Mismo interruptor de desarrollo que la sincronización: un backend local
    // encendido no debe gastar la cuota compartida con producción.
    if (String(process.env.MP_EXPLORAR_AUTO || '').toLowerCase() === 'off') {
      this.log.log('Exploración automática DESACTIVADA (MP_EXPLORAR_AUTO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('MP_EXPLORAR_AUTO_HORAS no tiene horas válidas: no se programó ninguna corrida.');
      return;
    }
    this.log.log(
      `Exploración automática activa: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}).`,
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
    if (minuto > 4) return; // misma ventana de 5 min que la sincronización
    const marca = `${fecha}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    await this.correr(`programada ${String(hora).padStart(2, '0')}:00`);
  }

  /** (2026-10-21) Ya no busca desde acá: encola la exploración y el robot
      (worker) la corre y guarda el resultado. No hace falta cederle el paso a
      la sincronización: el limitador global reparte las conexiones. */
  async correr(motivo: string) {
    if (this.corriendo) return { omitida: true };
    this.corriendo = true;
    try {
      const r: any = await this.licitaciones.encolarExploracion(motivo);
      this.log.log(
        r?.encolados
          ? `Exploración ${motivo} encolada (lote ${r.lote}).`
          : `Exploración ${motivo}: ya había una en cola o corriendo.`,
      );
      return r;
    } catch (e: any) {
      this.log.error(`Exploración ${motivo} no se pudo encolar: ${String(e?.message || e)}`);
      return { error: String(e?.message || e) };
    } finally {
      this.corriendo = false;
    }
  }

  estado() {
    return {
      activa: String(process.env.MP_EXPLORAR_AUTO || '').toLowerCase() !== 'off' && HORAS.length > 0,
      horarios: HORAS.map((h) => `${String(h).padStart(2, '0')}:00`),
      zona: ZONA,
      corriendo: this.corriendo,
      ultima_corrida: this.ultima || null,
    };
  }
}
