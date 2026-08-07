import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================
   Integración con las APIs oficiales de Mercado Público para
   comparar NUESTRAS postulaciones contra la oferta GANADORA.

   - Compra Ágil (códigos *-COT##): API v2
     GET https://api2.mercadopublico.cl/v2/compra-agil/{codigo}
     header `ticket`. Desde estado "cerrada" expone TODAS las
     cotizaciones (proveedores_cotizando[]) con montos y precios
     unitarios por producto → comparación completa.
   - Licitaciones (LE/LP/LQ/LR...): API clásica v1
     GET https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json
     ?codigo=...&ticket=...  → tras la adjudicación entrega, por ítem,
     el proveedor ganador y su monto unitario (no expone al resto de
     los oferentes).

   Config (.env): MP_API_TICKET (ticket de acceso, se pide en
   chilecompra.cl/api con Clave Única) y MP_RUT_EMPRESA (RUT con el
   que postulamos, para detectar si la oferta ganadora fue la nuestra).
   Resultados persistidos en mp_resultados (upsert por licitacion_id).
============================================================ */

const V2_BASE = 'https://api2.mercadopublico.cl';
const V1_BASE = 'https://api.mercadopublico.cl/servicios/v1/publico';

// Estados desde los cuales el proceso ya no cambia (no se vuelve a consultar).
const ESTADOS_FINALES = new Set([
  'proveedor_seleccionado', 'oc_emitida', 'adjudicada', 'desierta', 'cancelada', 'revocada', 'suspendida',
  'no_encontrada',
]);

// Máximo de procesos consultados por sincronización (la API tiene cuota diaria).
const MAX_CONSULTAS_POR_SYNC = 25;

// Solo analizamos cotizaciones internas de los últimos N días.
const DIAS_VENTANA = 240;

const RE_CODIGO_MP = /^\d{1,10}-\d{1,10}-[A-Z]{1,3}\d{2}$/i;

function normRut(raw: unknown): string {
  return String(raw || '').replace(/[^0-9kK]/g, '').toUpperCase();
}

function esNuestro(rut: unknown, rutEmpresa: string): boolean {
  const a = normRut(rut);
  return !!a && !!rutEmpresa && a === rutEmpresa;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// fetch con timeout: una request colgada no puede estancar la sincronización.
async function fetchConTimeout(url: string, init: any = {}, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

@Injectable()
export class MercadopublicoService {
  private readonly logger = new Logger(MercadopublicoService.name);

  constructor(private supabase: SupabaseService) {}

  private get ticket(): string {
    // Se aceptan ambos nombres de variable (MERCADO_PUBLICO_TICKET fue el
    // usado al pegar el ticket por primera vez).
    return (process.env.MP_API_TICKET || process.env.MERCADO_PUBLICO_TICKET || '').trim();
  }

  private get rutEmpresa(): string {
    return normRut(process.env.MP_RUT_EMPRESA || '');
  }

  estado() {
    return {
      ticket_configurado: !!this.ticket,
      rut_configurado: !!this.rutEmpresa,
      rut_empresa: process.env.MP_RUT_EMPRESA || null,
      max_consultas_por_sync: MAX_CONSULTAS_POR_SYNC,
    };
  }

  /* ── Resultados para el panel (mp_resultados + datos internos) ── */
  async resultados() {
    const client = this.supabase.getClient();
    const { data: res, error } = await client
      .from('mp_resultados')
      .select('*')
      .order('consultado_at', { ascending: false })
      .range(0, 5000);
    if (error) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(error.message)
          ? 'Falta aplicar la migración 20260807_mp_resultados.sql en Supabase.'
          : error.message,
      );
    }
    const lista = res || [];
    if (lista.length === 0) return [];

    const ids = lista.map((r: any) => r.licitacion_id);
    const { data: lics } = await client
      .from('licitaciones')
      .select('id, id_licitacion, nombre, nombre_entidad, estado, total_con_iva, total_sin_iva, vendedor_nombre, creado_por, fecha, created_at')
      .in('id', ids);
    const porId = new Map((lics || []).map((l: any) => [l.id, l]));

    return lista.map((r: any) => ({ ...r, interna: porId.get(r.licitacion_id) || null }));
  }

  /* ── Sincronización: consulta la API para los procesos pendientes ──
     Rango configurable (desde/hasta, fecha de creación de la cotización
     interna, formato YYYY-MM-DD); sin rango usa los últimos DIAS_VENTANA días. */
  async sincronizar(body?: { desde?: string; hasta?: string; lote?: number }) {
    if (!this.ticket) {
      throw new BadRequestException(
        'Falta configurar MP_API_TICKET en el backend. El ticket se solicita gratis en chilecompra.cl/api con Clave Única.',
      );
    }
    const client = this.supabase.getClient();

    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const desdeParam = reFecha.test(String(body?.desde || '')) ? `${body!.desde}T00:00:00` : null;
    const hastaParam = reFecha.test(String(body?.hasta || '')) ? `${body!.hasta}T23:59:59.999` : null;
    const desde = desdeParam || new Date(Date.now() - DIAS_VENTANA * 24 * 3600 * 1000).toISOString();

    // Cotizaciones internas candidatas: código con formato Mercado Público.
    let query = client
      .from('licitaciones')
      .select('id, id_licitacion, nombre, total_con_iva, total_sin_iva, created_at')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .range(0, 2000);
    if (hastaParam) query = query.lte('created_at', hastaParam);
    const { data: lics, error: errLics } = await query;
    if (errLics) throw new BadRequestException(errLics.message);

    const candidatas = (lics || []).filter((l: any) => RE_CODIGO_MP.test(String(l.id_licitacion || '').trim()));

    // Estado ya conocido: los procesos con estado final no se re-consultan, y
    // los no finales consultados hace poco tampoco (evita quemar cuota
    // re-preguntando lo mismo en tandas seguidas de la misma sincronización).
    const { data: previos, error: errPrev } = await client
      .from('mp_resultados')
      .select('licitacion_id, estado_mp, consultado_at')
      .range(0, 10000);
    if (errPrev) {
      throw new BadRequestException(
        /does not exist|schema cache/i.test(errPrev.message)
          ? 'Falta aplicar la migración 20260807_mp_resultados.sql en Supabase.'
          : errPrev.message,
      );
    }
    const previoPorId = new Map((previos || []).map((p: any) => [p.licitacion_id, p]));
    const FRESCURA_MS = 6 * 3600 * 1000; // 6 horas

    const pendientesTotales = candidatas
      .filter((l: any) => {
        const prev: any = previoPorId.get(l.id);
        if (!prev) return true; // nunca consultado
        if (ESTADOS_FINALES.has(String(prev.estado_mp || ''))) return false;
        const hace = Date.now() - new Date(prev.consultado_at || 0).getTime();
        return hace > FRESCURA_MS;
      })
      // Nunca consultados primero; luego los consultados hace más tiempo.
      .sort((a: any, b: any) => {
        const pa: any = previoPorId.get(a.id);
        const pb: any = previoPorId.get(b.id);
        if (!pa && pb) return -1;
        if (pa && !pb) return 1;
        if (!pa && !pb) return 0;
        return new Date(pa.consultado_at || 0).getTime() - new Date(pb.consultado_at || 0).getTime();
      });

    const lote = Math.max(1, Math.min(MAX_CONSULTAS_POR_SYNC, Number(body?.lote) || MAX_CONSULTAS_POR_SYNC));
    const pendientes = pendientesTotales.slice(0, lote);

    let consultadas = 0;
    let actualizadas = 0;
    let finalizadas = 0;
    let cuotaAgotada = false;
    const errores: string[] = [];

    // Pool de 4 consultas en paralelo: baja el sync de ~2 min a ~20-30 s sin
    // gatillar límites de tasa (la cuota del ticket es por cantidad diaria).
    const CONCURRENCIA = 4;
    for (let i = 0; i < pendientes.length && !cuotaAgotada; i += CONCURRENCIA) {
      const lote = pendientes.slice(i, i + CONCURRENCIA);
      await Promise.all(lote.map(async (lic: any) => {
        const codigo = String(lic.id_licitacion).trim();
        const esCompraAgil = /-COT\d{2}$/i.test(codigo);
        try {
          consultadas += 1;
          const fila = esCompraAgil
            ? await this.consultarCompraAgil(codigo, lic)
            : await this.consultarLicitacion(codigo, lic);
          if (!fila) return;
          const { error: errUp } = await client
            .from('mp_resultados')
            .upsert([fila], { onConflict: 'licitacion_id' });
          if (errUp) throw new Error(errUp.message);
          actualizadas += 1;
          if (fila.estado_mp && ESTADOS_FINALES.has(fila.estado_mp)) finalizadas += 1;
        } catch (e: any) {
          const msg = String(e?.message || e);
          errores.push(`${codigo}: ${msg.slice(0, 140)}`);
          // Cuota diaria agotada: no tiene sentido seguir consultando hoy.
          if (/429|límite de solicitudes/i.test(msg)) cuotaAgotada = true;
        }
      }));
    }

    return {
      rango: { desde: desdeParam || desde.slice(0, 10), hasta: hastaParam ? hastaParam.slice(0, 10) : null },
      candidatas: candidatas.length,
      pendientes: pendientes.length,
      // Procesos que quedaron SIN consultar en esta pasada (tope por cuota).
      restantes: Math.max(0, pendientesTotales.length - consultadas),
      consultadas,
      actualizadas,
      finalizadas,
      cuota_agotada: cuotaAgotada,
      errores,
    };
  }

  /* ── Compra Ágil (API v2) ── */
  private async consultarCompraAgil(codigo: string, lic: any) {
    const res = await fetchConTimeout(`${V2_BASE}/v2/compra-agil/${encodeURIComponent(codigo)}`, {
      headers: { ticket: this.ticket },
    });
    const body: any = await res.json().catch(() => null);
    if (res.status === 404) return this.filaSinProceso(codigo, lic, 'compra_agil');
    if (!res.ok || body?.success !== 'OK') {
      const msg = body?.errors?.[0]?.mensaje || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    const p = body.payload || {};
    const rutEmpresa = this.rutEmpresa;

    const cotizaciones = (Array.isArray(p.proveedores_cotizando) ? p.proveedores_cotizando : []).map((c: any) => ({
      rut: c.rut_proveedor || null,
      nombre: c.razon_social || null,
      es_emt: c.es_emt === true,
      nuestra: esNuestro(c.rut_proveedor, rutEmpresa),
      seleccionado: c?.seleccion?.proveedor_seleccionado === true,
      estado_por_comprador: c.estado_por_comprador ?? c?.estado_cotizacion?.glosa ?? null,
      inadmisible: !!c.justificacion_inadmisibilidad,
      justificacion_inadmisibilidad: c.justificacion_inadmisibilidad || null,
      valor_neto: num(c.valor_neto),
      total_impuesto: num(c.total_impuesto),
      monto_despacho: num(c.monto_despacho),
      monto_total: num(c.monto_total),
      fecha: c.fecha_creacion || null,
      productos: (Array.isArray(c.productos_cotizados) ? c.productos_cotizados : []).map((it: any) => ({
        codigo_producto: it.codigo_producto ?? null,
        nombre: it.nombre_producto || it.descripcion || null,
        cantidad: num(it.cantidad),
        precio_unitario: num(it.precio_unitario),
        monto_total: num(it.monto_total_producto),
      })),
    }));

    const nuestra = cotizaciones.find((c: any) => c.nuestra) || null;
    const estadoMp = String(p?.estado?.codigo || '').toLowerCase() || null;
    const haySeleccion = estadoMp === 'proveedor_seleccionado' || estadoMp === 'oc_emitida' || !!p?.orden_compra?.id_orden_compra;

    // Ganador: flag oficial; respaldo por glosa; y patrón observado en la API
    // real: en procesos con proveedor seleccionado, el ÚNICO cotizante con
    // estado_por_comprador no nulo (códigos "1"/"2"/"4" según criterio) es el
    // seleccionado — verificado contra procesos adjudicados nuestros.
    let ganadora = cotizaciones.find((c: any) => c.seleccionado);
    if (!ganadora) {
      ganadora = cotizaciones.find((c: any) => /selec|adjudic|acept|ganad/i.test(String(c.estado_por_comprador || '')));
    }
    if (!ganadora && haySeleccion) {
      const conEstado = cotizaciones.filter(
        (c: any) => c.estado_por_comprador != null && String(c.estado_por_comprador).trim() !== '' && !c.inadmisible,
      );
      if (conEstado.length === 1) ganadora = conEstado[0];
    }

    // Comparación por producto entre nuestra oferta y la ganadora.
    const comparacionItems: any[] = [];
    if (nuestra && ganadora && !ganadora.nuestra) {
      const ganPorCodigo = new Map<string, any>(
        ganadora.productos.map((it: any) => [String(it.codigo_producto), it] as [string, any]),
      );
      for (const mio of nuestra.productos) {
        const suyo = ganPorCodigo.get(String(mio.codigo_producto));
        comparacionItems.push({
          codigo_producto: mio.codigo_producto,
          nombre: mio.nombre || suyo?.nombre || null,
          nuestro_precio: mio.precio_unitario,
          precio_ganador: suyo?.precio_unitario ?? null,
          nuestra_cantidad: mio.cantidad,
          cantidad_ganador: suyo?.cantidad ?? null,
          diferencia:
            mio.precio_unitario != null && suyo?.precio_unitario != null
              ? mio.precio_unitario - suyo.precio_unitario
              : null,
        });
      }
    }

    return {
      licitacion_id: lic.id,
      codigo_mp: codigo,
      tipo: 'compra_agil',
      estado_mp: estadoMp,
      estado_glosa: p?.estado?.glosa || null,
      participamos: cotizaciones.length > 0 ? !!nuestra : null,
      ganamos: haySeleccion ? (ganadora ? !!ganadora.nuestra : (nuestra ? null : false)) : null,
      ganador_rut: ganadora?.rut || null,
      ganador_nombre: ganadora?.nombre || null,
      ganador_es_emt: ganadora ? ganadora.es_emt : null,
      monto_nuestro: nuestra?.monto_total ?? num(lic.total_con_iva),
      monto_ganador: ganadora?.monto_total ?? null,
      total_ofertas: num(p?.resumen?.total_ofertas_recibidas) ?? cotizaciones.length,
      presupuesto_clp: num(p?.presupuesto?.monto_disponible_clp) ?? num(p?.presupuesto?.presupuesto_estimado),
      organismo: p?.institucion?.organismo_comprador || null,
      fecha_cierre: p?.fechas?.fecha_cierre || null,
      detalle: {
        cotizaciones,
        comparacion_items: comparacionItems,
        productos_solicitados: p?.productos_solicitados || [],
        convocatoria: p?.convocatoria || null,
        motivos: p?.motivos || null,
        oc: p?.orden_compra || null,
      },
      consultado_at: new Date().toISOString(),
    };
  }

  /* ── Licitación (API clásica v1) ── */
  private async consultarLicitacion(codigo: string, lic: any) {
    const url = `${V1_BASE}/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(this.ticket)}`;
    const res = await fetchConTimeout(url);
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const det = body?.Listado?.[0];
    if (!det) return this.filaSinProceso(codigo, lic, 'licitacion');

    // CodigoEstado: 5 Publicada · 6 Cerrada · 7 Desierta · 8 Adjudicada · 18 Revocada · 19 Suspendida
    const cod = Number(det.CodigoEstado);
    const estadoMp =
      cod === 8 ? 'adjudicada'
      : cod === 7 ? 'desierta'
      : cod === 6 ? 'cerrada'
      : cod === 5 ? 'publicada'
      : cod === 18 ? 'revocada'
      : cod === 19 ? 'suspendida'
      : String(det.Estado || '').toLowerCase() || null;

    const items = det?.Items?.Listado || [];
    const rutEmpresa = this.rutEmpresa;
    const porProveedor = new Map<string, { rut: string; nombre: string; monto: number; items: number }>();
    const comparacionItems: any[] = [];
    let montoNuestroAdj = 0;

    for (const it of items) {
      const adj = it?.Adjudicacion;
      if (!adj?.RutProveedor) continue;
      const rut = normRut(adj.RutProveedor);
      const cantidad = num(adj.CantidadAdjudicada) ?? num(it.Cantidad) ?? 0;
      const monto = (num(adj.MontoUnitario) || 0) * (cantidad || 0);
      const prev = porProveedor.get(rut) || { rut: adj.RutProveedor, nombre: adj.NombreProveedor || '', monto: 0, items: 0 };
      prev.monto += monto;
      prev.items += 1;
      porProveedor.set(rut, prev);
      if (rut === rutEmpresa) montoNuestroAdj += monto;
      comparacionItems.push({
        codigo_producto: it.CodigoProducto ?? it.Correlativo ?? null,
        nombre: it.NombreProducto || it.Descripcion || null,
        cantidad_ganador: cantidad,
        precio_ganador: num(adj.MontoUnitario),
        ganador_rut: adj.RutProveedor,
        ganador_nombre: adj.NombreProveedor || null,
        ganado_por_nosotros: rut === rutEmpresa,
      });
    }

    const adjudicados = [...porProveedor.values()].sort((a, b) => b.monto - a.monto);
    const principal = adjudicados[0] || null;
    const ganamosAlgo = adjudicados.some((a) => normRut(a.rut) === rutEmpresa);
    const esAdjudicada = cod === 8;

    return {
      licitacion_id: lic.id,
      codigo_mp: codigo,
      tipo: 'licitacion',
      estado_mp: estadoMp,
      estado_glosa: det.Estado || null,
      participamos: null, // la API v1 no expone a los oferentes no adjudicados
      ganamos: esAdjudicada ? ganamosAlgo : null,
      ganador_rut: principal?.rut || null,
      ganador_nombre: principal?.nombre || null,
      ganador_es_emt: null,
      monto_nuestro: num(lic.total_con_iva),
      monto_ganador: esAdjudicada ? adjudicados.reduce((s, a) => s + a.monto, 0) : null,
      total_ofertas: num(det.CantidadOfertas) ?? null,
      presupuesto_clp: num(det.MontoEstimado),
      organismo: det?.Comprador?.NombreOrganismo || null,
      fecha_cierre: det?.Fechas?.FechaCierre || null,
      detalle: {
        adjudicados_por_proveedor: adjudicados,
        comparacion_items: comparacionItems,
        monto_nuestro_adjudicado: montoNuestroAdj,
        nota: 'La API de licitaciones solo expone la adjudicación (ganadores por ítem); las demás ofertas no son públicas por API.',
      },
      consultado_at: new Date().toISOString(),
    };
  }

  // El código no existe en la API (proceso muy antiguo o ID no MP real).
  private filaSinProceso(codigo: string, lic: any, tipo: string) {
    return {
      licitacion_id: lic.id,
      codigo_mp: codigo,
      tipo,
      estado_mp: 'no_encontrada',
      estado_glosa: 'No encontrada en Mercado Público',
      participamos: null,
      ganamos: null,
      ganador_rut: null,
      ganador_nombre: null,
      ganador_es_emt: null,
      monto_nuestro: num(lic.total_con_iva),
      monto_ganador: null,
      total_ofertas: null,
      presupuesto_clp: null,
      organismo: null,
      fecha_cierre: null,
      detalle: null,
      consultado_at: new Date().toISOString(),
    };
  }
}
