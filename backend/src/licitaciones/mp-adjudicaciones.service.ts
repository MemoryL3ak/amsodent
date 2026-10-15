import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Adjudicaciones por evidencia de Mercado Público (2026-10-15)
   ----------------------------------------------------------------------------
   Un solo lugar para cambiar el estado de una cotización cuando Mercado
   Público (o una orden de compra en la mano) ya resolvió el proceso:

     · aplicarEstado      → Adjudicada / Perdida / Descartada, con bitácora.
                            Al adjudicar, las VERSIONES hermanas del mismo
                            proceso que siguen abiertas pasan a "Descartada".
     · porOrdenCargada    → una OC cargada en la cotización = adjudicada.
     · descartarHermanas  → la regla de versiones, también por separado.

   Por qué la regla de versiones: un proceso de Compra Ágil tiene UNA ficha
   en Mercado Público, pero acá puede tener varias cotizaciones (la original
   y sus versiones -1, -2…). Cuando se gana, se gana con una de ellas; las
   demás quedaban "En espera" para siempre y parecía que el cambio automático
   no funcionaba (p. ej. 2129-92-COT26: la hija con la OC adjudicada y la
   madre abierta). Solo se tocan versiones "puras" (el código solo, o el
   código seguido de un número); una cotización con otro texto en el código
   («… - COTIZACION DIRECTA») es otra cosa y no se descarta sola.
============================================================================ */

export const ESTADOS_ABIERTOS = ['En espera', 'Pendiente Aprobación', 'Pendiente Aprobación Peso'];
const ESTADOS_APLICABLES = ['Adjudicada', 'Perdida', 'Descartada'];
const RE_BASE = /^\s*(\d{3,}-\d{1,6}-[A-Z]{2,3}\d{2})/i;

export type CambioEstadoMp = { id: number; estado: string; fecha?: string | null; motivo?: string | null };

/** Código base del proceso (sin sufijo de versión), en mayúsculas, o null. */
export function baseDeCodigo(codigo: unknown): string | null {
  const m = RE_BASE.exec(String(codigo || ''));
  return m ? m[1].toUpperCase() : null;
}

/** ¿El código es el proceso solo o una versión pura (-1, - 2, " 1")? */
export function esVersionPura(codigo: unknown, base: string): boolean {
  const texto = String(codigo || '').trim();
  if (!texto.toUpperCase().startsWith(base.toUpperCase())) return false;
  const resto = texto.slice(base.length).trim();
  return resto === '' || /^[-–—]?\s*\d{1,2}$/.test(resto);
}

