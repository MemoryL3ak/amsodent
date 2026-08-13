import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MercadopublicoService } from './mercadopublico.service';

/* ============================================================================
   Sincronización automática con Mercado Público
   ----------------------------------------------------------------------------
   Corre una vez al día, a las 23:00 hora de Chile, para que el panel de
   Análisis amanezca al día sin que nadie tenga que quedarse mirando la barra
   de progreso: una pasada completa toma cerca de una hora porque la API
   responde una ficha cada ~25 s. De noche además responde mejor.

   Va en modo NORMAL, no «forzar». La sincronización normal ya cubre todo lo
   que puede cambiar —cotizaciones nuevas y procesos todavía abiertos— y salta
   los que ya están cerrados, que por definición no cambian. En régimen son
   ~250 consultas por noche en vez de ~1.575: «forzar» volvería a pedir cada
   noche las ~300 fichas cerradas para recibir exactamente lo mismo. «Forzar»
   sirve para rellenar un campo nuevo en fichas antiguas, que es algo puntual
   y para eso está el botón de la pantalla.

   Por qué un temporizador propio y no @nestjs/schedule: hacía falta fijar la
   zona horaria de forma explícita. El servidor de producción corre en UTC, así
   que un cron ingenuo dispararía a las 19:00 de Chile, y encima se correría
   una hora dos veces al año con el horario de verano. Preguntando la hora
   local a Intl no hay nada que ajustar en abril ni en septiembre.
============================================================================ */

const ZONA = 'America/Santiago';

/* Horarios y modo se leen del entorno para poder ajustarlos en Railway sin
   desplegar: si la cuota diaria del ticket resulta ser más chica de lo que
   aguanta esto, se corrige en caliente.
     MP_SYNC_AUTO_HORAS=23      → una corrida;  "13,23" → dos
     MP_SYNC_AUTO_FORZAR=true   → re-consulta también los procesos cerrados */
const HORAS = String(process.env.MP_SYNC_AUTO_HORAS || '23')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

const FORZAR = String(process.env.MP_SYNC_AUTO_FORZAR || '').toLowerCase() === 'true';

const LOTE = 12;
// 200 × 12 = 2.400 fichas: más que el total de cotizaciones con código de
// Mercado Público. Es un tope de seguridad para que un bug no deje al proceso
// consultando toda la noche, no un límite que se espere alcanzar.
const MAX_TANDAS = 200;

@Injectable()
export class MercadopublicoCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MercadoPublicoCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  // Marca "AAAA-MM-DD@hora" de la última corrida, para no repetir el disparo
  // dentro de la misma ventana de minutos.
  private ultima = '';

  constructor(private readonly mp: MercadopublicoService) {}

  onModuleInit() {
    // Interruptor para que un backend de desarrollo no consuma la cuota diaria
    // del ticket, que es compartida con la de producción.
    if (String(process.env.MP_SYNC_AUTO || '').toLowerCase() === 'off') {
      this.log.log('Sincronización automática DESACTIVADA (MP_SYNC_AUTO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('MP_SYNC_AUTO_HORAS no tiene horas válidas: no se programó ninguna corrida.');
      return;
    }
    this.log.log(
      `Sincronización automática activa: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} ` +
      `(${ZONA}), modo ${FORZAR ? 'FORZAR (incluye procesos ya cerrados)' : 'normal'}.`,
    );
    this.timer = setInterval(() => void this.revisar(), 60_000);
    // El intervalo no debe impedir que el proceso termine si Node quiere salir.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Fecha y hora en Chile, sin depender de la zona del servidor. */
  private ahoraEnChile() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const v = (t: string) => partes.find((p) => p.type === t)?.value || '';
    return {
      fecha: `${v('year')}-${v('month')}-${v('day')}`,
      hora: Number(v('hour')),
      minuto: Number(v('minute')),
    };
  }

  private async revisar() {
    if (this.corriendo) return;
    const { fecha, hora, minuto } = this.ahoraEnChile();
    if (!HORAS.includes(hora)) return;
    // Ventana de 5 minutos: si el servidor estaba reiniciándose justo a las
    // 13:00 en punto, la corrida no se pierde.
    if (minuto > 4) return;
    const marca = `${fecha}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    await this.correr(`programada ${hora}:00`);
  }

  /** Pasada completa, en tandas, hasta vaciar la cola. */
  async correr(motivo: string) {
    if (this.corriendo) {
      this.log.warn(`Se omite la corrida ${motivo}: ya hay una en curso.`);
      return { omitida: true };
    }
    this.corriendo = true;
    const t0 = Date.now();
    let consultadas = 0;
    let guardadas = 0;
    let finalizadas = 0;
    let errores = 0;
    let cuotaAgotada = false;
    // Tandas seguidas sin guardar ni una ficha: la API no está respondiendo.
    let secas = 0;
    let apiCaida = false;
    let restantes = 0;
    try {
      this.log.log(`Inicio de sincronización ${motivo} (modo ${FORZAR ? 'forzar' : 'normal'}).`);
      for (let i = 0; i < MAX_TANDAS; i++) {
        const r: any = await this.mp.sincronizar({ lote: LOTE, forzar: FORZAR });
        consultadas += r?.consultadas || 0;
        guardadas += r?.actualizadas || 0;
        finalizadas += r?.finalizadas || 0;
        errores += r?.errores?.length || 0;
        cuotaAgotada = !!r?.cuota_agotada;
        restantes = r?.restantes || 0;
        secas = r?.actualizadas ? 0 : secas + 1;
        // Sin cuota no sirve seguir; sin pendientes ni consultas, terminó.
        if (cuotaAgotada || !r?.restantes || !r?.consultadas) break;
        /* 10 tandas = 120 intentos sin una sola ficha. De noche la API suele
           responder bien, así que si llega hasta acá está caída de verdad y no
           tiene sentido seguir toda la madrugada quemando cuota. Es más
           tolerante que la pantalla (5) porque acá nadie está esperando. */
        if (secas >= 10) { apiCaida = true; break; }
      }
      const min = Math.round((Date.now() - t0) / 60000);
      this.log.log(
        `Fin de sincronización ${motivo}: ${guardadas} guardadas de ${consultadas} consultadas · ` +
        `${finalizadas} con resultado final · ${errores} con error · ${min} min` +
        `${cuotaAgotada ? ' · CUOTA DIARIA AGOTADA' : ''}` +
        `${apiCaida ? ` · CORTADA: la API no responde, quedan ${restantes}` : ''}.`,
      );
      return { consultadas, guardadas, finalizadas, errores, cuota_agotada: cuotaAgotada, api_caida: apiCaida, restantes, minutos: min };
    } catch (e: any) {
      this.log.error(`Sincronización ${motivo} interrumpida: ${String(e?.message || e)}`);
      return { consultadas, finalizadas, errores, error: String(e?.message || e) };
    } finally {
      this.corriendo = false;
    }
  }

  estado() {
    return {
      activa: String(process.env.MP_SYNC_AUTO || '').toLowerCase() !== 'off' && HORAS.length > 0,
      horarios: HORAS.map((h) => `${String(h).padStart(2, '0')}:00`),
      modo: FORZAR ? 'forzar' : 'normal',
      zona: ZONA,
      corriendo: this.corriendo,
      ultima_corrida: this.ultima || null,
    };
  }
}
