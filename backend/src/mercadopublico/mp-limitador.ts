/* ============================================================================
   Limitador global de llamadas a Mercado Público (2026-10-21)
   ----------------------------------------------------------------------------
   Antes cada cron y cada pantalla llevaba su propia concurrencia (12 la
   sincronización, 6 la exploración, 12 la verificación de postulaciones, 1 el
   diagnóstico de estados…) y se coordinaban "cediéndose el paso" por horario.
   Si dos coincidían, sumaban más de las 24 conexiones con las que la API se
   cae entera. Con un solo semáforo por host en el proceso, da lo mismo
   cuántos trabajos corran a la vez: hacia Mercado Público nunca salen más de
   las permitidas.

   Dos límites porque son dos APIs distintas:
     · api2.mercadopublico.cl (v2, Compra Ágil): lenta (12-29 s) pero aguanta
       12 en paralelo (medido: 7 de 12 responden; a 24 se cae).
     · api.mercadopublico.cl (v1, licitaciones y OC): rápida (segundos) pero
       responde 429 «peticiones simultáneas» con el mismo ticket en paralelo,
       así que va de a UNA con una pausa corta entre llamadas.

   Se ajusta sin desplegar: MP_CONCURRENCIA (v2, default 12) y
   MP_CONCURRENCIA_V1 (default 1).
============================================================================ */

type Tarea<T> = () => Promise<T>;

class Semaforo {
  private enUso = 0;
  private cola: Array<() => void> = [];
  private ultimaSalida = 0;

  constructor(
    public readonly nombre: string,
    public readonly maximo: number,
    /** Pausa mínima entre el fin de una llamada y el inicio de la siguiente. */
    public readonly pausaMs = 0,
  ) {}

  get ocupados() { return this.enUso; }
  get esperando() { return this.cola.length; }

  async con<T>(fn: Tarea<T>): Promise<T> {
    await this.tomar();
    try {
      return await fn();
    } finally {
      this.soltar();
    }
  }

  private tomar(): Promise<void> {
    if (this.enUso < this.maximo) {
      this.enUso += 1;
      return this.esperarPausa();
    }
    return new Promise<void>((resolve) => {
      this.cola.push(() => {
        this.enUso += 1;
        void this.esperarPausa().then(resolve);
      });
    });
  }

  private async esperarPausa() {
    if (!this.pausaMs) return;
    const falta = this.ultimaSalida + this.pausaMs - Date.now();
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  }

  private soltar() {
    this.enUso = Math.max(0, this.enUso - 1);
    this.ultimaSalida = Date.now();
    const sig = this.cola.shift();
    if (sig) sig();
  }
}

function entero(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : def;
}

const V2 = new Semaforo('v2', entero(process.env.MP_CONCURRENCIA, 12, 1, 24));
const V1 = new Semaforo('v1', entero(process.env.MP_CONCURRENCIA_V1, 1, 1, 6), 1200);

function semaforoPara(url: string): Semaforo {
  return /api2\.mercadopublico\.cl/i.test(url) ? V2 : V1;
}

export const mpLimitador = {
  /** Ejecuta `fn` cuando haya cupo para ese host. */
  con<T>(url: string, fn: Tarea<T>): Promise<T> {
    return semaforoPara(url).con(fn);
  },
  /** Para el latido del robot y el panel de monitoreo. */
  estado() {
    return {
      v2: { maximo: V2.maximo, ocupados: V2.ocupados, esperando: V2.esperando },
      v1: { maximo: V1.maximo, ocupados: V1.ocupados, esperando: V1.esperando },
    };
  },
};