const hoyIso = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class MpAdjudicacionesService {
  private readonly log = new Logger('MpAdjudicaciones');

  constructor(private supabase: SupabaseService) {}

  /* Aplica estados. `email` queda en la bitácora de cada cotización. Con
     `opciones.hermanas !== false`, cada "Adjudicada" descarta las versiones
     hermanas abiertas del mismo proceso. */
  async aplicarEstado(
    body: { cambios: CambioEstadoMp[] },
    email?: string,
    opciones: { hermanas?: boolean; comentario?: string } = {},
  ) {
    const cambios = (Array.isArray(body?.cambios) ? body.cambios : [])
      .map((c) => ({
        id: Number(c?.id),
        estado: String(c?.estado || '').trim(),
        // Fecha de adjudicación explícita (p. ej. la de la orden de compra);
        // sin ella se usa hoy, que es cuando se descubrió el desenlace.
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(c?.fecha || '')) ? String(c.fecha) : null,
        motivo: String(c?.motivo || '').trim() || null,
      }))
      .filter((c) => Number.isFinite(c.id) && ESTADOS_APLICABLES.includes(c.estado));
    if (!cambios.length) throw new BadRequestException('No hay cambios válidos que aplicar.');

    const client = this.supabase.getClient();
    const aplicados: number[] = [];
    const errores: string[] = [];
    for (const c of cambios) {
      const { error } = await client
        .from('licitaciones')
        .update({
          estado: c.estado,
          ...(c.estado === 'Adjudicada' ? { fecha_adjudicada: c.fecha || hoyIso() } : {}),
          // El motivo del descarte se ve en la ficha de la cotización.
          ...(c.estado === 'Descartada' && c.motivo ? { motivo_descarte: c.motivo.slice(0, 300) } : {}),
        })
        .eq('id', c.id);
      if (error) {
        errores.push(`#${c.id}: ${error.message}`);
        continue;
      }
      aplicados.push(c.id);
      // Queda en el historial de la cotización (actividades_cliente).
      const { error: errAct } = await client.from('actividades_cliente').insert({
        licitacion_id: c.id,
        user_email: email || 'sistema',
        titulo: `Estado actualizado a "${c.estado}" según Mercado Público`,
        tipo: 'otro',
        motivo: 'Gestión Administrativa',
        comentario: c.motivo || opciones.comentario || 'Cambio aplicado desde el diagnóstico de estados de Análisis Mercado Público.',
        fecha: hoyIso(),
        todo_el_dia: true,
        estado: 'realizada',
      });
      if (errAct) this.log.warn(`Sin bitácora para #${c.id}: ${errAct.message}`);
    }

    const descartadas: Array<{ id: number; codigo: string; por: number }> = [];
    if (opciones.hermanas !== false) {
      for (const c of cambios) {
        if (c.estado !== 'Adjudicada' || !aplicados.includes(c.id)) continue;
        try {
          const r = await this.descartarHermanas(c.id, email);
          descartadas.push(...r.detalle);
        } catch (e: any) {
          this.log.warn(`No se pudieron revisar las versiones de #${c.id}: ${String(e?.message || e)}`);
        }
      }
    }
    return { aplicados: aplicados.length, ids: aplicados, errores, descartadas };
  }

  /** Versiones hermanas ABIERTAS del mismo proceso (código puro). */
  async versionesHermanas(id: number) {
    const client = this.supabase.getClient();
    const { data: yo } = await client.from('licitaciones').select('id, id_licitacion').eq('id', id).maybeSingle();
    const base = baseDeCodigo((yo as any)?.id_licitacion);
    if (!base) return { base: null as string | null, codigo: String((yo as any)?.id_licitacion || ''), hermanas: [] as any[] };
    const { data: otras, error } = await client
      .from('licitaciones')
      .select('id, id_licitacion, estado')
      .ilike('id_licitacion', `%${base}%`)
      .limit(50);
    if (error) throw new Error(error.message);
    const hermanas = (otras || []).filter(
      (l: any) => Number(l.id) !== Number(id) && ESTADOS_ABIERTOS.includes(String(l.estado || '')) && esVersionPura(l.id_licitacion, base),
    );
    return { base, codigo: String((yo as any)?.id_licitacion || '').trim(), hermanas };
  }

  /** Las versiones abiertas del proceso de #idGanadora pasan a "Descartada" y se avisa. */
  async descartarHermanas(idGanadora: number, email?: string) {
    const v = await this.versionesHermanas(idGanadora);
    if (!v.base || !v.hermanas.length) return { ids: [] as number[], detalle: [] as Array<{ id: number; codigo: string; por: number }> };
    const motivo = `Versión no adjudicada: el proceso ${v.base} se adjudicó con la cotización ${v.codigo} (#${idGanadora}).`;
    const r = await this.aplicarEstado(
      { cambios: v.hermanas.map((h: any) => ({ id: Number(h.id), estado: 'Descartada', motivo })) },
      email,
      { hermanas: false },
    );
    const detalle = v.hermanas
      .filter((h: any) => r.ids.includes(Number(h.id)))
      .map((h: any) => ({ id: Number(h.id), codigo: String(h.id_licitacion || '').trim(), por: idGanadora }));
    await this.avisarVendedor(
      r.ids,
      (lic) => `${lic?.id_licitacion || `#${lic?.id}`} (${lic?.nombre_entidad || 'cliente'}): estado actualizado automáticamente a "Descartada". ${motivo}`,
      { estado: 'Descartada', origen: 'versiones_hermanas', ganadora: idGanadora },
    );
    if (r.ids.length) this.log.log(`Proceso ${v.base}: ${r.ids.length} versión(es) descartada(s) por la adjudicada #${idGanadora}.`);
    return { ids: r.ids, detalle };
  }

  /* Limpieza del acumulado: procesos ya ganados (una versión Adjudicada en
     los últimos `dias`) que todavía tienen otras versiones abiertas. Dos
     consultas y luego solo los casos con algo que descartar; el cron la corre
     al inicio de cada pasada (no gasta API). `simular` devuelve el plan. */
  async limpiarVersionesAdjudicadas(op: { dias?: number; simular?: boolean } = {}) {
    const client = this.supabase.getClient();
    const dias = Math.max(1, Math.min(730, Math.trunc(Number(op.dias)) || 180));
    const desde = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
    const { data: abiertas, error: e1 } = await client.from('licitaciones').select('id, id_licitacion, estado').in('estado', ESTADOS_ABIERTOS).limit(5000);
    if (e1) throw new Error(e1.message);
    const porBase = new Map<string, any[]>();
    for (const l of abiertas || []) {
      const b = baseDeCodigo((l as any).id_licitacion);
      if (!b) continue;
      if (!porBase.has(b)) porBase.set(b, []);
      porBase.get(b)!.push(l);
    }
    const { data: adjudicadas, error: e2 } = await client
      .from('licitaciones')
      .select('id, id_licitacion')
      .eq('estado', 'Adjudicada')
      .gte('fecha_adjudicada', desde)
      .order('id', { ascending: false })
      .limit(2000);
    if (e2) throw new Error(e2.message);
    const descartadas: Array<{ id: number; codigo: string; por: number }> = [];
    let procesos = 0;
    for (const a of adjudicadas || []) {
      const b = baseDeCodigo((a as any).id_licitacion);
      if (!b || !porBase.has(b)) continue;
      const hermanas = porBase.get(b)!.filter((h: any) => Number(h.id) !== Number((a as any).id) && esVersionPura(h.id_licitacion, b));
      if (!hermanas.length) continue;
      porBase.delete(b);
      procesos += 1;
      if (op.simular) {
        descartadas.push(...hermanas.map((h: any) => ({ id: Number(h.id), codigo: String(h.id_licitacion || '').trim(), por: Number((a as any).id) })));
        continue;
      }
      const r = await this.descartarHermanas(Number((a as any).id), 'automático (versión no adjudicada)');
      descartadas.push(...r.detalle);
    }
    return { adjudicadas: (adjudicadas || []).length, procesos, descartadas, simulado: op.simular === true };
  }

  /* Una orden de compra cargada en la cotización = adjudicada (fecha de la
     OC). Si ya estaba adjudicada, igual revisa las versiones hermanas. */
  async porOrdenCargada(licitacionId: number, oc: { numero?: string | null; fecha?: string | null }, email?: string) {
    const client = this.supabase.getClient();
    const { data: lic } = await client.from('licitaciones').select('id, id_licitacion, estado').eq('id', licitacionId).maybeSingle();
    if (!lic) return { adjudicada: false, descartadas: [] as number[] };
    const estado = String((lic as any).estado || '');
    if (estado === 'Adjudicada') {
      const r = await this.descartarHermanas(licitacionId, email);
      return { adjudicada: false, descartadas: r.ids };
    }
    if (!ESTADOS_ABIERTOS.includes(estado)) return { adjudicada: false, descartadas: [] as number[] };
    const numero = String(oc?.numero || '').trim();
    const r = await this.aplicarEstado(
      { cambios: [{ id: licitacionId, estado: 'Adjudicada', fecha: oc?.fecha || null, motivo: `Tiene cargada la orden de compra ${numero}.`.trim() }] },
      email,
    );
    if (r.ids.length) {
      await this.avisarVendedor(
        r.ids,
        (l) => `${l?.id_licitacion || `#${l?.id}`} (${l?.nombre_entidad || 'cliente'}): estado actualizado automáticamente a "Adjudicada". Tiene cargada la orden de compra ${numero}.`.trim(),
        { estado: 'Adjudicada', origen: 'oc_cargada', oc: numero || null },
      );
    }
    return { adjudicada: r.ids.length > 0, descartadas: r.descartadas.map((d) => d.id) };
  }

  /** Notificación en la campanita al dueño (vendedor) de cada cotización. */
  async avisarVendedor(ids: number[], mensajeDe: (lic: any) => string, metadata: Record<string, any> = {}, tipo = 'mp_estado_auto') {
    if (!ids.length) return;
    const client = this.supabase.getClient();
    const { data: lics } = await client
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, vendedor_correo, creado_por')
      .in('id', ids);
    for (const lic of lics || []) {
      const destinatario = String((lic as any).vendedor_correo || (lic as any).creado_por || '').trim().toLowerCase();
      if (!destinatario) continue;
      const { error } = await client.from('notificaciones').insert([{
        user_email: destinatario,
        tipo,
        mensaje: mensajeDe(lic),
        link: `/detalle/${(lic as any).id}`,
        metadata: { licitacion_id: (lic as any).id, ...metadata },
      }]);
      if (error) this.log.warn(`Sin notificación para #${(lic as any).id}: ${error.message}`);
    }
  }
}
