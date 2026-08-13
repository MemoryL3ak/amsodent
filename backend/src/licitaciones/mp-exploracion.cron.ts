import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { LicitacionesService } from './licitaciones.service';
import { MercadopublicoCron } from '../mercadopublico/mercadopublico.cron';

/* ============================================================================
   Exploración automática de Mercado Público
   ----------------------------------------------------------------------------
   Corre la búsqueda del explorador (todo el catálogo de palabras clave, ~90
   términos, ~4 minutos) dos veces al día —14:00 y 23:00 de Chile— y guarda el
   resultado en `mp_exploracion`. La pestaña «Explorar» lee esa fila al abrir:
   instantánea y sin gastar cuota. La búsqueda manual quedó restringida a los
   correos de MP_EXPLORAR_EMAILS justamente porque cada ejecución son ~90
   consultas de una cuota compartida.

   La corrida de las 23:00 convive con la sincronización del Análisis, que
   dispara a la misma hora con 12 conexiones en paralelo. Esta búsqueda usa 6,
   y 18 simultáneas quedan demasiado cerca del colapso medido de la API (24).
   Por eso esta espera: se cede el paso a la sincronización y se corre al
   terminar ella. A las 14:00 no hay nadie más y parte al tiro.

   Mismo patrón de reloj que MercadopublicoCron: temporizador propio + Intl con
   zona explícita, porque el servidor corre en UTC y un cron ingenuo se
   correría una hora con cada cambio de horario de verano.
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.MP_EXPLORAR_AUTO_HORAS || '14,23')
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

  async correr(motivo: string) {
    if (this.corriendo) return { omitida: true };
    this.corriendo = true;
    const t0 = Date.now();
    try {
      /* Ceder el paso a la sincronización del Análisis. El primer respiro de
         90 s existe porque ambos crones despiertan en el mismo minuto: hay que
         darle tiempo a que la sincronización marque `corriendo` antes de
         decidir si está libre. */
      await new Promise((r) => setTimeout(r, 90_000));
      const esperaTope = Date.now() + ESPERA_SYNC_MS;
      while (this.mpCron.estado().corriendo && Date.now() < esperaTope) {
        await new Promise((r) => setTimeout(r, REVISA_SYNC_MS));
      }
      if (this.mpCron.estado().corriendo) {
        this.log.warn(`Exploración ${motivo}: la sincronización lleva 90 min ocupando la API; se corre igual.`);
      }

      this.log.log(`Inicio de exploración ${motivo}.`);
      const r: any = await this.licitaciones.explorarYGuardar(motivo);
      const min = Math.round((Date.now() - t0) / 60000);
      this.log.log(
        r?.guardado
          ? `Fin de exploración ${motivo}: ${r.items} procesos de ${r.palabras} palabras · ${min} min.`
          : `Exploración ${motivo} sin guardar: ${r?.motivo || 'sin detalle'}.`,
      );
      return r;
    } catch (e: any) {
      this.log.error(`Exploración ${motivo} interrumpida: ${String(e?.message || e)}`);
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
