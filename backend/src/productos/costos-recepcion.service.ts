import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ProductosService } from './productos.service';
import { AlertaCosto, DecisionCosto, LineaRecibida, ProductoCosto, alertasDeCosto, costoMayor } from './costos-recepcion';

/* ── Costos por confirmar tras una recepción de stock (2026-11-17) ───────────
   Ver costos-recepcion.ts (la regla). Este servicio lee las recepciones
   registradas, arma las alertas vigentes y aplica lo que se decida desde
   Productos → Actualización de precios → «Costos por confirmar».

   Sin la migración 20261117_recepcion_costo_decision las alertas se calculan
   igual; «definitiva» funciona (cambia el costo y la alerta desaparece sola) y
   «momentánea» pide aplicar la migración, porque no tiene dónde quedar anotada. */

const MIGRACION = 'Falta aplicar la migración 20261117_recepcion_costo_decision.sql en Supabase: sin ella no se puede dejar anotado que el alza de costo es momentánea.';
const TIPO_DOC: Record<string, string> = { guia: 'Guía', factura: 'Factura', despacho_interno: 'Despacho interno', sin_documento: 'Sin documento' };
// «column … does not exist» (42703) no es lo mismo que «relation … does not exist» (42P01): se miran por separado.
const sinColumna = (e: any) => /^(42703|PGRST204)$/.test(String(e?.code || '')) || /column .* does not exist|could not find the '.*' column/i.test(String(e?.message || ''));
const sinTabla = (e: any) => /^(42P01|PGRST205)$/.test(String(e?.code || '')) || /relation .* does not exist|could not find the table/i.test(String(e?.message || ''));

@Injectable()
export class CostosRecepcionService {
  private readonly logger = new Logger(CostosRecepcionService.name);

  constructor(
    private supabase: SupabaseService,
    private productos: ProductosService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  /* Las líneas recibidas más recientes (recepciones registradas), con su cabecera. */
  private async lineasRecientes(productoId?: number): Promise<{ listo: boolean; conDecision: boolean; lineas: LineaRecibida[] }> {
    const leer = (columnas: string) => {
      let q = this.db.from('recepcion_stock_lineas').select(columnas).order('id', { ascending: false });
      if (productoId) q = q.eq('producto_id', productoId);
      return q.limit(productoId ? 50 : 4000);
    };
    const base = 'id, recepcion_id, producto_id, sku, nombre, cantidad, costo_unitario, created_at';
    let conDecision = true;
    let r: any = await leer(`${base}, costo_decision`);
    if (r.error && sinColumna(r.error)) {
      conDecision = false;
      r = await leer(base);
    }
    if (r.error) {
      if (sinTabla(r.error)) return { listo: false, conDecision: false, lineas: [] };
      throw new BadRequestException(r.error.message);
    }
    const filas: any[] = r.data || [];
    const ids = [...new Set(filas.map((f) => Number(f.recepcion_id)).filter(Boolean))];
    const cabeceras = new Map<number, any>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.db
        .from('recepciones_stock')
        .select('id, estado, tipo_documento, documento_numero, proveedor_nombre, usuario_email, created_at')
        .in('id', ids.slice(i, i + 200));
      if (error) throw new BadRequestException(error.message);
      for (const c of data || []) cabeceras.set(Number((c as any).id), c);
    }
    const lineas: LineaRecibida[] = filas
      .filter((f) => cabeceras.get(Number(f.recepcion_id))?.estado === 'registrada')
      .map((f) => {
        const c = cabeceras.get(Number(f.recepcion_id));
        const tipo = TIPO_DOC[String(c?.tipo_documento || '')] || String(c?.tipo_documento || 'Recepción');
        return {
          id: Number(f.id), recepcion_id: Number(f.recepcion_id), producto_id: Number(f.producto_id), sku: f.sku ?? null, nombre: f.nombre ?? null,
          cantidad: Number(f.cantidad) || 0, costo_unitario: Number(f.costo_unitario) || 0, costo_decision: conDecision ? f.costo_decision ?? null : null,
          created_at: f.created_at || null, documento: `${tipo}${c?.documento_numero ? ` N° ${c.documento_numero}` : ''}`,
          proveedor: c?.proveedor_nombre || '', fecha: c?.created_at || f.created_at || null, usuario: c?.usuario_email || '',
        };
      });
    return { listo: true, conDecision, lineas };
  }

