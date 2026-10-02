import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LicitacionesService } from './licitaciones.service';
import { MpExploracionCron } from './mp-exploracion.cron';

/* ============================================================================
   Análisis global de productos MP, automático (2026-10-02)
   ----------------------------------------------------------------------------
   El panel "Análisis global de productos (sin haber licitado)" dependía de
   que alguien autorizado apretara «Actualizar análisis», y si esa corrida
   fallaba o se cortaba, la pantalla quedaba vacía sin decir por qué. Ahora se
   corre sola una vez al día (06:00 de Chile por defecto), cuando ningún otro
   cron usa la API (exploración 08:00 y 15:00, estados 09:00 y 15:00,
   sincronización 23:00). Gasta ~110 llamadas del ticket.

   MP_ANALISIS_GLOBAL_AUTO=off lo apaga (en un backend local debe estar
   apagado: la cuota es compartida con producción). MP_ANALISIS_GLOBAL_HORA
   cambia la hora. Mismo reloj que los otros crones: temporizador propio +
   Intl con zona explícita.
============================================================================ */

const ZONA = 'America/Santiago';
const HORA = Number(process.env.MP_ANALISIS_GLOBAL_HORA ?? 6);
const ESPERA_EXPLORACION_MS = 30 * 60 * 1000;

@Injectable()
export class MpAnalisisGlobalCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MpAnalisisGlobalCron');
  private timer: NodeJS.Timeout | null = null;
  private ultima = '';

  constructor(
    private readonly licitaciones: LicitacionesService,
    private readonly exploracion: MpExploracionCron,
  ) {}

  onModuleInit() {
    this.licitaciones.registrarAutomaticoAnalisisGlobal(() => this.estado());
    if (!this.activa()) {
      this.log.log('Análisis global automático DESACTIVADO (MP_ANALISIS_GLOBAL_AUTO=off).');
      return;
    }
    if (!Number.isInteger(HORA) || HORA < 0 || HORA > 23) {
      this.log.warn('MP_ANALISIS_GLOBAL_HORA no es una hora válida: no se programó la corrida.');
      return;
    }
    this.log.log(`Análisis global automático activo: ${String(HORA).padStart(2, '0')}:00 (${ZONA}).`);
    this.timer = setInterval(() => void this.revisar(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private activa(): boolean {
    return String(process.env.MP_ANALISIS_GLOBAL_AUTO || '').toLowerCase() !== 'off';
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
    const { fecha, hora, minuto } = this.ahoraEnChile();
    if (hora !== HORA || minuto > 4) return;
    const marca = `${fecha}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    await this.correr(`programada ${String(HORA).padStart(2, '0')}:00`);
  }

  async correr(motivo: string) {
    try {
      // Por si alguna vez coincide con la exploración: no se le quita la API.
      const tope = Date.now() + ESPERA_EXPLORACION_MS;
      while (this.exploracion.estado().corriendo && Date.now() < tope) {
        await new Promise((r) => setTimeout(r, 60_000));
      }
      if (this.licitaciones.analisisGlobalEnCurso) {
        this.log.log(`Análisis global ${motivo}: ya hay uno corriendo; se omite.`);
        return { omitida: true };
      }
      this.log.log(`Inicio del análisis global ${motivo}.`);
      return this.licitaciones.iniciarAnalisisProductosGlobalSinGate(motivo);
    } catch (e: any) {
      this.log.error(`Análisis global ${motivo} no se pudo iniciar: ${String(e?.message || e)}`);
      return { error: String(e?.message || e) };
    }
  }

  estado() {
    return {
      activa: this.activa() && Number.isInteger(HORA) && HORA >= 0 && HORA <= 23,
      hora: `${String(HORA).padStart(2, '0')}:00`,
      zona: ZONA,
      ultima_corrida: this.ultima || null,
    };
  }
}
