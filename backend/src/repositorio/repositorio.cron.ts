import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { correTareasDeFondo, MOTIVO_SIN_FONDO } from '../rol-proceso';
import { esRolAdmin } from '../auth/permisos';
import { diasEntre, hoyEnChile } from './repositorio.service';

/* ============================================================================
   Vigencia de los documentos del repositorio (2026-11-05)
   ----------------------------------------------------------------------------
   Una vez al día (09:00 de Chile) revisa los documentos con fecha de
   vencimiento y avisa en la campana a quienes gestionan el repositorio (los
   administradores; desde 2026-11-06 solo ellos suben y editan):

     a 30 días · a 15 días · a 7 días · el día que vence (y ya vencido)

   Cada (documento, hito, fecha de vencimiento) se avisa UNA sola vez: el
   dedupe se lee de los avisos anteriores (tipo documento_por_vencer). Si el
   documento se renueva (cambia su vencimiento), el calendario parte de nuevo.
   Si el backend estuvo caído el día justo, se avisa el hito más avanzado
   alcanzado al día siguiente que corra.

   Mismo patrón de reloj que los otros crones. Interruptores:
     REPOSITORIO_AVISO=off    → apagado (ej. backend local de desarrollo)
     REPOSITORIO_HORAS=9      → hora(s) de Chile en que revisa
============================================================================ */

const ZONA = 'America/Santiago';
const HORAS = String(process.env.REPOSITORIO_HORAS || '9')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);

// De más lejano a más cercano: se avisa el más avanzado que ya se alcanzó.
const HITOS: { key: string; dias: number }[] = [
  { key: 'd30', dias: 30 },
  { key: 'd15', dias: 15 },
  { key: 'd7', dias: 7 },
  { key: 'vence', dias: 0 },
];

const fechaCL = (ymd: string) => ymd.split('-').reverse().join('-');

/* Hito que corresponde avisar hoy para un vencimiento dado, o null. */
export function hitoDe(diasRestantes: number): { key: string; dias: number } | null {
  let alcanzado: { key: string; dias: number } | null = null;
  for (const h of HITOS) if (diasRestantes <= h.dias) alcanzado = h;
  return alcanzado;
}

export function mensajeVigencia(nombre: string, diasRestantes: number, vence: string): string {
  if (diasRestantes < 0) return `El documento «${nombre}» venció el ${fechaCL(vence)} (hace ${-diasRestantes} día${diasRestantes === -1 ? '' : 's'}): renuévalo en el Repositorio de documentos.`;
  if (diasRestantes === 0) return `El documento «${nombre}» vence HOY (${fechaCL(vence)}): renuévalo en el Repositorio de documentos.`;
  return `El documento «${nombre}» vence en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'} (${fechaCL(vence)}).`;
}

@Injectable()
export class RepositorioCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RepositorioCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    if (!correTareasDeFondo()) {
      this.log.log(`Vigencia del repositorio: no corre en este proceso (${MOTIVO_SIN_FONDO}).`);
      return;
    }
    if (String(process.env.REPOSITORIO_AVISO || '').toLowerCase() === 'off') {
      this.log.log('Vigencia del repositorio DESACTIVADA (REPOSITORIO_AVISO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('REPOSITORIO_HORAS no tiene horas válidas: no se programó la revisión de vigencia.');
      return;
    }
    this.log.log(`Vigencia del repositorio activa: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}).`);
    this.timer = setInterval(() => void this.revisar(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private ahoraEnChile() {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const v = (t: string) => partes.find((p) => p.type === t)?.value || '';
    return { hora: Number(v('hour')) % 24, minuto: Number(v('minute')) };
  }

  private async revisar() {
    if (this.corriendo) return;
    const { hora, minuto } = this.ahoraEnChile();
    if (!HORAS.includes(hora) || minuto > 4) return;
    const hoy = hoyEnChile();
    const marca = `${hoy}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    this.corriendo = true;
    try {
      const n = await this.avisar(hoy);
      if (n) this.log.log(`Vigencia del repositorio: ${n} aviso(s) creados.`);
    } catch (e: any) {
      this.log.warn(`Vigencia del repositorio falló: ${e?.message || e}`);
    } finally {
      this.corriendo = false;
    }
  }

  /* Quiénes gestionan el repositorio: los administradores. */
  private async destinatarios(): Promise<string[]> {
    const db = this.supabase.getClient();
    const { data: perfiles } = await db.from('profiles').select('email, rol');
    const lista = ((perfiles || []) as any[])
      .filter((p) => esRolAdmin(String(p?.rol || '').trim().toLowerCase()))
      .map((p) => String(p?.email || '').trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
    return [...new Set(lista)];
  }

  /* Crea los avisos que correspondan hoy. Devuelve cuántos. Público para poder probarlo. */
  async avisar(hoy: string): Promise<number> {
    const db = this.supabase.getClient();
    const { data: docs, error } = await db
      .from('repositorio_documentos')
      .select('id, nombre, categoria, fecha_vencimiento')
      .not('fecha_vencimiento', 'is', null)
      .range(0, 999);
    if (error) return 0; // sin la migración no hay nada que revisar
    const pendientes = ((docs || []) as any[])
      .map((d) => {
        const vence = String(d.fecha_vencimiento).slice(0, 10);
        const dias = diasEntre(hoy, vence);
        return { doc: d, vence, dias, hito: hitoDe(dias) };
      })
      .filter((x) => x.hito);
    if (!pendientes.length) return 0;

    // Lo ya avisado (documento + hito + vencimiento) en los últimos 120 días.
    const desde = new Date(Date.now() - 120 * 86400000).toISOString();
    const { data: previos } = await db
      .from('notificaciones')
      .select('metadata')
      .eq('tipo', 'documento_por_vencer')
      .gte('creado_at', desde)
      .range(0, 4999);
    const avisados = new Set(((previos || []) as any[]).map((n) => `${n?.metadata?.documento_id}|${n?.metadata?.hito}|${n?.metadata?.fecha_vencimiento}`));

    const nuevos = pendientes.filter((x) => !avisados.has(`${x.doc.id}|${x.hito!.key}|${x.vence}`));
    if (!nuevos.length) return 0;
    const destinatarios = await this.destinatarios();
    if (!destinatarios.length) return 0;

    const filas = nuevos.flatMap((x) =>
      destinatarios.map((user_email) => ({
        user_email,
        tipo: 'documento_por_vencer',
        mensaje: mensajeVigencia(x.doc.nombre, x.dias, x.vence),
        link: '/repositorio-documentos',
        metadata: { documento_id: x.doc.id, nombre: x.doc.nombre, hito: x.hito!.key, fecha_vencimiento: x.vence, dias_restantes: x.dias },
      })),
    );
    const { error: errInsert } = await db.from('notificaciones').insert(filas);
    if (errInsert) throw new Error(errInsert.message);
    return filas.length;
  }
}
