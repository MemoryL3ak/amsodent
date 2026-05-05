import { Injectable, Logger } from '@nestjs/common';

export type FeriadoRow = {
  fecha: string; // YYYY-MM-DD
  year: number;
  nombre: string;
  tipo: string | null;
  irrenunciable: boolean;
};

type CacheEntry = {
  feriados: FeriadoRow[];
  fetchedAt: number; // ms timestamp
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STALE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — si la API cae, seguimos usando esto
const BOOSTR_URL = (year: number) => `https://api.boostr.cl/holidays/${year}.json`;

@Injectable()
export class FeriadosService {
  private readonly logger = new Logger(FeriadosService.name);
  private memoryCache = new Map<number, CacheEntry>();

  async getYear(year: number): Promise<FeriadoRow[]> {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return [];

    const cached = this.memoryCache.get(y);
    const ahora = Date.now();
    if (cached && ahora - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.feriados;
    }

    try {
      const fromApi = await this.fetchFromBoostr(y);
      if (fromApi.length > 0) {
        this.memoryCache.set(y, { feriados: fromApi, fetchedAt: ahora });
        return fromApi;
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo obtener feriados ${y} desde boostr.cl: ${err?.message || err}`,
      );
    }

    // API falló — si tenemos algo viejo (hasta 30 días) lo seguimos sirviendo.
    if (cached && ahora - cached.fetchedAt < STALE_TTL_MS) {
      return cached.feriados;
    }
    return [];
  }

  private async fetchFromBoostr(year: number): Promise<FeriadoRow[]> {
    const res = await fetch(BOOSTR_URL(year), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} en ${BOOSTR_URL(year)}`);
    }
    const json = (await res.json()) as any;
    const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];

    const feriados: FeriadoRow[] = [];
    for (const item of data) {
      const fecha = String(item?.date || '').slice(0, 10);
      const nombre = String(item?.title || item?.nombre || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !nombre) continue;
      if (Number(fecha.slice(0, 4)) !== year) continue;
      feriados.push({
        fecha,
        year,
        nombre,
        tipo: item?.type ? String(item.type) : null,
        irrenunciable: Boolean(item?.inalienable),
      });
    }
    return feriados;
  }
}
