import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ESTADOS_ABIERTOS, MpAdjudicacionesService, baseDeCodigo } from './mp-adjudicaciones.service';
import { mpLimitador } from '../mercadopublico/mp-limitador';

/* ============================================================================
   Órdenes de compra emitidas a Amsodent en Mercado Público (2026-10-15)
   ----------------------------------------------------------------------------
   El cambio automático de estado dependía de la API v2 de Compra Ágil, que
   responde 504 la mayor parte del día (medido el 2026-10-15: 6 de 6 consultas
   cortadas a los 29 s). Mientras tanto, la API v1 de órdenes de compra
   responde en menos de 2 s y publica cada OC emitida a nuestro código de
   proveedor, con comprador, montos y fechas. Una OC emitida ES la
   adjudicación: no hace falta esperar a que la ficha de la Compra Ágil
   conteste.

   Barrido (`barrer`): lista las OC de los últimos N días, y por cada una:
     1. Si ya está cargada en una cotización → esa cotización queda
        Adjudicada (si seguía abierta) y sus versiones hermanas, descartadas.
     2. Si no, pide el detalle y busca la cotización: por el código del
        proceso cuando la OC lo nombra («desde: 608-6176-COT26» o
        CodigoLicitacion) y, en todo caso, por la unidad compradora (primer
        tramo del código de la OC) y el MONTO (bruto o neto, ±0,3 %). Entre
        varias versiones gana la del monto.
     3. Si no hay con qué emparejarla, avisa a las jefaturas de ventas para
        que la revisen a mano.
   Cada adjudicación avisa al vendedor con el número y el monto de la OC y le
   pide cargarla en Trazabilidad. `simular: true` solo muestra el plan.

   Config: MP_CODIGO_PROVEEDOR (código de proveedor en Mercado Público;
   default 2022323, el de Amsodent), MERCADO_PUBLICO_TICKET / MP_API_TICKET.
============================================================================ */

const V1 = 'https://api.mercadopublico.cl/servicios/v1/publico';
const RE_CODIGO = /\b(\d{3,}-\d{1,6}-[A-Z]{2,3}\d{2})\b/gi;
const RE_OC = /-(AG|SE|CM)\d{2}$/i;
const ZONA = 'America/Santiago';

const num = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export type ResumenBarrido = {
  dias: number;
  simulado: boolean;
  ocs: number;
  ya_cargadas: number;
  ya_resueltas: number;
  adjudicadas: Array<{ oc: string; licitacion_id: number; codigo: string; total: number | null; fecha: string | null }>;
  descartadas: Array<{ id: number; codigo: string; por: number }>;
  sin_cotizacion: Array<{ oc: string; total: number | null; comprador: string | null }>;
  errores: string[];
};

@Injectable()
export class MpOrdenesService {
  private readonly log = new Logger('MpOrdenes');
  /** Reemplazable en pruebas. */
  fetchFn: (url: string, init?: any) => Promise<any> = (url, init) => mpLimitador.con(url, () => fetch(url, init));
  /** Pausa entre llamadas a la v1 (responde 429 «simultáneas» si se le pide seguido). */
  pausaMs = 1200;
  /** OC ya procesadas en esta instancia (código → cuándo), para no repetir detalle ni avisos. */
  private vistas = new Map<string, number>();

  constructor(
    private supabase: SupabaseService,
    private adjudicaciones: MpAdjudicacionesService,
  ) {}

  private ticket(): string {
    return (process.env.MERCADO_PUBLICO_TICKET || process.env.MP_API_TICKET || '').trim();
  }

  private codigoProveedor(): string {
    return (process.env.MP_CODIGO_PROVEEDOR || '2022323').trim();
  }

