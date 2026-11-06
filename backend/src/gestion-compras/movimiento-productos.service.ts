import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BsaleService } from '../bsale/bsale.service';

/* ============================================================================
   Movimiento diario de productos (2026-11-06)
   ----------------------------------------------------------------------------
   Pedido de Ariel: "En abastecimiento, crear un módulo de movimiento de
   productos diarios. Esto se debe basar en la creación de las guías de
   despacho según la fecha de creación".

   Qué productos salieron cada día y cuántas unidades, según las guías de
   despacho electrónicas (SII 52) emitidas en Bsale, por su fecha de emisión.
   Se leen directo de Bsale (BsaleService.guiasEmitidas) para no perder las
   guías que nadie registró en una cotización; las anuladas se listan pero no
   suman. El nombre del producto sale del catálogo (por SKU) y cada guía se
   cruza por número con la cotización donde está registrada, si lo está.

   Sin fechas: los últimos 7 días. Tope por consulta: 62 días (cada 50 guías
   es una llamada a Bsale).
============================================================================ */

const MAX_DIAS = 62;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const sumarDias = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const claveDe = (sku: string, nombre: string) => sku.toUpperCase() || `#${nombre.toLowerCase()}`;

type ProductoMov = { clave: string; sku: string; producto: string; producto_id: number | null; unidades: number; neto: number; guias: string[] };

@Injectable()
export class MovimientoProductosService {
  private readonly logger = new Logger(MovimientoProductosService.name);

  constructor(
    private supabase: SupabaseService,
    private bsale: BsaleService,
  ) {}

