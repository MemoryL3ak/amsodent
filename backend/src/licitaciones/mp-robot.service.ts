import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LicitacionesService } from './licitaciones.service';
import { MercadopublicoService } from '../mercadopublico/mercadopublico.service';
import { MpColaService, Trabajo } from '../mercadopublico/mp-cola.service';
import { mpLimitador } from '../mercadopublico/mp-limitador';
import { esCuotaAgotada, esTransitorio } from '../mercadopublico/mp-errores';
import { correTareasDeFondo, MOTIVO_SIN_FONDO, rolProceso } from '../rol-proceso';

/* ============================================================================
   Robot de Mercado Público (2026-10-21)
   ----------------------------------------------------------------------------
   El ÚNICO que ejecuta trabajos de la cola `mp_cola`. Corre en el proceso con
   APP_ROL=worker (o todo), nunca en el web. Cada pocos segundos toma los
   trabajos pendientes que quepan en su concurrencia y los procesa en
   paralelo; hacia Mercado Público nunca salen más llamadas que las que
   permite el limitador global (12 a la v2, 1 a la v1), aunque la cola tenga
   miles.

   Qué hace con un fallo:
     · Cuota diaria del ticket agotada → pausa TODO hasta las 00:05 de Chile y
       devuelve el trabajo a la cola sin contarle el intento.
     · Transitorio (504, timeout, «simultáneas») → el trabajo vuelve a la cola
       con espera creciente (2, 5, 10, 20, 40, 60 min). Si se acumulan muchos
       fallos seguidos sin un solo acierto, la API está caída: se pausa 10
       minutos en vez de quemar cuota contra una pared.
     · Otro error → reintento corto; al agotar los intentos queda con error.

   Interruptores: MP_ROBOT=off lo apaga; MP_ROBOT_CONCURRENCIA (default 12)
   cuántos trabajos lleva a la vez; MP_ROBOT_TICK_MS (default 3000).
============================================================================ */

const ZONA = 'America/Santiago';
const TICK_MS = Math.max(1000, Number(process.env.MP_ROBOT_TICK_MS) || 3000);
const CONCURRENCIA = Math.max(1, Math.min(24, Number(process.env.MP_ROBOT_CONCURRENCIA) || 12));
const LATIDO_MS = 20_000;
const MANTENIMIENTO_MS = 5 * 60_000;
const HUERFANO_MS = 10 * 60_000;
/* Fallos transitorios seguidos (sin un acierto en medio) para declarar la API
   caída y pausar. Con 12 en paralelo, 24 son dos tandas enteras sin respuesta,
   el mismo criterio que usaba el cron de estados. */
const SECAS_PARA_PAUSAR = 24;
const PAUSA_API_CAIDA_MS = 10 * 60_000;
const ESPERAS_MIN = [2, 5, 10, 20, 40, 60];

