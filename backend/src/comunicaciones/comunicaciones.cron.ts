import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ComunicacionesService } from './comunicaciones.service';

/**
 * Cron jobs de comunicaciones.
 * - Cada minuto: procesa correos programados que ya vencieron.
 * - Cada 15 minutos: revisa cotizaciones próximas a vencer y dispara recordatorios.
 *
 * Si el backend corre en múltiples instancias hay riesgo de doble envío. La
 * mitigación está en `procesarProgramados`: hace un UPDATE condicional a
 * 'procesando' antes de enviar; si otra instancia ya lo tomó, el UPDATE no
 * afecta filas y la instancia actual lo salta.
 */
@Injectable()
export class ComunicacionesCronService {
  private readonly logger = new Logger(ComunicacionesCronService.name);

  constructor(private comunicaciones: ComunicacionesService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tickProgramados() {
    try {
      const r = await this.comunicaciones.procesarProgramados();
      if (r.procesados > 0) {
        this.logger.log(
          `Programados: procesados=${r.procesados}, enviados=${r.enviados}, fallidos=${r.fallidos}`,
        );
      }
    } catch (e: any) {
      this.logger.error(`tickProgramados error: ${e?.message}`);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tickProximosVencer() {
    try {
      const r = await this.comunicaciones.procesarProximosVencer();
      if (r.revisadas > 0) {
        this.logger.log(`Próximos a vencer: revisadas=${r.revisadas}, disparados=${r.disparados}`);
      }
    } catch (e: any) {
      this.logger.error(`tickProximosVencer error: ${e?.message}`);
    }
  }
}