  async diario(desdeIn?: string, hastaIn?: string) {
    const hoy = hoyEnChile();
    let hasta = RE_FECHA.test(String(hastaIn || '')) ? String(hastaIn) : hoy;
    if (hasta > hoy) hasta = hoy;
    let desde = RE_FECHA.test(String(desdeIn || '')) ? String(desdeIn) : sumarDias(hasta, -6);
    if (desde > hasta) desde = hasta;
    if (sumarDias(desde, MAX_DIAS) < hasta) desde = sumarDias(hasta, -MAX_DIAS);
    const base = { desde, hasta, hoy, max_dias: MAX_DIAS };

    let leido: Awaited<ReturnType<BsaleService['guiasEmitidas']>>;
    try {
      leido = await this.bsale.guiasEmitidas(desde, hasta);
    } catch (e: any) {
      this.logger.warn(`Movimiento diario: no se pudieron leer las guías de Bsale: ${e?.message || e}`);
      throw new BadRequestException(`No se pudieron leer las guías de despacho en Bsale: ${String(e?.message || e).slice(0, 200)}`);
    }
    if (!leido.disponible) return { disponible: false, motivo: leido.motivo, ...base, dias: [], productos: [], totales: null };
    const guias = leido.guias.filter((g) => g.fecha && g.fecha >= desde && g.fecha <= hasta);
    const db = this.supabase.getClient();

    // Nombre (e id) del producto en el catálogo, por SKU.
    const skus = [...new Set<string>(guias.flatMap((g) => g.items.map((i: any) => String(i.sku || '').trim())).filter(Boolean))];
    const catalogo = new Map<string, { id: number; nombre: string }>();
    for (let i = 0; i < skus.length; i += 200) {
      const { data, error } = await db.from('productos').select('id, sku, nombre').in('sku', skus.slice(i, i + 200));
      if (error) { this.logger.warn(`Movimiento diario: no se pudo leer el catálogo: ${error.message}`); break; }
      for (const p of (data || []) as any[]) {
        const k = String(p.sku || '').trim().toUpperCase();
        if (k && !catalogo.has(k)) catalogo.set(k, { id: Number(p.id), nombre: String(p.nombre || '') });
      }
    }

    // Cotización donde está registrada cada guía (por número).
    const numeros = [...new Set<string>(guias.map((g) => g.numero).filter(Boolean))];
    const cotizacionDe = new Map<string, number>();
    for (let i = 0; i < numeros.length; i += 150) {
      const { data, error } = await db.from('licitacion_documentos').select('licitacion_id, numero').eq('tipo', 'guia_despacho').in('numero', numeros.slice(i, i + 150)).range(0, 9999);
      if (error) { this.logger.warn(`Movimiento diario: no se pudieron cruzar las guías con las cotizaciones: ${error.message}`); break; }
      for (const d of (data || []) as any[]) if (!cotizacionDe.has(String(d.numero))) cotizacionDe.set(String(d.numero), Number(d.licitacion_id));
    }

    const sumar = (m: Map<string, ProductoMov>, it: any, numero: string) => {
      const sku = String(it.sku || '').trim();
      const enCatalogo = sku ? catalogo.get(sku.toUpperCase()) : undefined;
      const nombre = enCatalogo?.nombre || String(it.producto || '').trim() || sku || 'Sin nombre';
      const clave = claveDe(sku, nombre);
      const p = m.get(clave) || { clave, sku, producto: nombre, producto_id: enCatalogo?.id ?? null, unidades: 0, neto: 0, guias: [] as string[] };
      p.unidades += Number(it.cantidad) || 0;
      p.neto += Number(it.neto) || 0;
      if (!p.guias.includes(numero)) p.guias.push(numero);
      m.set(clave, p);
    };
    const ordenados = (m: Map<string, ProductoMov>) => [...m.values()].map((p) => ({ ...p, neto: Math.round(p.neto) })).sort((a, b) => b.unidades - a.unidades || a.producto.localeCompare(b.producto, 'es'));

    const porDia = new Map<string, any[]>();
    for (const g of guias) porDia.set(g.fecha, [...(porDia.get(g.fecha) || []), g]);
    const periodo = new Map<string, ProductoMov & { dias: Set<string> }>();
    const dias = [...porDia.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, lista]) => {
        const vigentes = lista.filter((g) => !g.anulada);
        const productos = new Map<string, ProductoMov>();
        for (const g of vigentes) {
          for (const it of g.items) {
            sumar(productos, it, g.numero);
            sumar(periodo as any, it, g.numero);
          }
        }
        for (const p of productos.values()) {
          const total = periodo.get(p.clave)!;
          total.dias = total.dias || new Set<string>();
          total.dias.add(fecha);
        }
        const listaProductos = ordenados(productos);
        return {
          fecha,
          guias: vigentes.length,
          anuladas: lista.length - vigentes.length,
          productos: listaProductos.length,
          unidades: listaProductos.reduce((a, p) => a + p.unidades, 0),
          neto: Math.round(vigentes.reduce((a, g) => a + g.neto, 0)),
          detalle_productos: listaProductos,
          detalle_guias: [...lista]
            .sort((a, b) => Number(a.numero) - Number(b.numero))
            .map((g) => ({
              id: g.id, numero: g.numero, cliente: g.cliente, rut: g.rut, sucursal: g.sucursal, anulada: g.anulada, neto: Math.round(g.neto),
              lineas: g.items.length, unidades: g.items.reduce((a: number, i: any) => a + (Number(i.cantidad) || 0), 0),
              url_pdf: g.url_pdf, generada: g.generada, cotizacion_id: cotizacionDe.get(g.numero) ?? null,
            })),
        };
      });

    const productos = [...periodo.values()]
      .map((p) => ({ clave: p.clave, sku: p.sku, producto: p.producto, producto_id: p.producto_id, unidades: p.unidades, neto: Math.round(p.neto), guias: p.guias.length, dias: p.dias?.size || 0 }))
      .sort((a, b) => b.unidades - a.unidades || a.producto.localeCompare(b.producto, 'es'));
    return {
      disponible: true,
      ...base,
      dias,
      productos,
      totales: {
        dias: dias.length,
        guias: dias.reduce((a, d) => a + d.guias, 0),
        anuladas: dias.reduce((a, d) => a + d.anuladas, 0),
        productos: productos.length,
        unidades: productos.reduce((a, p) => a + p.unidades, 0),
        neto: dias.reduce((a, d) => a + d.neto, 0),
      },
    };
  }
}