const VERSION =
  (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || process.env.APP_VERSION || 'dev';

@Injectable()
export class MpRobotService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MpRobot');
  private timer: NodeJS.Timeout | null = null;
  private enVuelo = 0;
  private secas = 0;
  private pausadoHasta = 0;
  private cuotaHasta = 0;
  private ultimoLatido = 0;
  private ultimoMantenimiento = 0;
  private tickEnCurso = false;
  private hechos = 0;
  private fallidos = 0;

  constructor(
    private readonly cola: MpColaService,
    private readonly mp: MercadopublicoService,
    private readonly licitaciones: LicitacionesService,
  ) {}

  onModuleInit() {
    if (!correTareasDeFondo()) {
      this.log.log(`Robot de Mercado Público: no corre en este proceso (${MOTIVO_SIN_FONDO}).`);
      return;
    }
    if (String(process.env.MP_ROBOT || '').toLowerCase() === 'off') {
      this.log.log('Robot de Mercado Público DESACTIVADO (MP_ROBOT=off).');
      return;
    }
    this.log.log(`Robot de Mercado Público activo (rol ${rolProceso()}): hasta ${CONCURRENCIA} trabajos a la vez, cada ${TICK_MS} ms.`);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    // Arranque: lo que quedó «en curso» de un proceso anterior vuelve a la cola.
    setTimeout(() => void this.mantenimiento(true), 5_000).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Para el panel: lo que el robot sabe de sí mismo en este instante. */
  estado() {
    return {
      en_vuelo: this.enVuelo,
      concurrencia: CONCURRENCIA,
      hechos: this.hechos,
      fallidos: this.fallidos,
      pausado_hasta: this.pausadoHasta > Date.now() ? new Date(this.pausadoHasta).toISOString() : null,
      cuota_hasta: this.cuotaHasta > Date.now() ? new Date(this.cuotaHasta).toISOString() : null,
      limitador: mpLimitador.estado(),
    };
  }

  // ── Ciclo ────────────────────────────────────────────────────────────────

  private async tick() {
    if (this.tickEnCurso) return;
    this.tickEnCurso = true;
    try {
      const ahora = Date.now();
      if (ahora - this.ultimoLatido > LATIDO_MS) await this.latido();
      if (ahora - this.ultimoMantenimiento > MANTENIMIENTO_MS) await this.mantenimiento(false);
      if (this.pausadoHasta > ahora || this.cuotaHasta > ahora) return;
      const cupo = CONCURRENCIA - this.enVuelo;
      if (cupo <= 0) return;
      const trabajos = await this.cola.tomar(cupo);
      for (const t of trabajos) {
        this.enVuelo += 1;
        void this.procesar(t).finally(() => { this.enVuelo -= 1; });
      }
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 200);
      /* Sin la migración de la cola no hay nada que hacer: se avisa una vez y
         se vuelve a mirar en 5 minutos, en vez de llenar el log cada 3 s. */
      if (/migraci[oó]n|does not exist|schema cache/i.test(msg)) {
        this.pausadoHasta = Date.now() + 5 * 60_000;
        this.log.warn(`Robot en espera 5 min: ${msg}`);
      } else {
        this.log.warn(`Ciclo del robot con error: ${msg}`);
      }
    } finally {
      this.tickEnCurso = false;
    }
  }

  private async latido(extra: Record<string, any> = {}) {
    this.ultimoLatido = Date.now();
    await this.cola.latido({
      version: VERSION,
      concurrencia: CONCURRENCIA,
      en_vuelo: this.enVuelo,
      ...extra,
    });
  }

  private async mantenimiento(arranque: boolean) {
    this.ultimoMantenimiento = Date.now();
    try {
      const rescatados = await this.cola.rescatarHuerfanos(arranque ? 0 : HUERFANO_MS);
      if (rescatados) this.log.log(`${rescatados} trabajo(s) huérfano(s) devueltos a la cola.`);
      if (arranque) await this.cola.limpiar(7);
    } catch (e: any) {
      this.log.warn(`Mantenimiento de la cola falló: ${String(e?.message || e).slice(0, 200)}`);
    }
  }

  // ── Un trabajo ───────────────────────────────────────────────────────────

  private async procesar(t: Trabajo) {
    try {
      const resultado = await this.ejecutar(t);
      await this.cola.terminar(t.id, resultado);
      this.secas = 0;
      this.hechos += 1;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      if (esCuotaAgotada(msg)) {
        this.cuotaHasta = proximaMadrugadaChile();
        await this.cola.reprogramar(t.id, this.cuotaHasta - Date.now(), 'cuota diaria del ticket agotada', { descontarIntento: true });
        await this.latido({ cuota_agotada_hasta: new Date(this.cuotaHasta).toISOString(), nota: msg });
        this.log.warn(`Cuota diaria de Mercado Público agotada: el robot se pausa hasta ${new Date(this.cuotaHasta).toISOString()}.`);
        return;
      }
      if (esTransitorio(msg)) {
        this.secas += 1;
        this.fallidos += 1;
        if (t.intentos >= t.max_intentos) {
          await this.cola.fallar(t.id, msg);
        } else {
          await this.cola.reprogramar(t.id, esperaMs(t.intentos), msg);
        }
        if (this.secas >= SECAS_PARA_PAUSAR && this.pausadoHasta < Date.now()) {
          this.pausadoHasta = Date.now() + PAUSA_API_CAIDA_MS;
          this.secas = 0;
          await this.latido({ api_caida_hasta: new Date(this.pausadoHasta).toISOString(), nota: msg });
          this.log.warn(`Mercado Público no responde (${SECAS_PARA_PAUSAR} fallos seguidos): pausa de ${PAUSA_API_CAIDA_MS / 60000} min.`);
        }
        return;
      }
      this.fallidos += 1;
      if (t.intentos >= t.max_intentos) await this.cola.fallar(t.id, msg);
      else await this.cola.reprogramar(t.id, 5 * 60_000, msg);
      this.log.warn(`Trabajo ${t.tipo} #${t.clave} falló (intento ${t.intentos}): ${msg}`);
    }
  }

  private async ejecutar(t: Trabajo): Promise<any> {
    switch (t.tipo) {
      case 'ficha': {
        const lic = t.payload?.lic && t.payload.lic.id ? t.payload.lic : { id: Number(t.clave) };
        return this.mp.consultarYGuardar(lic);
      }
      case 'estado': {
        const id = Number(t.clave);
        const r: any = await this.licitaciones.diagnosticoMpCotizaciones({ ids: [id], limite: 1 });
        const fila = r?.filas?.[0];
        if (!fila) return { id, error: 'La cotización ya no está entre las candidatas.' };
        // El diagnóstico atrapa sus errores y los deja en la fila: los que son
        // de la API se relanzan para que el robot los reintente.
        if (fila.error && (esTransitorio(fila.error) || esCuotaAgotada(fila.error))) throw new Error(fila.error);
        return fila;
      }
      case 'postulacion': {
        const id = Number(t.clave);
        const r: any = await this.licitaciones.verificarPostulaciones({ ids: [id] });
        const err = r?.errores?.[0];
        if (err && (esTransitorio(err) || esCuotaAgotada(err))) throw new Error(err);
        return {
          id,
          revisadas: r?.revisadas || 0,
          con_postulacion: r?.con_postulacion || 0,
          sin_dato: r?.sin_dato || 0,
          error: err || null,
        };
      }
      default:
        throw new Error(`Tipo de trabajo desconocido: ${t.tipo}`);
    }
  }
}

function esperaMs(intentos: number): number {
  const i = Math.max(0, Math.min(ESPERAS_MIN.length - 1, intentos - 1));
  return ESPERAS_MIN[i] * 60_000;
}

/** Las 00:05 de Chile del día siguiente, en epoch ms (la cuota se renueva a medianoche). */
function proximaMadrugadaChile(): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const hora = v('hour') % 24;
  const minuto = v('minute');
  const faltanMin = (24 - hora - 1) * 60 + (60 - minuto) + 5; // hasta las 00:05
  return Date.now() + faltanMin * 60_000;
}
