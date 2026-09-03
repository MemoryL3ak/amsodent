import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BsaleService } from './bsale.service';

/* ============================================================================
   Sincronización automática de stock con Bsale
   ----------------------------------------------------------------------------
   Corre a las horas configuradas (Chile) si hay token. Mismo patrón de reloj
   que los otros crones: temporizador de 60 s + Intl con zona explícita
   (el servidor corre en UTC), ventana de 5 minutos y marca por día@hora para
   no repetir. Interruptores (.env):
     BSALE_SYNC_AUTO=off        → apagado (ej. backend local de desarrollo)
     BSALE_SYNC_AUTO_HORAS=7,13 → horas de Chile en que sincroniza (default 7 y 13)
============================================================================ */

const ZONA = 'America/Santiago';

const HORAS = String(process.env.BSALE_SYNC_AUTO_HORAS || '7,13')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

@Injectable()
export class BsaleCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BsaleCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(private readonly bsale: BsaleService) {}

  onModuleInit() {
    if (String(process.env.BSALE_SYNC_AUTO || '').toLowerCase() === 'off') {
      this.log.log('Sincronización automática con Bsale DESACTIVADA (BSALE_SYNC_AUTO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('BSALE_SYNC_AUTO_HORAS no tiene horas válidas: no se programó la sincronización.');
      return;
    }
    this.log.log(
      `Sincronización Bsale activa: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}).`,
    );
    this.timer = setInterval(() => void this.revisar(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  estado() {
    return {
      activa: this.timer != null,
      horas: HORAS,
      ultima_corrida: this.ultima || null,
    };
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
    if (!HORAS.includes(hora) || minuto >= 5) return; // ventana de 5 min
    const marca = `${fecha}@${hora}`;
    if (this.ultima === marca) return;
    this.corriendo = true;
    this.ultima = marca;
    try {
      const r: any = await this.bsale.sincronizar();
      this.log.log(`Corrida automática Bsale (${marca}): ${r?.actualizados ?? 0} stocks actualizados.`);
    } catch (e: any) {
      // Sin token o API caída: se anota y se reintenta en la próxima ventana.
      this.log.warn(`Corrida automática Bsale (${marca}) falló: ${e?.message || e}`);
    } finally {
      this.corriendo = false;
    }
  }
}
