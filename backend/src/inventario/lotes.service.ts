import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Lotes y fechas de vencimiento (2026-11-09)
   ----------------------------------------------------------------------------
   Pedido de Ariel: «cuando cargamos una nueva recepción, se debe ingresar el
   lote y fecha de vencimiento por producto» y «cuando se genere una guía de
   despacho asociada a estos productos, en cada producto desplegar un listbox
   con sus lotes y fechas de vencimiento, para seleccionar una o más
   opciones». El lote y su vencimiento van juntos: un lote es
   producto + código + vencimiento.

   La API de Bsale no maneja lotes (ni en recepciones ni en guías), así que
   viven acá (migración 20261109_lotes_vencimiento):
   · ENTRADA: al registrar una recepción de stock que Bsale aceptó, cada línea
     crea (o reutiliza) su lote y queda enlazada (recepcion_stock_lineas.lote_id).
   · SALIDA: al emitir una guía con lotes elegidos queda una fila por lote en
     inventario_lote_salidas; en la guía de Bsale el lote sale escrito en la
     nota de la línea del producto. Anular la guía devuelve esas unidades.
   · DISPONIBLE = recibido − salidas vigentes. Se calcula al leer (sin
     contadores que se desfasen).
   Los lotes son informativos para el stock: el stock sigue siendo el de
   Bsale / Inventario. Elegir lotes en la guía es opcional; la elección se
   valida (que el lote sea de ese producto y que no sumen más que la línea) y
   lo demás son avisos (lote vencido, más unidades que las disponibles).
============================================================================ */

export const MIGRACION_LOTES = 'Falta aplicar la migración 20261109_lotes_vencimiento.sql en Supabase (lotes y vencimientos).';
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const normSkuLote = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
/** Código de lote como se guarda: mayúsculas, sin espacios repetidos, hasta 40 caracteres. */
export const normLote = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 40);
/** Fecha válida AAAA-MM-DD (existe en el calendario) o null. */
export function fechaValida(v: any): string | null {
  const s = String(v ?? '').slice(0, 10);
  if (!RE_FECHA.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}
export const fechaCorta = (ymd: any) => String(ymd || '').slice(0, 10).split('-').reverse().join('-');
const num = (n: number) => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 2 });
const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export type LoteDisponible = {
  id: number;
  producto_id: number;
  sku: string;
  lote: string;
  vencimiento: string;
  recibido: number;
  despachado: number;
  disponible: number;
};
export type AsignacionLote = { lote_id: number; producto_id: number; sku: string; lote: string; vencimiento: string; cantidad: number };
export type LotesDeLinea = { asignaciones: AsignacionLote[]; texto: string };

/** Lo que va escrito en la línea de la guía. Un lote que cubre la línea: «Lote X · Venc. dd-mm-aaaa»; si no, con las unidades de cada uno. */
export function textoLotes(asignaciones: AsignacionLote[], cantidadLinea: number): string {
  if (!asignaciones.length) return '';
  if (asignaciones.length === 1 && asignaciones[0].cantidad >= cantidadLinea - 1e-9) {
    return `Lote ${asignaciones[0].lote} · Venc. ${fechaCorta(asignaciones[0].vencimiento)}`;
  }
  return asignaciones.map((a) => `Lote ${a.lote} · Venc. ${fechaCorta(a.vencimiento)} (${num(a.cantidad)} u.)`).join(' / ');
}