  private async productosDe(ids: number[]): Promise<Map<number, ProductoCosto>> {
    const mapa = new Map<number, ProductoCosto>();
    const unicos = [...new Set(ids)];
    for (let i = 0; i < unicos.length; i += 200) {
      const { data, error } = await this.db.from('productos').select('id, sku, nombre, marca, categoria, costo, lista1, lista2, lista3').in('id', unicos.slice(i, i + 200));
      if (error) throw new BadRequestException(error.message);
      for (const p of data || []) mapa.set(Number((p as any).id), p as any);
    }
    return mapa;
  }

  /** Alertas vigentes: productos cuya última recepción llegó con un costo mayor al que tienen. */
  async pendientes(): Promise<{ listo: boolean; con_decision: boolean; mensaje: string | null; alertas: AlertaCosto[] }> {
    const { listo, conDecision, lineas } = await this.lineasRecientes();
    if (!listo) return { listo: false, con_decision: false, mensaje: null, alertas: [] }; // sin recepciones de stock todavía
    const productos = await this.productosDe(lineas.map((l) => l.producto_id));
    return { listo: true, con_decision: conDecision, mensaje: conDecision ? null : MIGRACION, alertas: alertasDeCosto(lineas, productos) };
  }

  /** Aplica la decisión sobre una alerta: definitiva (cambia el costo) o momentánea (lo mantiene). */
  async resolver(body: { linea_id?: number; decision?: string }, usuario: string | null) {
    const lineaId = Number(body?.linea_id);
    const decision = body?.decision === 'definitiva' ? 'definitiva' : body?.decision === 'momentanea' ? 'momentanea' : null;
    if (!Number.isInteger(lineaId) || lineaId <= 0 || !decision) throw new BadRequestException('Indica la alerta y si el cambio de costo es definitivo o momentáneo.');

    const { data: fila, error } = await this.db.from('recepcion_stock_lineas').select('id, producto_id').eq('id', lineaId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!fila) throw new BadRequestException('La recepción de esta alerta ya no existe.');
    const productoId = Number((fila as any).producto_id);

    // La alerta vale mientras esa siga siendo la última recepción del producto y nadie la haya resuelto.
    const { conDecision, lineas } = await this.lineasRecientes(productoId);
    const productos = await this.productosDe([productoId]);
    const vigente = alertasDeCosto(lineas, productos).find((a) => a.producto_id === productoId) || null;
    if (!vigente || vigente.linea_id !== lineaId) {
      throw new ConflictException('Esta alerta ya no está vigente (se resolvió, cambió el costo o llegó una recepción más nueva del producto). Actualiza la lista.');
    }

    if (decision === 'momentanea' && !conDecision) throw new BadRequestException(MIGRACION);

    let costoFinal = vigente.costo_actual;
    if (decision === 'definitiva' && costoMayor(vigente.costo_recepcion, vigente.costo_actual)) {
      // Mismo camino que editar el costo: historial de precios, Bsale y cola del Sheet.
      await this.productos.update(productoId, { costo: vigente.costo_recepcion }, usuario);
      costoFinal = vigente.costo_recepcion;
    }

    let aviso: string | null = null;
    if (conDecision) {
      const { error: errMarca } = await this.db
        .from('recepcion_stock_lineas')
        .update({ costo_decision: decision as DecisionCosto, costo_decision_por: usuario || null, costo_decision_at: new Date().toISOString() })
        .eq('id', lineaId);
      if (errMarca) {
        if (decision === 'momentanea') throw new BadRequestException(sinColumna(errMarca) ? MIGRACION : errMarca.message);
        aviso = 'El costo quedó actualizado, pero no se pudo anotar la decisión en la recepción.';
        this.logger.warn(`Costo de recepción (línea ${lineaId}): ${errMarca.message}`);
      }
    }
    this.logger.log(`Costo de recepción: línea ${lineaId} (${vigente.sku || `producto ${productoId}`}) resuelta como ${decision} por ${usuario || 'sin usuario'}${decision === 'definitiva' ? `: costo ${vigente.costo_actual} → ${costoFinal}` : ''}`);
    return {
      ok: true,
      decision,
      producto_id: productoId,
      sku: vigente.sku,
      costo_anterior: vigente.costo_actual,
      costo: costoFinal,
      mensaje: decision === 'definitiva'
        ? `Costo de ${vigente.sku || vigente.nombre} actualizado: queda en el de la recepción.`
        : `El costo de ${vigente.sku || vigente.nombre} se mantiene: el alza quedó como momentánea.`,
      aviso,
    };
  }
}
