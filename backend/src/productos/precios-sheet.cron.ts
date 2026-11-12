import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PreciosSheetService } from './precios-sheet.service';
import { correTareasDeFondo, MOTIVO_SIN_FONDO } from '../rol-proceso';

/* ── Repaso de la cola de precios → Google Sheet (2026-11-12) ────────────────
   Los cambios de precio se envían al Sheet a los pocos segundos, en el proceso
   que los recibió. Este repaso (cada 5 minutos, en el worker) es la red de
   seguridad: recoge lo que quedó pendiente porque Google falló o el proceso se
   reinició antes de enviar. Sin cuenta de servicio no hace nada. */

const CADA_MS = 5 * 60_000;

@Injectable()
export class PreciosSheetCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PreciosSheetCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;

  constructor(private readonly precios: PreciosSheetService) {}

  onModuleInit() {
    if (!correTareasDeFondo()) {
      this.log.log(`Repaso del Sheet de precios: no corre en este proceso (${MOTIVO_SIN_FONDO}).`);
      return;
    }
    this.timer = setInterval(() => void this.revisar(), CADA_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async revisar() {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      const r = await this.precios.enviarPendientes();
      if (r.estado === 'error') this.log.warn(`Repaso del Sheet de precios: ${r.mensaje}`);
    } catch (e: any) {
      this.log.warn(`Repaso del Sheet de precios: ${e?.message || e}`);
    } finally {
      this.corriendo = false;
    }
  }
}
