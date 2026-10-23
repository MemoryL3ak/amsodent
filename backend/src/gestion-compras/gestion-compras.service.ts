import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BsaleService } from '../bsale/bsale.service';

/* ── Gestión de compras (2026-10-16) ─────────────────────────────────────────
   Pedido de Ariel: "traer todas las cotizaciones adjudicadas (desde ahora en
   adelante) y gestionar el stock de los productos que debemos despachar:
   cantidad a despachar vs. la que tenemos en inventario y el porcentaje que
   tenemos (incluyendo cantidad) vs. lo que deberíamos tener para despachar al
   100 % la cotización".
   · Cotizaciones: estado Adjudicada con fecha_adjudicada desde INICIO (el día
     que nace el módulo; las anteriores no entran).
   · Por despachar: lo cotizado menos lo despachado en las guías registradas
     (leídas de Bsale: BsaleService.pendientePorProducto, el mismo cruce que el
     reporte de Trazabilidad).
   · Stock: productos.stock (el que se sincroniza desde Bsale).
   · El stock se reparte por orden de adjudicación (la más antigua primero):
     dos cotizaciones no cuentan dos veces las mismas unidades. Lo que no
     alcanza es lo que hay que comprar (pestaña «Por comprar», por SKU, con el
     costo para estimar cuánto cuesta).
   · Sin SKU (transitorios) no hay stock que mirar: cuentan como por comprar.
   · Costo por producto (2026-10-23, pedido de Ariel): cada producto del
     detalle lleva el costo neto del catálogo (productos.costo, el mismo que
     usa «Por comprar») y, aparte, el costo congelado en la cotización
     (items_licitacion.costo) para los que no están en el catálogo.
   · Cierre forzado (licitaciones.ciclo_cerrado, 2026-10-22): lo que quedó sin
     despachar ya no se despacha ni se compra. La cotización no toma stock, no
     entra en «Por comprar» y sale con estado «cerrada» (en la pantalla solo con
     el filtro Todas / Cierre forzado), con lo que quedó sin despachar y el
     monto con que se cerró (monto_forzado). */

export const INICIO_GESTION_COMPRAS = '2026-10-16';

const clave = (sku: any, nombre: any) => String(sku || '').trim().toUpperCase() || `#${String(nombre || '').trim().toLowerCase()}`;
const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

@Injectable()
export class GestionComprasService {
  private readonly logger = new Logger(GestionComprasService.name);

  constructor(
    private supabase: SupabaseService,
    private bsale: BsaleService,
  ) {}