/** Nota de la línea en la guía de Bsale: los lotes primero y después la observación del producto. */
export const notaConLotes = (texto: string | null | undefined, observacion: string | null | undefined) =>
  [String(texto || '').trim(), String(observacion || '').replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · ');

@Injectable()
export class LotesService {
  private readonly logger = new Logger(LotesService.name);
  private cacheListo: { ts: number; ok: boolean } | null = null;

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    return /(schema cache|does not exist|not find|PGRST205|PGRST204|42P01|42703)/i.test(`${error?.code} ${error?.message}`);
  }

  /** ¿Está aplicada la migración? (se recuerda 5 min si sí; 15 s si no, para notar cuando la apliquen). */
  async listo(): Promise<boolean> {
    const c = this.cacheListo;
    if (c && Date.now() - c.ts < (c.ok ? 5 * 60_000 : 15_000)) return c.ok;
    const [a, b, s] = await Promise.all([
      this.db.from('inventario_lotes').select('id').limit(1),
      this.db.from('recepcion_stock_lineas').select('lote_id, lote, vencimiento').limit(1),
      this.db.from('inventario_lote_salidas').select('id').limit(1),
    ]);
    const ok = !a.error && !b.error && !s.error;
    this.cacheListo = { ts: Date.now(), ok };
    return ok;
  }

  private async enTrozos<T>(ids: any[], leer: (trozo: any[]) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
    const filas: T[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await leer(ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      filas.push(...((data || []) as T[]));
    }
    return filas;
  }

  /**
   * Lotes de cada SKU con lo recibido, lo despachado y lo disponible, del que
   * vence primero al último. Sin `incluirAgotados` solo los que tienen
   * unidades disponibles. Sin la migración devuelve un mapa vacío.
   */
  async porSku(skus: string[], incluirAgotados = false): Promise<Map<string, LoteDisponible[]>> {
    const lista = [...new Set((skus || []).map(normSkuLote).filter(Boolean))];
    const res = new Map<string, LoteDisponible[]>();
    if (!lista.length || !(await this.listo())) return res;
    const lotes = await this.enTrozos<any>(lista, (t) => this.db.from('inventario_lotes').select('id, producto_id, sku, lote, vencimiento').in('sku', t).range(0, 4999));
    if (!lotes.length) return res;
    const ids = lotes.map((l) => Number(l.id));
    const entradas = await this.enTrozos<any>(ids, (t) => this.db.from('recepcion_stock_lineas').select('lote_id, cantidad').in('lote_id', t).range(0, 9999));
    const salidas = await this.enTrozos<any>(ids, (t) => this.db.from('inventario_lote_salidas').select('lote_id, cantidad').in('lote_id', t).is('anulada_at', null).range(0, 9999));
    const recibido = new Map<number, number>();
    for (const e of entradas) recibido.set(Number(e.lote_id), (recibido.get(Number(e.lote_id)) || 0) + (Number(e.cantidad) || 0));
    const despachado = new Map<number, number>();
    for (const s of salidas) despachado.set(Number(s.lote_id), (despachado.get(Number(s.lote_id)) || 0) + (Number(s.cantidad) || 0));
    for (const l of lotes) {
      const id = Number(l.id);
      const r = Math.round((recibido.get(id) || 0) * 100) / 100;
      const d = Math.round((despachado.get(id) || 0) * 100) / 100;
      const fila: LoteDisponible = {
        id, producto_id: Number(l.producto_id), sku: normSkuLote(l.sku), lote: String(l.lote || ''), vencimiento: String(l.vencimiento || '').slice(0, 10),
        recibido: r, despachado: d, disponible: Math.round((r - d) * 100) / 100,
      };
      if (!incluirAgotados && !(fila.disponible > 0)) continue;
      res.set(fila.sku, [...(res.get(fila.sku) || []), fila]);
    }
    for (const arr of res.values()) arr.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.lote.localeCompare(b.lote));
    return res;
  }

  /** Para la pantalla: los lotes con unidades disponibles de cada SKU, en un objeto. */
  async disponiblesPorSku(skus: string[]) {
    const listo = await this.listo();
    const mapa = listo ? await this.porSku(skus) : new Map<string, LoteDisponible[]>();
    const lotes: Record<string, any[]> = {};
    for (const [sku, arr] of mapa) lotes[sku] = arr.map(({ id, lote, vencimiento, recibido, despachado, disponible }) => ({ id, lote, vencimiento, recibido, despachado, disponible }));
    return { listo, hoy: hoyEnChile(), lotes };
  }

  /**
   * Valida los lotes elegidos para las líneas de una guía y arma el texto de
   * cada línea. `pedido`: { [sku]: [{ lote_id, cantidad? }] } (un solo lote
   * sin cantidad = toda la línea). Las líneas con lotes registrados que van
   * sin ninguno solo se avisan.
   */
  async asignar(lineas: { sku: string; cantidad: number }[], pedido: any): Promise<{ porSku: Map<string, LotesDeLinea>; problemas: string[]; avisos: string[] }> {
    const porSku = new Map<string, LotesDeLinea>();
    const problemas: string[] = [];
    const avisos: string[] = [];
    const elegido = new Map<string, any[]>();
    if (pedido && typeof pedido === 'object') {
      for (const k of Object.keys(pedido)) if (Array.isArray(pedido[k]) && pedido[k].length) elegido.set(normSkuLote(k), pedido[k]);
    }
    let mapa: Map<string, LoteDisponible[]>;
    try {
      mapa = await this.porSku(lineas.map((l) => l.sku), true);
    } catch (e: any) {
      if (elegido.size) problemas.push(`No se pudieron leer los lotes: ${String(e?.message || e).slice(0, 160)}`);
      return { porSku, problemas, avisos };
    }
    if (elegido.size && !(await this.listo())) {
      problemas.push(MIGRACION_LOTES);
      return { porSku, problemas, avisos };
    }
    const hoy = hoyEnChile();
    const sinLote: string[] = [];
    for (const linea of lineas) {
      const sku = normSkuLote(linea.sku);
      const cantidadLinea = Number(linea.cantidad) || 0;
      const delSku = mapa.get(sku) || [];
      const pedidos = elegido.get(sku) || [];
      if (!pedidos.length) {
        if (delSku.some((l) => l.disponible > 0)) sinLote.push(sku);
        continue;
      }
      const asignaciones: AsignacionLote[] = [];
      const vistos = new Set<number>();
      let invalida = false;
      for (const p of pedidos) {
        const id = Number(p?.lote_id);
        const lote = delSku.find((l) => l.id === id);
        if (!lote) { problemas.push(`${sku}: uno de los lotes elegidos no es de este producto (o ya no existe). Vuelve a elegirlo.`); invalida = true; break; }
        if (vistos.has(id)) continue;
        vistos.add(id);
        const crudo = p?.cantidad === '' || p?.cantidad == null ? null : Number(p.cantidad);
        const cantidad = crudo == null && pedidos.length === 1 ? cantidadLinea : Number(crudo);
        if (!(cantidad > 0)) { problemas.push(`${sku}: indica cuántas unidades van del lote ${lote.lote}.`); invalida = true; break; }
        asignaciones.push({ lote_id: id, producto_id: lote.producto_id, sku, lote: lote.lote, vencimiento: lote.vencimiento, cantidad: Math.round(cantidad * 100) / 100 });
      }
      if (invalida) continue;
      const suma = asignaciones.reduce((a, x) => a + x.cantidad, 0);
      if (suma > cantidadLinea + 1e-9) {
        problemas.push(`${sku}: los lotes suman ${num(suma)} unidades y la línea lleva ${num(cantidadLinea)}.`);
        continue;
      }
      if (suma < cantidadLinea - 1e-9) avisos.push(`${sku}: ${num(cantidadLinea - suma)} de ${num(cantidadLinea)} unidades van sin lote.`);
      for (const a of asignaciones) {
        const l = delSku.find((x) => x.id === a.lote_id)!;
        if (a.cantidad > l.disponible + 1e-9) avisos.push(`${sku}: del lote ${l.lote} quedan ${num(Math.max(0, l.disponible))} disponibles según las recepciones y van ${num(a.cantidad)}.`);
        if (a.vencimiento < hoy) avisos.push(`${sku}: el lote ${a.lote} está VENCIDO (${fechaCorta(a.vencimiento)}).`);
      }
      // Del que vence primero al último, como en el listbox.
      asignaciones.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.lote.localeCompare(b.lote));
      porSku.set(sku, { asignaciones, texto: textoLotes(asignaciones, cantidadLinea) });
    }
    if (sinLote.length) avisos.push(`${sinLote.length === 1 ? 'Este producto tiene' : 'Estos productos tienen'} lotes registrados y ${sinLote.length === 1 ? 'va' : 'van'} sin lote en la guía: ${sinLote.join(', ')}.`);
    return { porSku, problemas, avisos };
  }

  /** Deja constancia de lo que la guía emitida sacó de cada lote. Devuelve un aviso si no se pudo. */
  async registrarSalidas(
    porSku: Map<string, LotesDeLinea>,
    p: { origen: 'guia_oc' | 'guia_libre' | 'guia_venta_directa'; bsale_document_id: number | null; guia_numero: string | null; licitacion_id: number | null; documento_id: number | null; usuario_email: string | null },
  ): Promise<string | null> {
    const filas = [...porSku.values()].flatMap((l) =>
      l.asignaciones.map((a) => ({
        lote_id: a.lote_id, producto_id: a.producto_id, sku: a.sku, lote: a.lote, vencimiento: a.vencimiento, cantidad: a.cantidad, origen: p.origen,
        bsale_document_id: p.bsale_document_id, guia_numero: p.guia_numero, licitacion_id: p.licitacion_id, documento_id: p.documento_id, usuario_email: p.usuario_email,
      })),
    );
    if (!filas.length) return null;
    const { error } = await this.db.from('inventario_lote_salidas').insert(filas);
    if (error) {
      this.logger.error(`Guía ${p.guia_numero}: no se registraron las salidas de lotes: ${error.message}`);
      return `La guía ${p.guia_numero || ''} lleva los lotes escritos en Bsale, pero no se pudieron descontar de los lotes del sistema (${error.message.slice(0, 120)}).`;
    }
    return null;
  }

  /** Guía anulada en Bsale: sus unidades vuelven a los lotes. Devuelve cuántas salidas se anularon. */
  async anularSalidasDeGuia(bsaleDocumentId: number): Promise<number> {
    if (!(Number(bsaleDocumentId) > 0)) return 0;
    const { data, error } = await this.db
      .from('inventario_lote_salidas')
      .update({ anulada_at: new Date().toISOString() })
      .eq('bsale_document_id', Number(bsaleDocumentId))
      .is('anulada_at', null)
      .select('id');
    if (error) {
      if (!this.sinTabla(error)) this.logger.warn(`Guía ${bsaleDocumentId}: no se devolvieron sus lotes: ${error.message}`);
      return 0;
    }
    return (data || []).length;
  }

  /** Lotes del mismo producto con el mismo código y OTRO vencimiento (para avisar en la recepción). */
  async otrosVencimientos(pares: { producto_id: number; lote: string; vencimiento: string }[]): Promise<{ producto_id: number; lote: string; vencimiento: string; existente: string }[]> {
    if (!pares.length || !(await this.listo())) return [];
    const ids = [...new Set(pares.map((p) => Number(p.producto_id)))];
    const existentes = await this.enTrozos<any>(ids, (t) => this.db.from('inventario_lotes').select('producto_id, lote, vencimiento').in('producto_id', t).range(0, 9999));
    const res: { producto_id: number; lote: string; vencimiento: string; existente: string }[] = [];
    for (const p of pares) {
      const otro = existentes.find((e) => Number(e.producto_id) === Number(p.producto_id) && String(e.lote) === p.lote && String(e.vencimiento).slice(0, 10) !== p.vencimiento);
      if (otro) res.push({ ...p, existente: String(otro.vencimiento).slice(0, 10) });
    }
    return res;
  }

  /**
   * Recepción aceptada por Bsale: crea los lotes que faltan y enlaza cada
   * línea con el suyo (desde ahí cuentan como recibidos). Devuelve los avisos.
   */
  async enlazarRecepcion(lineas: { id: number; producto_id: number; sku: string; lote: string | null; vencimiento: string | null }[]): Promise<string[]> {
    const avisos: string[] = [];
    for (const l of lineas) {
      if (!l.lote || !l.vencimiento) continue;
      try {
        const sku = normSkuLote(l.sku);
        let loteId: number | null = null;
        const buscar = async () => {
          const { data } = await this.db.from('inventario_lotes').select('id').eq('producto_id', l.producto_id).eq('lote', l.lote).eq('vencimiento', l.vencimiento).maybeSingle();
          return data ? Number((data as any).id) : null;
        };
        loteId = await buscar();
        if (!loteId) {
          const { data, error } = await this.db.from('inventario_lotes').insert({ producto_id: l.producto_id, sku, lote: l.lote, vencimiento: l.vencimiento }).select('id').single();
          // Otra recepción pudo crearlo al mismo tiempo (índice único): se vuelve a buscar.
          loteId = error ? await buscar() : Number((data as any).id);
          if (!loteId) throw new Error(error?.message || 'no se pudo crear el lote');
        }
        const { error: eUp } = await this.db.from('recepcion_stock_lineas').update({ lote_id: loteId }).eq('id', l.id);
        if (eUp) throw new Error(eUp.message);
      } catch (e: any) {
        avisos.push(`El lote ${l.lote} de ${l.sku} no quedó registrado en el sistema (${String(e?.message || e).slice(0, 120)}): no aparecerá al emitir guías.`);
      }
    }
    return avisos;
  }
}