  private pausa(ms = this.pausaMs) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Fecha en Chile, N días atrás, como la pide la v1 (DDMMYYYY). */
  private fechaV1(diasAtras: number): string {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(Date.now() - diasAtras * 864e5));
    const [a, m, d] = f.split('-');
    return `${d}${m}${a}`;
  }

  /** GET a la v1 con timeout; un 429 por «simultáneas» se espera y se reintenta una vez. */
  private async v1(path: string): Promise<any> {
    const url = `${V1}/${path}${path.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(this.ticket())}`;
    for (let intento = 0; ; intento++) {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(40000) });
      const json: any = await res.json().catch(() => null);
      if (res.status === 429 && intento === 0) {
        await this.pausa(6000);
        continue;
      }
      if (res.status === 429) throw new Error(/simult/i.test(String(json?.Mensaje || '')) ? 'Mercado Público rechazó la consulta por peticiones simultáneas.' : 'Se agotó la cuota diaria del ticket de Mercado Público.');
      if (!res.ok) throw new Error(`Mercado Público respondió ${res.status}.`);
      return json;
    }
  }

  async barrer(op: { dias?: number; simular?: boolean } = {}): Promise<ResumenBarrido> {
    const dias = Math.max(1, Math.min(30, Math.trunc(Number(op.dias)) || 5));
    const simular = op.simular === true;
    const resumen: ResumenBarrido = { dias, simulado: simular, ocs: 0, ya_cargadas: 0, ya_resueltas: 0, adjudicadas: [], descartadas: [], sin_cotizacion: [], errores: [] };
    if (!this.ticket()) {
      resumen.errores.push('Falta MERCADO_PUBLICO_TICKET en el backend.');
      return resumen;
    }
    const email = 'automático (OC emitida en Mercado Público)';

    // 1) Las OC de cada día, de hoy hacia atrás.
    const codigos: string[] = [];
    for (let d = 0; d < dias; d++) {
      const fecha = this.fechaV1(d);
      try {
        const json = await this.v1(`ordenesdecompra.json?fecha=${fecha}&CodigoProveedor=${encodeURIComponent(this.codigoProveedor())}`);
        for (const o of Array.isArray(json?.Listado) ? json.Listado : []) {
          const c = String(o?.Codigo || '').trim().toUpperCase();
          if (c && !codigos.includes(c)) codigos.push(c);
        }
      } catch (e: any) {
        resumen.errores.push(`listado ${fecha}: ${String(e?.message || e).slice(0, 120)}`);
      }
      await this.pausa();
    }
    resumen.ocs = codigos.length;

    // 2) Cada OC.
    const client = this.supabase.getClient();
    for (const oc of codigos) {
      try {
        const vista = this.vistas.get(oc);
        if (!simular && vista && Date.now() - vista < 3 * 864e5) continue;

        // a) ¿Ya está cargada en una cotización?
        const { data: docs } = await client
          .from('licitacion_documentos')
          .select('licitacion_id, fecha_oc')
          .eq('tipo', 'orden_compra')
          .ilike('numero', `%${oc}%`)
          .limit(1);
        const cargada: any = (docs || [])[0];
        if (cargada?.licitacion_id) {
          resumen.ya_cargadas += 1;
          if (simular) {
            // Plan: qué cambiaría (la cotización si sigue abierta, y sus versiones hermanas).
            const idLic = Number(cargada.licitacion_id);
            const { data: l } = await client.from('licitaciones').select('id, id_licitacion, estado').eq('id', idLic).maybeSingle();
            const estadoL = String((l as any)?.estado || '');
            if (l && ESTADOS_ABIERTOS.includes(estadoL)) resumen.adjudicadas.push({ oc, licitacion_id: idLic, codigo: String((l as any).id_licitacion || '').trim(), total: null, fecha: String(cargada.fecha_oc || '').slice(0, 10) || null });
            if (l && (ESTADOS_ABIERTOS.includes(estadoL) || estadoL === 'Adjudicada')) {
              const v = await this.adjudicaciones.versionesHermanas(idLic);
              for (const h of v.hermanas) resumen.descartadas.push({ id: Number(h.id), codigo: String(h.id_licitacion || '').trim(), por: idLic });
            }
          } else {
            const r = await this.adjudicaciones.porOrdenCargada(Number(cargada.licitacion_id), { numero: oc, fecha: String(cargada.fecha_oc || '').slice(0, 10) || null }, 'automático (orden de compra cargada)');
            if (r.adjudicada) resumen.adjudicadas.push({ oc, licitacion_id: Number(cargada.licitacion_id), codigo: '', total: null, fecha: null });
            for (const id of r.descartadas) resumen.descartadas.push({ id, codigo: '', por: Number(cargada.licitacion_id) });
          }
          if (!simular) this.vistas.set(oc, Date.now());
          continue;
        }

        // b) Detalle de la OC: comprador, montos, fechas y referencias.
        const det = await this.v1(`ordenesdecompra.json?codigo=${encodeURIComponent(oc)}`);
        await this.pausa();
        const d: any = Array.isArray(det?.Listado) ? det.Listado[0] : null;
        if (!d) {
          resumen.errores.push(`${oc}: sin detalle`);
          continue;
        }
        if (/cancelad|rechazad/i.test(String(d.Estado || ''))) {
          if (!simular) this.vistas.set(oc, Date.now());
          continue;
        }
        const total = num(d.Total);
        const neto = num(d.TotalNeto);
        const unidad = oc.split('-')[0];
        const fecha = String(d?.Fechas?.FechaAceptacion || d?.Fechas?.FechaEnvio || d?.Fechas?.FechaCreacion || '').slice(0, 10) || null;
        const comprador = String(d?.Comprador?.NombreOrganismo || d?.Comprador?.NombreUnidad || '').trim() || null;
        const textoRefs = `${d.CodigoLicitacion || ''} ${d.Nombre || ''} ${d.Descripcion || ''}`;
        const refs = [...new Set([...textoRefs.matchAll(RE_CODIGO)].map((m) => m[1].toUpperCase()).filter((c) => c !== oc && !RE_OC.test(c)))];

        const elegida = await this.emparejar({ refs, unidad, total, neto });
        if (!elegida) {
          resumen.sin_cotizacion.push({ oc, total, comprador });
          if (!simular) await this.avisarSinCotizacion(oc, total, comprador, d.Nombre);
          if (!simular) this.vistas.set(oc, Date.now());
          continue;
        }
        if (!ESTADOS_ABIERTOS.includes(String(elegida.estado || ''))) {
          // Ya resuelta (normalmente Adjudicada): solo se revisan las versiones hermanas.
          resumen.ya_resueltas += 1;
          if (String(elegida.estado) === 'Adjudicada') {
            if (simular) {
              const v = await this.adjudicaciones.versionesHermanas(Number(elegida.id));
              for (const h of v.hermanas) resumen.descartadas.push({ id: Number(h.id), codigo: String(h.id_licitacion || '').trim(), por: Number(elegida.id) });
            } else {
              const r = await this.adjudicaciones.descartarHermanas(Number(elegida.id), email);
              resumen.descartadas.push(...r.detalle);
            }
          }
          if (!simular) this.vistas.set(oc, Date.now());
          continue;
        }

        resumen.adjudicadas.push({ oc, licitacion_id: Number(elegida.id), codigo: String(elegida.id_licitacion || '').trim(), total, fecha });
        if (simular) {
          const v = await this.adjudicaciones.versionesHermanas(Number(elegida.id));
          for (const h of v.hermanas) resumen.descartadas.push({ id: Number(h.id), codigo: String(h.id_licitacion || '').trim(), por: Number(elegida.id) });
        } else {
          const motivo = `Mercado Público emitió la orden de compra ${oc}${total ? ` por ${pesos(total)} bruto` : ''}${fecha ? ` el ${fecha}` : ''}.`;
          const r = await this.adjudicaciones.aplicarEstado(
            { cambios: [{ id: Number(elegida.id), estado: 'Adjudicada', fecha, motivo }] },
            email,
          );
          resumen.descartadas.push(...r.descartadas);
          if (r.ids.length) {
            await this.adjudicaciones.avisarVendedor(
              r.ids,
              (l) => `${l?.id_licitacion || `#${l?.id}`} (${l?.nombre_entidad || comprador || 'cliente'}): Mercado Público emitió la orden de compra ${oc}${total ? ` por ${pesos(total)} bruto` : ''}. El estado pasó a "Adjudicada": carga la OC en Trazabilidad para seguir el ciclo.`,
              { estado: 'Adjudicada', origen: 'oc_mercado_publico', oc, total },
              'mp_oc_emitida',
            );
          }
        }
        if (!simular) this.vistas.set(oc, Date.now());
      } catch (e: any) {
        resumen.errores.push(`${oc}: ${String(e?.message || e).slice(0, 140)}`);
      }
    }

    this.log.log(
      `Barrido de OC (${dias} días${simular ? ', simulado' : ''}): ${resumen.ocs} emitidas · ${resumen.ya_cargadas} ya cargadas · ` +
      `${resumen.adjudicadas.length} adjudicada(s) · ${resumen.descartadas.length} versión(es) descartada(s) · ` +
      `${resumen.sin_cotizacion.length} sin cotización · ${resumen.errores.length} error(es).`,
    );
    return resumen;
  }

  /* Cotización que corresponde a la OC. Devuelve la fila elegida (abierta o
     ya resuelta) o null si no hay con qué emparejar. */
  private async emparejar(oc: { refs: string[]; unidad: string; total: number | null; neto: number | null }): Promise<any | null> {
    const client = this.supabase.getClient();
    const candidatas = new Map<number, any>();
    const agregar = (filas: any[]) => {
      for (const f of filas || []) if (f?.id != null && !candidatas.has(Number(f.id))) candidatas.set(Number(f.id), f);
    };
    const SEL = 'id, id_licitacion, estado, total_con_iva, total_sin_iva, created_at';

    // Por el código del proceso que nombra la OC (todas sus versiones).
    const porRef: any[] = [];
    for (const ref of oc.refs.slice(0, 4)) {
      const { data } = await client.from('licitaciones').select(SEL).ilike('id_licitacion', `%${ref}%`).limit(30);
      porRef.push(...(data || []));
    }
    agregar(porRef);

    // Por la unidad compradora (primer tramo del código), últimos 240 días.
    if (/^\d{3,}$/.test(oc.unidad)) {
      const desde = new Date(Date.now() - 240 * 864e5).toISOString();
      const { data } = await client
        .from('licitaciones')
        .select(SEL)
        .ilike('id_licitacion', `%${oc.unidad}-%`)
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(300);
      agregar((data || []).filter((l: any) => (baseDeCodigo(l.id_licitacion) || '').startsWith(`${oc.unidad}-`)));
    }

    const todas = [...candidatas.values()].filter((l: any) => ESTADOS_ABIERTOS.includes(String(l.estado || '')) || String(l.estado) === 'Adjudicada');
    if (!todas.length) return null;

    const cerca = (l: any) => {
      const bruto = num(l.total_con_iva);
      const netoL = num(l.total_sin_iva);
      const tolB = oc.total != null ? Math.max(3, oc.total * 0.003) : -1;
      const tolN = oc.neto != null ? Math.max(3, oc.neto * 0.003) : -1;
      return (bruto != null && oc.total != null && Math.abs(bruto - oc.total) <= tolB) || (netoL != null && oc.neto != null && Math.abs(netoL - oc.neto) <= tolN);
    };
    const masNueva = (a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || ''));

    // Si la OC nombra el proceso, se busca SOLO entre sus versiones (otra
    // cotización del mismo organismo con el mismo monto no es esta).
    const delProceso = porRef.length ? todas.filter((l: any) => porRef.some((r: any) => Number(r.id) === Number(l.id))) : [];
    const pool = delProceso.length ? delProceso : todas;

    // 1) Monto exacto: la versión que se cotizó por lo que dice la OC.
    const porMonto = pool.filter(cerca).sort(masNueva);
    if (porMonto.length) return porMonto.find((l: any) => String(l.estado) === 'Adjudicada') || porMonto[0];

    // 2) Sin monto que calce pero la OC nombra el proceso: la versión abierta
    //    más cercana en monto (hasta 15 %) o, si no, la más nueva.
    if (delProceso.length) {
      const ya = delProceso.find((l: any) => String(l.estado) === 'Adjudicada');
      if (ya) return ya;
      const abiertas = delProceso.filter((l: any) => ESTADOS_ABIERTOS.includes(String(l.estado || '')));
      if (!abiertas.length) return null;
      if (oc.total != null) {
        const conDist = abiertas
          .map((l: any) => ({ l, dist: num(l.total_con_iva) != null ? Math.abs(Number(l.total_con_iva) - oc.total!) / oc.total! : Infinity }))
          .sort((a, b) => a.dist - b.dist);
        if (conDist[0] && conDist[0].dist <= 0.15) return conDist[0].l;
      }
      return abiertas.sort(masNueva)[0];
    }
    return null;
  }

  /** Aviso (una vez por OC) a las jefaturas de ventas: OC sin cotización que la explique. */
  private async avisarSinCotizacion(oc: string, total: number | null, comprador: string | null, nombre: string) {
    const client = this.supabase.getClient();
    const { data: jefes } = await client.from('profiles').select('email').in('rol', ['jefe_ventas', 'jefe_ventas_especial']);
    const extras = (process.env.MP_ADJUDICADA_EXTRA_CORREOS ?? 'jer.consorcio@gmail.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const emails = [...new Set([...(jefes || []).map((j: any) => String(j?.email || '').trim().toLowerCase()), ...extras].filter(Boolean))];
    if (!emails.length) return;
    const { data: previas } = await client.from('notificaciones').select('user_email, metadata').eq('tipo', 'mp_oc_emitida').in('user_email', emails);
    const avisados = new Set((previas || []).filter((n: any) => String(n?.metadata?.oc || '') === oc).map((n: any) => String(n.user_email).toLowerCase()));
    const filas = emails.filter((e) => !avisados.has(e)).map((user_email) => ({
      user_email,
      tipo: 'mp_oc_emitida',
      mensaje: `Mercado Público emitió a Amsodent la orden de compra ${oc}${total ? ` por ${pesos(total)} bruto` : ''}${comprador ? ` (${comprador})` : ''}: «${String(nombre || '').slice(0, 80)}». No calza con ninguna cotización abierta: revísala y cárgala en la que corresponda.`,
      link: '/trazabilidad',
      metadata: { oc, total, comprador, origen: 'oc_mercado_publico', sin_cotizacion: true },
    }));
    if (!filas.length) return;
    const { error } = await client.from('notificaciones').insert(filas);
    if (error) this.log.warn(`Sin aviso de OC ${oc} sin cotización: ${error.message}`);
  }
}
