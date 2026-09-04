import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ActividadesService } from './actividades.service';

/* ── Importación automática Google Calendar → bitácora (pedido 2026-09-04) ──
   Cada 5 minutos revisa el calendario de cada cuenta de Google conectada en
   «Mi Correo» (con permiso de Calendar) e importa como actividades los
   eventos con invitados que no haya creado el propio sistema. Es el RESPALDO:
   además, abrir la bitácora importa la cuenta propia al instante
   (POST /actividades/importar-calendar). Las reglas de filtrado y el dedupe
   viven en ActividadesService.importarDesdeCalendar().

   Interruptor: CALENDAR_SYNC_AUTO=off lo desactiva (útil en desarrollo local
   para no competir con el backend de producción por la misma base). */
const INTERVALO_MS = 5 * 60 * 1000;

@Injectable()
export class CalendarSyncCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CalendarSyncCron.name);
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;

  constructor(private actividades: ActividadesService) {}

  onModuleInit() {
    if (String(process.env.CALENDAR_SYNC_AUTO || '').toLowerCase() === 'off') {
      this.log.log('Importación de Google Calendar a la bitácora DESACTIVADA (CALENDAR_SYNC_AUTO=off).');
      return;
    }
    this.log.log('Importación de Google Calendar a la bitácora activa: cada 5 minutos (+ al abrir la bitácora).');
    // Primera pasada al minuto de arrancar (deja respirar el arranque de Nest).
    this.timer = setInterval(() => void this.correr(), INTERVALO_MS);
    setTimeout(() => void this.correr(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async correr() {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      const r = await this.actividades.importarDesdeCalendar();
      if (r.importadas > 0 || r.errores.length > 0) {
        this.log.log(
          `Calendar → bitácora: ${r.importadas} actividad(es) importada(s) de ${r.cuentas} cuenta(s)` +
            (r.errores.length ? ` · errores: ${r.errores.join(' | ')}` : ''),
        );
      }
    } catch (e: any) {
      this.log.warn(`Importación de Calendar falló: ${String(e?.message || e).slice(0, 160)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