  async resumen(desdeIn?: string) {
    const db = this.supabase.getClient();
    const desdePedido = /^\d{4}-\d{2}-\d{2}$/.test(String(desdeIn || '')) ? String(desdeIn) : INICIO_GESTION_COMPRAS;
    const desde = desdePedido < INICIO_GESTION_COMPRAS ? INICIO_GESTION_COMPRAS : desdePedido;
    const avisos: string[] = [];

    // 1. Cotizaciones adjudicadas desde el inicio del módulo.
    const { data: lics, error } = await db
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, rut_entidad, tipo_cliente, vendedor_nombre, vendedor_correo, creado_por, fecha_adjudicada, estado, total_sin_iva, ciclo_cerrado, monto_forzado')
      .eq('estado', 'Adjudicada')
      .gte('fecha_adjudicada', desde)
      .order('fecha_adjudicada', { ascending: true })
      .order('id', { ascending: true })
      .range(0, 5000);
    if (error) throw new BadRequestException(error.message);
    const cotizaciones = (lics || []) as any[];
    if (!cotizaciones.length) return this.vacio(desde, avisos);

    // 2. Cotizado vs. despachado por producto (guías leídas de Bsale).
    let filas: any[] = [];
    try {
      const r: any = await this.bsale.pendientePorProducto(cotizaciones.map((c) => Number(c.id)));
      if (r?.disponible === false) avisos.push(`No se pudo leer lo despachado en Bsale (${r.motivo}): se cuenta todo lo cotizado como por despachar.`);
      filas = r?.filas || [];
      if (r?.guias_no_encontradas?.length) avisos.push(`Guías que no se encontraron en Bsale o están anuladas (no descuentan lo despachado): ${r.guias_no_encontradas.slice(0, 15).join(', ')}${r.guias_no_encontradas.length > 15 ? '…' : ''}.`);
      if (r?.guias_omitidas) avisos.push(`Se omitieron ${r.guias_omitidas} guías por el tope de lectura: lo despachado puede estar incompleto.`);
    } catch (e: any) {
      this.logger.warn(`Gestión de compras: lo despachado no se pudo leer de Bsale: ${e?.message || e}`);
      avisos.push('No se pudo leer lo despachado en Bsale: se cuenta todo lo cotizado como por despachar.');
    }
    if (!filas.length) {
      // Sin Bsale: solo lo cotizado.
      const ids = cotizaciones.map((c) => Number(c.id));
      const { data: items } = await db.from('items_licitacion').select('licitacion_id, sku, producto, formato, cantidad, costo').in('licitacion_id', ids).range(0, 50000);
      const porClave = new Map<string, any>();
      for (const it of (items || []) as any[]) {
        const k = `${it.licitacion_id}|${clave(it.sku, it.producto)}`;
        const f = porClave.get(k) || { licitacion_id: Number(it.licitacion_id), sku: String(it.sku || '').trim(), producto: String(it.producto || ''), formato: String(it.formato || ''), cotizada: 0, despachada: 0, costo: 0, en_cotizacion: true };
        f.cotizada += Number(it.cantidad || 0);
        if (!f.costo) f.costo = Number(it.costo || 0);
        porClave.set(k, f);
      }
      filas = [...porClave.values()].map((f) => ({ ...f, pendiente: f.cotizada }));
    }

    // 3. Stock y costo del catálogo por SKU.
    const skus = [...new Set(filas.map((f) => String(f.sku || '').trim()).filter(Boolean))];
    const catalogo = new Map<string, { stock: number; costo: number; nombre: string }>();
    for (let i = 0; i < skus.length; i += 200) {
      const { data, error: e2 } = await db.from('productos').select('sku, nombre, stock, costo').in('sku', skus.slice(i, i + 200));
      if (e2) throw new BadRequestException(e2.message);
      for (const p of (data || []) as any[]) {
        const k = String(p.sku || '').trim().toUpperCase();
        if (!catalogo.has(k)) catalogo.set(k, { stock: Number(p.stock) || 0, costo: Number(p.costo) || 0, nombre: String(p.nombre || '') });
      }
    }

    // 4. Reparto del stock por orden de adjudicación.
    const restante = new Map<string, number>();
    for (const [k, c] of catalogo) restante.set(k, Math.max(0, c.stock));
    const filasPorLic = new Map<number, any[]>();
    for (const f of filas) {
      if (f.en_cotizacion === false) continue; // despachado fuera de lo cotizado: no se compra
      const l = filasPorLic.get(Number(f.licitacion_id)) || [];
      l.push(f);
      filasPorLic.set(Number(f.licitacion_id), l);
    }
    const compras = new Map<string, any>();
    const salida: any[] = [];
    for (const c of cotizaciones) {
      const cerrada = c.ciclo_cerrado === true;
      const productos = (filasPorLic.get(Number(c.id)) || []).map((f) => {
        const k = String(f.sku || '').trim().toUpperCase();
        const enCatalogo = k ? catalogo.get(k) : undefined;
        const pendiente = Math.max(0, Number(f.pendiente ?? Number(f.cotizada || 0) - Number(f.despachada || 0)));
        let asignado = 0;
        if (!cerrada && k && enCatalogo && pendiente > 0) {
          asignado = Math.min(pendiente, restante.get(k) || 0);
          restante.set(k, (restante.get(k) || 0) - asignado);
        }
        const falta = cerrada ? 0 : pendiente - asignado;
        if (falta > 0) {
          const ck = clave(f.sku, f.producto);
          const e = compras.get(ck) || { sku: String(f.sku || '').trim(), producto: enCatalogo?.nombre || String(f.producto || ''), sin_sku: !k, en_catalogo: !!enCatalogo, stock: enCatalogo ? enCatalogo.stock : null, costo: enCatalogo ? enCatalogo.costo : null, por_despachar: 0, falta: 0, cotizaciones: [] as number[] };
          e.falta += falta;
          if (!e.cotizaciones.includes(Number(c.id))) e.cotizaciones.push(Number(c.id));
          compras.set(ck, e);
        }
        return {
          sku: String(f.sku || '').trim(),
          producto: String(f.producto || '') || enCatalogo?.nombre || '',
          formato: String(f.formato || ''),
          cotizado: Number(f.cotizada || 0),
          despachado: Number(f.despachada || 0),
          por_despachar: pendiente,
          stock: enCatalogo ? enCatalogo.stock : null,
          asignado,
          falta,
          costo: enCatalogo?.costo || null, // costo neto unitario del catálogo (el de «Por comprar»)
          costo_cotizacion: Number(f.costo) || null, // el congelado en el ítem al cotizar
          sin_sku: !k,
          en_catalogo: !!enCatalogo,
          cobertura: cerrada ? 0 : pendiente > 0 ? Math.round((asignado / pendiente) * 1000) / 10 : 100,
        };
      });
      const conPendiente = productos.filter((p) => p.por_despachar > 0);
      // Cerrada: lo que quedó sin despachar se informa, pero no cuenta como por despachar.
      const sinDespachar = conPendiente.reduce((a, p) => a + p.por_despachar, 0);
      const porDespachar = cerrada ? 0 : sinDespachar;
      const asignado = cerrada ? 0 : conPendiente.reduce((a, p) => a + p.asignado, 0);
      const cubiertos = cerrada ? 0 : conPendiente.filter((p) => p.falta <= 0).length;
      const cobertura = cerrada ? 0 : porDespachar > 0 ? Math.round((asignado / porDespachar) * 1000) / 10 : 100;
      const estado = !productos.length ? 'sin_items' : cerrada ? 'cerrada' : porDespachar === 0 ? 'despachada' : cobertura >= 100 ? 'lista' : asignado > 0 ? 'parcial' : 'sin_stock';
      salida.push({
        id: Number(c.id),
        codigo: c.id_licitacion || null,
        cliente: c.nombre_entidad || '',
        rut: c.rut_entidad || '',
        particular: /particular/i.test(String(c.tipo_cliente || '')),
        vendedor: c.vendedor_nombre || c.vendedor_correo || c.creado_por || '',
        fecha_adjudicada: String(c.fecha_adjudicada || '').slice(0, 10),
        neto: Number(c.total_sin_iva) || 0,
        estado,
        cobertura,
        cerrada,
        monto_forzado: cerrada ? Number(c.monto_forzado) || 0 : null,
        unidades: { por_despachar: porDespachar, asignadas: asignado, faltan: porDespachar - asignado, sin_despachar: cerrada ? sinDespachar : 0 },
        productos_pendientes: cerrada ? 0 : conPendiente.length,
        productos_cubiertos: cubiertos,
        productos,
      });
    }
    // El total por despachar de cada SKU (en todas las cotizaciones) para la lista de compras.
    for (const cot of salida) for (const p of cot.productos) {
      if (cot.cerrada) continue; // lo que quedó sin despachar en una cerrada no se va a despachar
      const e = compras.get(clave(p.sku, p.producto));
      if (e) e.por_despachar += p.por_despachar;
    }
    const listaCompras = [...compras.values()]
      .map((e) => ({ ...e, valor_estimado: e.costo ? Math.round(e.costo * e.falta) : null }))
      .sort((a, b) => (b.valor_estimado || 0) - (a.valor_estimado || 0) || b.falta - a.falta);

    const enGestion = salida.filter((c) => c.estado !== 'despachada' && c.estado !== 'sin_items' && c.estado !== 'cerrada');
    const porDespacharTotal = enGestion.reduce((a, c) => a + c.unidades.por_despachar, 0);
    const asignadoTotal = enGestion.reduce((a, c) => a + c.unidades.asignadas, 0);
    return {
      inicio: INICIO_GESTION_COMPRAS,
      desde,
      actualizado_at: new Date().toISOString(),
      hoy: hoyEnChile(),
      kpis: {
        cotizaciones: enGestion.length,
        listas: enGestion.filter((c) => c.estado === 'lista').length,
        despachadas: salida.filter((c) => c.estado === 'despachada').length,
        cerradas: salida.filter((c) => c.estado === 'cerrada').length,
        cobertura: porDespacharTotal > 0 ? Math.round((asignadoTotal / porDespacharTotal) * 1000) / 10 : 100,
        unidades_por_despachar: porDespacharTotal,
        unidades_faltan: porDespacharTotal - asignadoTotal,
        skus_por_comprar: listaCompras.length,
        valor_por_comprar: listaCompras.reduce((a, e) => a + (e.valor_estimado || 0), 0),
        sin_costo: listaCompras.filter((e) => !e.costo).length,
      },
      cotizaciones: salida.reverse(), // la más reciente arriba
      compras: listaCompras,
      avisos,
    };
  }

  private vacio(desde: string, avisos: string[]) {
    return {
      inicio: INICIO_GESTION_COMPRAS, desde, actualizado_at: new Date().toISOString(), hoy: hoyEnChile(),
      kpis: { cotizaciones: 0, listas: 0, despachadas: 0, cerradas: 0, cobertura: 100, unidades_por_despachar: 0, unidades_faltan: 0, skus_por_comprar: 0, valor_por_comprar: 0, sin_costo: 0 },
      cotizaciones: [], compras: [], avisos,
    };
  }
}
