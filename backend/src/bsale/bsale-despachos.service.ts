import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';
import { BsaleService } from './bsale.service';
import {
  BsaleFacturacionService,
  epochAFecha,
  fechaAEpoch,
  folioGuia,
  normOc,
  normRut,
  plazoDias,
  sumarDias,
  totalesDe,
  folioCotizacion,
  ocDeReferencia,
  referenciaOcGuia,
  referenciaParaBsale,
  referenciaVista,
  EMISOR,
} from './bsale-facturacion.service';

/* ── Guías de despacho y órdenes (notas de venta) en Bsale (2026-10-02) ──────
   Mismo módulo Facturación, un paso antes de la factura:

     orden de compra del cliente ──► [orden en Bsale = nota de venta] ──► guía ──► factura

   · La GUÍA se arma desde la orden de compra del sistema: los productos de la
     cotización, lo que ya se despachó según las guías que hay en Bsale para
     esa orden, y lo que falta. La persona elige cuánto va en esta entrega
     (muchas órdenes salen en varias guías). Se emite por /shippings.json
     (así lo hace Bsale con los despachos) y Bsale descuenta el stock.
   · La ORDEN en Bsale es una nota de venta con todos los productos de la
     cotización. No va al SII ni mueve stock. Si existe, las guías se arman
     desde sus líneas (detailId), que es como Bsale enlaza nota → guía.
   · Mismas reglas que la factura: Simular no toca nada; Emitir re-arma el
     borrador en el servidor, exige que no haya cambiado, registra el intento
     en bsale_emisiones y deja el documento en Trazabilidad. */

const DTE_OC = 801;
const DTE_GUIA = 52;
const IVA_ID = 1; // "IVA 19%", forAllProducts en la cuenta de Amsodent
const TIPO_TRASLADO_POR_DEFECTO = 2; // "Ventas por efectuar": se despacha ahora y se factura después

type Problema = { codigo: string; mensaje: string };

const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const normSku = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const texto = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);

/* Observación de la guía (2026-10-07). Pedido de Ariel: la observación que se
   escribe en cada producto de la cotización va al atributo adicional
   «Observación» de la guía en Bsale. Ese campo ya lo usaban a mano para
   instrucciones de entrega (horario de bodega, fono): el texto se propone con
   las observaciones de los productos y se puede editar antes de simular. El
   más largo escrito a mano en Bsale tenía 208 caracteres: tope de 250. */
export const OBSERVACION_MAX = 250;
export function observacionSugerida(lineas: { sku?: string; producto?: string; observacion?: string }[]): string {
  const vistas = new Set<string>();
  const partes: string[] = [];
  for (const l of lineas || []) {
    const obs = String(l?.observacion || '').replace(/\s+/g, ' ').trim();
    if (!obs) continue;
    const quien = String(l?.sku || '').trim() || String(l?.producto || '').trim().slice(0, 40);
    const parte = quien ? `${quien}: ${obs}` : obs;
    if (vistas.has(parte)) continue;
    vistas.add(parte);
    partes.push(parte);
  }
  return partes.join(' · ');
}
// RUT como lo guarda Bsale: sin puntos, con guion.
const rutBsale = (v: any) => {
  const limpio = normRut(v);
  return limpio.length > 1 ? `${limpio.slice(0, -1)}-${limpio.slice(-1)}` : limpio;
};

@Injectable()
export class BsaleDespachosService {
  private readonly logger = new Logger(BsaleDespachosService.name);
  private cacheVariantes = new Map<string, { ts: number; variante: any | null }>();
  private cacheTraslados: { ts: number; tipos: any[] } | null = null;
  private cacheAtributos: { ts: number; items: any[] } | null = null;

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
    private bsale: BsaleService,
    private licitaciones: LicitacionesService,
  ) {}

  // ── Lista "Por despachar" ──────────────────────────────────────────────

  /* Órdenes de compra de cotizaciones adjudicadas y abiertas. No consulta
     Bsale: cuánto falta de cada producto se calcula al abrir el borrador. */
  async pendientes(userId: string) {
    await this.facturacion.exigirRol(userId);
    const db = this.supabase.getClient();
    const lics: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db
        .from('licitaciones')
        .select('id, id_licitacion, nombre_entidad, rut_entidad, comuna, ciclo_cerrado, tipo_cliente')
        .eq('estado', 'Adjudicada')
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      lics.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const abiertas = new Map<number, any>(lics.filter((l) => !l.ciclo_cerrado).map((l) => [Number(l.id), l] as [number, any]));
    const docs: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db
        .from('licitacion_documentos')
        .select('id, licitacion_id, tipo, numero, monto, fecha_oc, deriva_de_id, bsale_id, bsale_url, created_at')
        .in('tipo', ['orden_compra', 'guia_despacho'])
        .order('id', { ascending: true })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      docs.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const guiasPorOc = new Map<number, any[]>();
    for (const g of docs) {
      if (g.tipo !== 'guia_despacho' || !g.deriva_de_id) continue;
      const lista = guiasPorOc.get(Number(g.deriva_de_id)) || [];
      lista.push(g);
      guiasPorOc.set(Number(g.deriva_de_id), lista);
    }
    // Ítems: cuántos y cuántos sin SKU (sin SKU no pueden ir a Bsale).
    const itemsPorLic = new Map<number, { n: number; sinSku: number }>();
    const licIds = [...new Set(docs.filter((d) => d.tipo === 'orden_compra' && abiertas.has(Number(d.licitacion_id))).map((d) => Number(d.licitacion_id)))];
    for (let i = 0; i < licIds.length; i += 200) {
      const { data } = await db.from('items_licitacion').select('licitacion_id, sku').in('licitacion_id', licIds.slice(i, i + 200));
      for (const it of data || []) {
        const e = itemsPorLic.get(Number((it as any).licitacion_id)) || { n: 0, sinSku: 0 };
        e.n++;
        if (!normSku((it as any).sku)) e.sinSku++;
        itemsPorLic.set(Number((it as any).licitacion_id), e);
      }
    }
    const hoy = fechaAEpoch(hoyEnChile());
    const filas = docs
      .filter((d) => d.tipo === 'orden_compra' && abiertas.has(Number(d.licitacion_id)))
      .map((oc) => {
        const lic = abiertas.get(Number(oc.licitacion_id));
        const guias = (guiasPorOc.get(Number(oc.id)) || []).map((g) => folioGuia(g.numero) || String(g.numero || '').trim()).filter(Boolean);
        const fecha = String(oc.fecha_oc || oc.created_at || '').slice(0, 10) || null;
        const items = itemsPorLic.get(Number(oc.licitacion_id)) || { n: 0, sinSku: 0 };
        return {
          oc_id: oc.id,
          oc_numero: String(oc.numero || '').trim() || null,
          oc_fecha: fecha,
          oc_neto: Number(oc.monto) || null,
          dias: fecha && Number.isFinite(fechaAEpoch(fecha)) ? Math.max(0, Math.round((hoy - fechaAEpoch(fecha)) / 86400)) : null,
          licitacion_id: lic.id,
          codigo: lic.id_licitacion || null,
          cliente: lic.nombre_entidad || '',
          rut: lic.rut_entidad || '',
          comuna: lic.comuna || '',
          particular: /particular/i.test(String(lic.tipo_cliente || '')),
          guias,
          items: items.n,
          items_sin_sku: items.sinSku,
          orden_bsale: oc.bsale_id ? { id: oc.bsale_id, url: oc.bsale_url || null } : null,
        };
      });
    // Las que no tienen ninguna guía primero; dentro de cada grupo, la más antigua.
    filas.sort((a, b) => (a.guias.length ? 1 : 0) - (b.guias.length ? 1 : 0) || String(a.oc_fecha || '9999').localeCompare(String(b.oc_fecha || '9999')) || a.oc_id - b.oc_id);
    return { filas };
  }

  // ── Datos de Bsale ─────────────────────────────────────────────────────

  async tiposTraslado() {
    if (this.cacheTraslados && Date.now() - this.cacheTraslados.ts < 10 * 60 * 1000) return this.cacheTraslados.tipos;
    const tipos = (await this.facturacion.todos('/shipping_types.json'))
      .filter((t) => Number(t.state) === 0)
      .map((t) => ({ id: Number(t.id), nombre: String(t.name || '').trim(), codigo_sii: Number(t.codeSii) || null }));
    this.cacheTraslados = { ts: Date.now(), tipos };
    return tipos;
  }

  async variantePorSku(sku: string) {
    const k = normSku(sku);
    if (!k) return null;
    const hit = this.cacheVariantes.get(k);
    if (hit && Date.now() - hit.ts < 60 * 60 * 1000) return hit.variante;
    const r = await this.facturacion.apiGet(`/variants.json?code=${encodeURIComponent(k)}&expand=[product]&limit=5`);
    const items: any[] = r?.items || [];
    const variante = items.find((v) => normSku(v?.code) === k && Number(v?.state) === 0) || items.find((v) => normSku(v?.code) === k) || null;
    this.cacheVariantes.set(k, { ts: Date.now(), variante });
    return variante;
  }

  async clientePorRut(rut: string) {
    const code = rutBsale(rut);
    if (!code) return null;
    const r = await this.facturacion.apiGet(`/clients.json?code=${encodeURIComponent(code)}&limit=5`);
    const items: any[] = r?.items || [];
    return items.find((c) => normRut(c?.code) === normRut(code)) || null;
  }

  async tipoDocumento(codigoSii: string | null, nombre: RegExp) {
    const tipos = await this.facturacion.todos('/document_types.json', '&state=0');
    return (
      tipos.find((t) => (codigoSii ? String(t.codeSii) === codigoSii && Number(t.isElectronicDocument) === 1 : nombre.test(String(t.name || '')))) || null
    );
  }

  // ── Borradores ─────────────────────────────────────────────────────────

  private async base(licitacionId: number, ocDocId: number) {
    const licId = Number(licitacionId);
    const ocId = Number(ocDocId);
    if (!licId || !ocId) throw new BadRequestException('Falta la cotización o la orden de compra.');
    const db = this.supabase.getClient();
    const { data: lic, error: errLic } = await db
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, rut_entidad, giro, direccion, comuna, region, email, condicion_venta, estado, ciclo_cerrado, tipo_cliente')
      .eq('id', licId)
      .maybeSingle();
    if (errLic || !lic) throw new BadRequestException('No se encontró la cotización.');
    const { data: docs, error: errDocs } = await db
      .from('licitacion_documentos')
      .select('id, tipo, numero, monto, fecha_oc, deriva_de_id, bsale_id, bsale_url, created_at')
      .eq('licitacion_id', licId)
      .in('tipo', ['orden_compra', 'guia_despacho']);
    if (errDocs) throw new BadRequestException(errDocs.message);
    const oc = (docs || []).find((d: any) => d.id === ocId && d.tipo === 'orden_compra');
    if (!oc) throw new BadRequestException('La orden de compra no pertenece a esta cotización.');
    const { data: items, error: errItems } = await db
      .from('items_licitacion')
      .select('id, sku, producto, formato, cantidad, valor_unitario, orden, observacion')
      .eq('licitacion_id', licId)
      .order('orden', { ascending: true });
    if (errItems) throw new BadRequestException(errItems.message);
    return { lic, oc, docs: docs || [], items: items || [] };
  }

  /* Cliente para el documento: el que Bsale ya tiene con ese RUT o, si no
     existe, uno nuevo con los datos de la cotización (editables en pantalla). */
  private async clienteParaDocumento(lic: any) {
    const enBsale = lic.rut_entidad ? await this.clientePorRut(lic.rut_entidad) : null;
    if (enBsale) {
      return {
        id: Number(enBsale.id),
        nuevo: false,
        rut: String(enBsale.code || ''),
        razon_social: String(enBsale.company || `${enBsale.firstName || ''} ${enBsale.lastName || ''}`).trim(),
        giro: String(enBsale.activity || ''),
        direccion: String(enBsale.address || ''),
        comuna: String(enBsale.municipality || ''),
        ciudad: String(enBsale.city || ''),
        email: String(enBsale.email || ''),
      };
    }
    return {
      id: null,
      nuevo: true,
      rut: rutBsale(lic.rut_entidad),
      razon_social: String(lic.nombre_entidad || '').trim(),
      giro: String(lic.giro || '').trim(),
      direccion: String(lic.direccion || '').trim(),
      comuna: String(lic.comuna || '').trim(),
      ciudad: String(lic.comuna || '').trim(),
      email: String(lic.email || '').trim(),
    };
  }

  private async armarBorradorGuia(licitacionId: number, ocDocId: number) {
    const { lic, oc, docs, items } = await this.base(licitacionId, ocDocId);
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    if (lic.estado !== 'Adjudicada') problemas.push({ codigo: 'no_adjudicada', mensaje: 'La cotización no está adjudicada.' });
    if (lic.ciclo_cerrado) problemas.push({ codigo: 'ciclo_cerrado', mensaje: 'La cotización tiene el ciclo cerrado.' });
    const ocNumero = normOc(oc.numero);
    if (!ocNumero) problemas.push({ codigo: 'oc_sin_numero', mensaje: 'La orden de compra no tiene número: la guía no podría referenciarla.' });

    const tipoGuia = await this.tipoDocumento(String(DTE_GUIA), /gu[ií]a/i);
    if (!tipoGuia) problemas.push({ codigo: 'sin_tipo_guia', mensaje: 'La cuenta de Bsale no tiene activa la guía de despacho electrónica.' });
    const traslados = await this.tiposTraslado();
    const cliente = await this.clienteParaDocumento(lic);
    if (cliente.nuevo) avisos.push({ codigo: 'cliente_nuevo', mensaje: `El cliente (RUT ${cliente.rut || 'sin RUT'}) no existe en Bsale: se creará con los datos de abajo. Revisa razón social, giro y dirección.` });
    if (!cliente.rut) problemas.push({ codigo: 'sin_rut', mensaje: 'La cotización no tiene RUT del cliente.' });

    // Lo ya despachado para esta orden, según las guías que hay en Bsale.
    let despachadoPorSku = new Map<string, number>();
    let guiasBsale: any[] = [];
    if (ocNumero) {
      try {
        const r: any = await this.bsale.despachoPorOc(oc.numero, String(oc.fecha_oc || oc.created_at || '').slice(0, 10) || undefined);
        guiasBsale = (r?.guias || []).filter((g: any) => !g.anulada);
        for (const p of r?.productos || []) if (normSku(p.sku)) despachadoPorSku.set(normSku(p.sku), (despachadoPorSku.get(normSku(p.sku)) || 0) + Number(p.cantidad || 0));
      } catch (e: any) {
        avisos.push({ codigo: 'sin_cruce_bsale', mensaje: `No se pudo leer en Bsale lo ya despachado de esta orden (${String(e?.message || e).slice(0, 80)}): revisa las cantidades a mano.` });
      }
    }

    // Nota de venta (orden en Bsale): sus líneas mandan.
    let nota: any = null;
    if (oc.bsale_id) {
      try {
        const doc = await this.facturacion.apiGet(`/documents/${Number(oc.bsale_id)}.json?expand=[details]`);
        if (doc && Number(doc.state) !== 1) {
          let detalles: any[] = doc?.details?.items || [];
          if (Number(doc?.details?.count || 0) > detalles.length) detalles = await this.facturacion.todos(`/documents/${doc.id}/details.json`);
          nota = { id: Number(doc.id), numero: String(doc.number || ''), url: doc.urlPublicView || doc.urlPdf || null, detalles };
        }
      } catch {
        avisos.push({ codigo: 'nota_no_leida', mensaje: 'La orden registrada en Bsale no se pudo leer; la guía se armará directo desde la cotización.' });
      }
    }

    const lineas: any[] = [];
    const sinSku: string[] = [];
    const noEnBsale: string[] = [];
    for (const it of items) {
      const sku = normSku(it.sku);
      const cotizado = Number(it.cantidad) || 0;
      if (!(cotizado > 0)) continue;
      if (!sku) { sinSku.push(String(it.producto || '').trim()); continue; }
      const variante = await this.variantePorSku(sku);
      const detalleNota = nota?.detalles?.find((d: any) => normSku(d?.variant?.code) === sku) || null;
      const despachado = despachadoPorSku.get(sku) || 0;
      const pendiente = Math.max(0, cotizado - despachado);
      if (!variante && !detalleNota) noEnBsale.push(sku);
      lineas.push({
        item_id: it.id,
        sku,
        producto: String(it.producto || '').trim() || String(variante?.product?.name || ''),
        formato: String(it.formato || '').trim(),
        cotizado,
        despachado,
        pendiente,
        cantidad: pendiente,
        neto_unitario: Number(it.valor_unitario) || 0,
        neto: pendiente * (Number(it.valor_unitario) || 0),
        en_bsale: !!(variante || detalleNota),
        variante_id: variante ? Number(variante.id) : null,
        detalle_id: detalleNota ? Number(detalleNota.id) : null,
        observacion: String(it.observacion || '').trim(),
      });
    }
    if (sinSku.length) avisos.push({ codigo: 'items_sin_sku', mensaje: `${sinSku.length} producto${sinSku.length === 1 ? '' : 's'} de la cotización no tiene${sinSku.length === 1 ? '' : 'n'} SKU y no puede${sinSku.length === 1 ? '' : 'n'} ir en la guía: ${sinSku.slice(0, 4).join('; ')}${sinSku.length > 4 ? '…' : ''}. Asígnales SKU en la cotización.` });
    if (noEnBsale.length) avisos.push({ codigo: 'sku_no_en_bsale', mensaje: `${noEnBsale.length} SKU no está${noEnBsale.length === 1 ? '' : 'n'} en Bsale y no puede${noEnBsale.length === 1 ? '' : 'n'} ir en la guía: ${noEnBsale.slice(0, 6).join(', ')}${noEnBsale.length > 6 ? '…' : ''}.` });
    if (!lineas.length) problemas.push({ codigo: 'sin_lineas', mensaje: 'La cotización no tiene productos con SKU: no hay qué despachar.' });
    else if (!lineas.some((l) => l.en_bsale && l.pendiente > 0)) {
      problemas.push({ codigo: 'nada_pendiente', mensaje: lineas.some((l) => l.pendiente > 0) ? 'Lo que falta por despachar no está en Bsale.' : 'Según las guías que hay en Bsale, esta orden ya está despachada completa.' });
    }
    const lineasEmitibles = lineas.filter((l) => l.en_bsale && l.pendiente > 0);
    const totales = totalesDe(lineasEmitibles.map((l) => ({ neto: l.pendiente * l.neto_unitario })));

    const guiasSistema = docs.filter((d: any) => d.tipo === 'guia_despacho' && d.deriva_de_id === oc.id);
    /* Guías que el sistema tiene para esta orden pero Bsale no (anteriores a
       Bsale, manuales, o con otro número): lo que despacharon no se descontó
       de "lo que falta". Hay que avisarlo fuerte: se podría despachar dos veces. */
    const noVistas = guiasSistema.filter((g: any) => !guiasBsale.some((b: any) => folioGuia(String(b.numero)) === folioGuia(g.numero)));
    if (noVistas.length) {
      avisos.push({
        codigo: 'guias_fuera_de_bsale',
        mensaje: `Esta orden ya tiene ${noVistas.length} guía${noVistas.length === 1 ? '' : 's'} en el sistema (${noVistas.map((g: any) => String(g.numero || 's/n')).join(', ')}) que no aparece${noVistas.length === 1 ? '' : 'n'} en Bsale: lo que despacharon NO está descontado en «Falta». Revisa que no vayas a despachar de nuevo.`,
      });
    }
    const hoy = hoyEnChile();
    const borrador = {
      modo: this.facturacion.emisionActiva ? 'activa' : 'simulacion',
      tipo: 'guia',
      cotizacion: { id: lic.id, codigo: lic.id_licitacion || null, cliente: lic.nombre_entidad || '', condicion_venta: lic.condicion_venta || '' },
      oc: { id: oc.id, numero: ocNumero || null, fecha: String(oc.fecha_oc || oc.created_at || '').slice(0, 10) || null, neto: Number(oc.monto) || null },
      orden_bsale: nota ? { id: nota.id, numero: nota.numero, url: nota.url } : null,
      tipo_documento_id: Number(tipoGuia?.id) || 0,
      cliente,
      lineas,
      totales,
      guias_bsale: guiasBsale.map((g: any) => ({ numero: String(g.numero), fecha: g.emitida, neto: g.neto })),
      guias_sistema: guiasSistema.map((g: any) => ({ doc_id: g.id, numero: String(g.numero || ''), fecha: String(g.fecha_oc || g.created_at || '').slice(0, 10) || null })),
      despacho: {
        direccion: String(lic.direccion || '').trim(),
        comuna: String(lic.comuna || '').trim(),
        ciudad: String(lic.comuna || '').trim(),
        destinatario: String(lic.nombre_entidad || '').trim(),
        tipo_traslado_id: traslados.find((t) => t.id === TIPO_TRASLADO_POR_DEFECTO)?.id || traslados[0]?.id || null,
      },
      tipos_traslado: traslados,
      referencias: ocNumero ? [referenciaOcGuia(folioCotizacion(lic), ocNumero, String(oc.fecha_oc || '').slice(0, 10) || null)] : [],
      // Texto propuesto para el atributo «Observación» de la guía en Bsale.
      observacion_sugerida: observacionSugerida(lineasEmitibles),
      observacion_max: OBSERVACION_MAX,
      fecha_emision: hoy,
      fecha_minima: String(oc.fecha_oc || '').slice(0, 10) || sumarDias(hoy, -30),
      fecha_maxima: hoy,
      problemas,
      avisos,
    };
    return { ...borrador, huella: this.facturacion.huellaDe({ cliente: { id: cliente.id || cliente.rut }, tipo_documento_id: borrador.tipo_documento_id, lineas: lineasEmitibles.map((l) => ({ detalle_id: l.detalle_id || l.variante_id, cantidad: l.pendiente, neto: l.neto_unitario })), referencias: borrador.referencias, totales }) };
  }

  private async armarBorradorOrden(licitacionId: number, ocDocId: number) {
    const { lic, oc, items } = await this.base(licitacionId, ocDocId);
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    if (lic.estado !== 'Adjudicada') problemas.push({ codigo: 'no_adjudicada', mensaje: 'La cotización no está adjudicada.' });
    if (lic.ciclo_cerrado) problemas.push({ codigo: 'ciclo_cerrado', mensaje: 'La cotización tiene el ciclo cerrado.' });
    if (oc.bsale_id) problemas.push({ codigo: 'ya_registrada', mensaje: 'Esta orden de compra ya está registrada en Bsale.' });
    const ocNumero = normOc(oc.numero);
    if (!ocNumero) problemas.push({ codigo: 'oc_sin_numero', mensaje: 'La orden de compra no tiene número.' });
    const tipoNota = await this.tipoDocumento(null, /nota\s*(de\s*)?venta/i);
    if (!tipoNota) problemas.push({ codigo: 'sin_tipo_nota', mensaje: 'La cuenta de Bsale no tiene activa la nota de venta.' });
    const cliente = await this.clienteParaDocumento(lic);
    if (cliente.nuevo) avisos.push({ codigo: 'cliente_nuevo', mensaje: `El cliente (RUT ${cliente.rut || 'sin RUT'}) no existe en Bsale: se creará con los datos de abajo.` });
    if (!cliente.rut) problemas.push({ codigo: 'sin_rut', mensaje: 'La cotización no tiene RUT del cliente.' });

    const lineas: any[] = [];
    const sinSku: string[] = [];
    const noEnBsale: string[] = [];
    for (const it of items) {
      const sku = normSku(it.sku);
      const cantidad = Number(it.cantidad) || 0;
      if (!(cantidad > 0)) continue;
      if (!sku) { sinSku.push(String(it.producto || '').trim()); continue; }
      const variante = await this.variantePorSku(sku);
      if (!variante) noEnBsale.push(sku);
      lineas.push({
        item_id: it.id,
        sku,
        producto: String(it.producto || '').trim() || String(variante?.product?.name || ''),
        formato: String(it.formato || '').trim(),
        cantidad,
        neto_unitario: Number(it.valor_unitario) || 0,
        neto: cantidad * (Number(it.valor_unitario) || 0),
        en_bsale: !!variante,
        variante_id: variante ? Number(variante.id) : null,
      });
    }
    if (sinSku.length) avisos.push({ codigo: 'items_sin_sku', mensaje: `${sinSku.length} producto${sinSku.length === 1 ? '' : 's'} sin SKU no entra${sinSku.length === 1 ? '' : 'n'} en la orden: ${sinSku.slice(0, 4).join('; ')}${sinSku.length > 4 ? '…' : ''}.` });
    if (noEnBsale.length) avisos.push({ codigo: 'sku_no_en_bsale', mensaje: `${noEnBsale.length} SKU no está${noEnBsale.length === 1 ? '' : 'n'} en Bsale y no entra${noEnBsale.length === 1 ? '' : 'n'}: ${noEnBsale.slice(0, 6).join(', ')}${noEnBsale.length > 6 ? '…' : ''}.` });
    const emitibles = lineas.filter((l) => l.en_bsale);
    if (!emitibles.length) problemas.push({ codigo: 'sin_lineas', mensaje: 'Ningún producto de la cotización está en Bsale con SKU.' });
    const totales = totalesDe(emitibles);
    const hoy = hoyEnChile();
    const borrador = {
      modo: this.facturacion.emisionActiva ? 'activa' : 'simulacion',
      tipo: 'orden',
      cotizacion: { id: lic.id, codigo: lic.id_licitacion || null, cliente: lic.nombre_entidad || '', condicion_venta: lic.condicion_venta || '' },
      oc: { id: oc.id, numero: ocNumero || null, fecha: String(oc.fecha_oc || oc.created_at || '').slice(0, 10) || null, neto: Number(oc.monto) || null },
      tipo_documento_id: Number(tipoNota?.id) || 0,
      tipo_documento: String(tipoNota?.name || 'Nota de venta'),
      cliente,
      lineas,
      totales,
      referencias: ocNumero ? [referenciaOcGuia(folioCotizacion(lic), ocNumero, String(oc.fecha_oc || '').slice(0, 10) || null)] : [],
      fecha_emision: hoy,
      fecha_minima: String(oc.fecha_oc || '').slice(0, 10) || sumarDias(hoy, -30),
      fecha_maxima: hoy,
      dias_vencimiento: plazoDias(lic.condicion_venta),
      problemas,
      avisos,
    };
    if (Number(oc.monto) > 0 && Math.abs(Number(oc.monto) - totales.neto) > 2) {
      avisos.push({ codigo: 'neto_distinto_oc', mensaje: `Los productos suman $${totales.neto.toLocaleString('es-CL')} neto y la orden de compra dice $${Number(oc.monto).toLocaleString('es-CL')}.` });
    }
    return { ...borrador, huella: this.facturacion.huellaDe({ cliente: { id: cliente.id || cliente.rut }, tipo_documento_id: borrador.tipo_documento_id, lineas: emitibles.map((l) => ({ detalle_id: l.variante_id, cantidad: l.cantidad, neto: l.neto_unitario })), referencias: borrador.referencias, totales }) };
  }

  async prepararGuia(userId: string, licitacionId: number, ocDocId: number) {
    await this.facturacion.exigirRol(userId);
    return this.armarBorradorGuia(licitacionId, ocDocId);
  }

  async prepararOrden(userId: string, licitacionId: number, ocDocId: number) {
    await this.facturacion.exigirRol(userId);
    return this.armarBorradorOrden(licitacionId, ocDocId);
  }

  // ── Cliente y vista ────────────────────────────────────────────────────

  /* Datos del cliente que se le mandan a Bsale. Si ya existe se manda su
     id; si es nuevo, los datos (que la persona pudo corregir en pantalla). */
  private clienteSolicitud(cliente: any, editado: any, problemas: string[]) {
    if (cliente.id) return { clientId: cliente.id };
    const c = {
      code: rutBsale(editado?.rut || cliente.rut),
      company: texto(editado?.razon_social ?? cliente.razon_social, 120),
      activity: texto(editado?.giro ?? cliente.giro, 80),
      address: texto(editado?.direccion ?? cliente.direccion, 120),
      municipality: texto(editado?.comuna ?? cliente.comuna, 60),
      city: texto(editado?.ciudad ?? cliente.ciudad, 60),
      email: texto(editado?.email ?? cliente.email, 120) || undefined,
      companyOrPerson: 1,
    };
    if (!c.code) problemas.push('El cliente nuevo necesita RUT.');
    if (!c.company) problemas.push('El cliente nuevo necesita razón social.');
    if (!c.activity) problemas.push('El cliente nuevo necesita giro (Bsale lo exige para emitir).');
    if (!c.address || !c.municipality) problemas.push('El cliente nuevo necesita dirección y comuna.');
    if (!c.email) delete (c as any).email;
    return { client: c, clienteNuevo: c };
  }

  /* Atributo dinámico «Observación» del tipo de documento: en Bsale la guía
     (tipo 8) tiene uno de texto, y la factura el suyo. Se busca por nombre y
     tipo de documento, no por un id fijo. Sin él la observación no se envía. */
  async atributoObservacion(tipoDocumentoId: number): Promise<number | null> {
    if (!this.cacheAtributos || Date.now() - this.cacheAtributos.ts > 10 * 60 * 1000) {
      const items = await this.facturacion.todos('/dynamic_attributes.json').catch(() => null);
      if (!items) return null;
      this.cacheAtributos = { ts: Date.now(), items };
    }
    const a = this.cacheAtributos.items.find(
      (x: any) => Number(x?.state) === 0 && Number(x?.document_type?.id) === Number(tipoDocumentoId) && /observaci/i.test(String(x?.name || '')),
    );
    return a ? Number(a.id) : null;
  }

  /* Texto validado + atributo listo para la solicitud a Bsale. */
  async observacionParaBsale(valor: any, tipoDocumentoId: number): Promise<{ texto: string; atributo: { description: string; dynamicAttributeId: number } | null; aviso: string | null }> {
    const t = String(valor ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return { texto: '', atributo: null, aviso: null };
    if (t.length > OBSERVACION_MAX) throw new BadRequestException(`La observación tiene ${t.length} caracteres; en Bsale caben hasta ${OBSERVACION_MAX}. Acórtala.`);
    const id = await this.atributoObservacion(tipoDocumentoId);
    if (!id) return { texto: t, atributo: null, aviso: 'Bsale no tiene el atributo «Observación» para este documento: la observación no se envía.' };
    return { texto: t, atributo: { description: t, dynamicAttributeId: id }, aviso: null };
  }

  /* ¿Bsale guardó la Observación? La API de guías (/shippings) no documenta
     los atributos dinámicos: se confirma leyendo el documento emitido y, si no
     quedó, se avisa para agregarla a mano (como con la referencia a la OC). */
  async avisoObservacion(docId: number, numero: any, texto: string): Promise<string | null> {
    if (!texto) return null;
    try {
      const r = await this.facturacion.apiGet(`/documents/${Number(docId)}/attributes.json`);
      const obs = (r?.items || []).find((a: any) => /observaci/i.test(String(a?.name || '')));
      if (String(obs?.value || '').replace(/\s+/g, ' ').trim() === texto) return null;
    } catch {
      return null; // la verificación no frena nada
    }
    return `La guía ${numero} quedó sin la Observación en Bsale: agrégala a mano («${texto.slice(0, 80)}${texto.length > 80 ? '…' : ''}»).`;
  }

  private vista(b: any, extra: Record<string, any>) {
    return {
      emisor: EMISOR,
      cliente: { razon_social: extra.clienteNuevo?.company || b.cliente.razon_social, rut: extra.clienteNuevo?.code || b.cliente.rut, giro: extra.clienteNuevo?.activity || b.cliente.giro, direccion: extra.clienteNuevo?.address || b.cliente.direccion, comuna: extra.clienteNuevo?.municipality || b.cliente.comuna, nuevo: b.cliente.nuevo },
      referencias: b.referencias.map(referenciaVista),
      ...extra,
    };
  }

  // ── Emisión: guía ──────────────────────────────────────────────────────

  async emitirGuia(
    usuario: { id: string; email: string },
    body: {
      licitacion_id: number; oc_doc_id: number; lineas: { sku: string; cantidad: number }[];
      despacho?: { direccion?: string; comuna?: string; ciudad?: string; destinatario?: string; tipo_traslado_id?: number };
      // Empresa de transporte y N° de seguimiento: solo para el sistema, no van a Bsale.
      seguimiento?: { empresa?: string; numero?: string };
      // Atributo adicional «Observación» en Bsale (sin enviar = la propuesta del borrador).
      observacion?: string;
      cliente?: Record<string, any>; fecha_emision?: string; huella?: string; simular?: boolean;
    },
  ) {
    await this.facturacion.exigirRol(usuario.id);
    const real = this.facturacion.emisionActiva && body?.simular !== true;
    const b: any = await this.armarBorradorGuia(Number(body?.licitacion_id), Number(body?.oc_doc_id));
    if (b.problemas.length) throw new BadRequestException(`No se puede emitir: ${b.problemas.map((p: Problema) => p.mensaje).join(' ')}`);
    if (!body?.huella || body.huella !== b.huella) throw new ConflictException('La orden cambió desde que revisaste el borrador (otra guía, otro cliente o precios). Vuelve a abrirlo.');

    // Cantidades elegidas: solo líneas del borrador, nunca más que lo pendiente.
    const porSku = new Map<string, any>(b.lineas.map((l: any) => [l.sku, l]));
    const elegidas: any[] = [];
    for (const e of Array.isArray(body?.lineas) ? body.lineas : []) {
      const l = porSku.get(normSku(e?.sku));
      const cant = Number(e?.cantidad);
      if (!l || !(cant > 0)) continue;
      if (!l.en_bsale) throw new BadRequestException(`El SKU ${l.sku} no está en Bsale.`);
      if (cant > l.pendiente + 1e-9) throw new BadRequestException(`${l.sku}: no se pueden despachar ${cant} si faltan ${l.pendiente}.`);
      elegidas.push({ ...l, cantidad: cant, neto: Math.round(cant * l.neto_unitario) });
    }
    if (!elegidas.length) throw new BadRequestException('Indica qué productos y cuánto va en esta guía.');

    const fecha = String(body?.fecha_emision || b.fecha_emision).slice(0, 10);
    if (!Number.isFinite(fechaAEpoch(fecha))) throw new BadRequestException('La fecha de emisión no es válida.');
    if (fecha > b.fecha_maxima) throw new BadRequestException('La fecha de emisión no puede ser futura.');
    if (fecha < b.fecha_minima) throw new BadRequestException(`La fecha de emisión no puede ser anterior a la orden de compra (${b.fecha_minima}).`);

    const d = body?.despacho || {};
    const despacho = {
      direccion: texto(d.direccion ?? b.despacho.direccion, 120),
      comuna: texto(d.comuna ?? b.despacho.comuna, 60),
      ciudad: texto(d.ciudad ?? b.despacho.ciudad, 60),
      destinatario: texto(d.destinatario ?? b.despacho.destinatario, 120),
      tipo_traslado_id: Number(d.tipo_traslado_id ?? b.despacho.tipo_traslado_id),
    };
    const faltas: string[] = [];
    if (!despacho.direccion) faltas.push('la dirección de entrega');
    if (!despacho.comuna) faltas.push('la comuna');
    if (!despacho.ciudad) faltas.push('la ciudad');
    if (!despacho.destinatario) faltas.push('el destinatario');
    const traslado = b.tipos_traslado.find((t: any) => t.id === despacho.tipo_traslado_id);
    if (!traslado) faltas.push('el tipo de traslado');
    const problemasCliente: string[] = [];
    const cli = this.clienteSolicitud(b.cliente, body?.cliente, problemasCliente);
    if (faltas.length) throw new BadRequestException(`Falta ${faltas.join(', ')}.`);
    if (problemasCliente.length) throw new BadRequestException(problemasCliente.join(' '));

    const totales = totalesDe(elegidas);
    const clave = `AMS-G-${b.cotizacion.id}-${b.oc.id}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    const emision = fechaAEpoch(fecha);
    const solicitud: Record<string, any> = {
      documentTypeId: b.tipo_documento_id,
      emissionDate: emision,
      expirationDate: emision,
      declareSii: 1,
      shippingTypeId: despacho.tipo_traslado_id,
      address: despacho.direccion,
      municipality: despacho.comuna,
      city: despacho.ciudad,
      recipient: despacho.destinatario,
      ...('clientId' in cli ? { clientId: cli.clientId } : { client: cli.client }),
      // Con orden registrada en Bsale, las líneas salen de ella (así Bsale las enlaza).
      details: elegidas.map((l) =>
        l.detalle_id ? { detailId: l.detalle_id, quantity: l.cantidad } : { code: l.sku, quantity: l.cantidad, netUnitValue: l.neto_unitario, taxId: `[${IVA_ID}]` },
      ),
      references: b.referencias.map((r: any) => referenciaParaBsale(r, emision)),
      salesId,
    };
    const obs = await this.observacionParaBsale(body?.observacion === undefined ? b.observacion_sugerida : body.observacion, b.tipo_documento_id);
    if (obs.atributo) solicitud.dynamicAttributes = [obs.atributo];
    const vista = this.vista(b, {
      observacion: obs.texto || null,
      tipo: 'Guía de despacho electrónica',
      sii: true,
      descuenta_stock: true,
      clienteNuevo: (cli as any).clienteNuevo,
      lineas: elegidas.map((l) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto, pendiente_despues: Math.max(0, l.pendiente - l.cantidad) })),
      totales,
      fecha_emision: fecha,
      despacho: { ...despacho, tipo_traslado: traslado?.nombre || null },
      notas: [
        b.orden_bsale ? `Las líneas salen de la orden ${b.orden_bsale.numero} registrada en Bsale.` : 'Los precios son los de la cotización.',
        'Bsale descuenta el stock al emitir la guía.',
        ...(obs.aviso ? [obs.aviso] : []),
      ],
    });
    if (!real) return { simulacion: true, emision_apagada: body?.simular !== true, solicitud, totales, vista };

    return this.emitirReal({
      usuario, clave, salesId, tipo: 'guia', ruta: '/shippings.json', solicitud, vista,
      licitacionId: b.cotizacion.id, origenDocId: b.oc.id,
      lineas: elegidas.map((l) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      registrar: async (doc: any, pdf: any) => {
        // La guía queda en Trazabilidad como si se hubiera subido a mano (y avisa al vendedor).
        const creado = await this.licitaciones.createDocumento({
          licitacion_id: b.cotizacion.id,
          tipo: 'guia_despacho',
          numero: String(doc.number),
          monto: null,
          fecha_oc: fecha,
          deriva_de_id: b.oc.id,
          // Empresa de transporte y N° de seguimiento (opcionales: el N° se puede agregar después).
          empresa_despacho: String(body?.seguimiento?.empresa || '').trim().slice(0, 60) || null,
          n_seguimiento: String(body?.seguimiento?.numero || '').trim().slice(0, 80) || null,
          bucket: pdf ? 'guia-despacho' : null,
          storage_path: pdf?.path || null,
          file_name: pdf ? `Guía ${doc.number}.pdf` : null,
          mime_type: pdf ? 'application/pdf' : null,
          size_bytes: pdf?.size || null,
          bsale_id: Number(doc.id) || null,
          bsale_url: doc.urlPdf || doc.urlPublicView || null,
        });
        return Number((creado as any)?.id) || null;
      },
      verificar: async (doc: any) => {
        // ¿Quedó con la referencia a la orden de compra? (/shippings podría ignorarla)
        const avisos: string[] = [];
        try {
          const completo = await this.facturacion.apiGet(`/documents/${Number(doc.id)}.json?expand=[references]`);
          const refs: any[] = completo?.references?.items || [];
          if (b.referencias.length && !refs.some((r: any) => ocDeReferencia(r) === b.referencias[0].numero)) {
            avisos.push(`La guía ${doc.number} salió SIN la referencia a la orden de compra ${b.referencias[0].numero}: agrégala en Bsale.`);
          }
          if (Number.isFinite(Number(completo?.totalAmount)) && Math.abs(Number(completo.totalAmount) - totales.total) > 1) {
            avisos.push(`Bsale calculó $${Number(completo.totalAmount).toLocaleString('es-CL')} y el borrador decía $${totales.total.toLocaleString('es-CL')}.`);
          }
        } catch { /* la verificación no frena nada */ }
        const sinObs = obs.atributo ? await this.avisoObservacion(Number(doc.id), doc.number, obs.texto) : null;
        if (sinObs) avisos.push(sinObs);
        return avisos;
      },
    });
  }

  // ── Emisión: orden (nota de venta) ─────────────────────────────────────

  async emitirOrden(
    usuario: { id: string; email: string },
    body: { licitacion_id: number; oc_doc_id: number; cliente?: Record<string, any>; fecha_emision?: string; huella?: string; simular?: boolean },
  ) {
    await this.facturacion.exigirRol(usuario.id);
    const real = this.facturacion.emisionActiva && body?.simular !== true;
    const b: any = await this.armarBorradorOrden(Number(body?.licitacion_id), Number(body?.oc_doc_id));
    if (b.problemas.length) throw new BadRequestException(`No se puede registrar: ${b.problemas.map((p: Problema) => p.mensaje).join(' ')}`);
    if (!body?.huella || body.huella !== b.huella) throw new ConflictException('La cotización cambió desde que revisaste el borrador. Vuelve a abrirlo.');
    const fecha = String(body?.fecha_emision || b.fecha_emision).slice(0, 10);
    if (!Number.isFinite(fechaAEpoch(fecha)) || fecha > b.fecha_maxima || fecha < b.fecha_minima) throw new BadRequestException('La fecha no es válida.');
    const problemasCliente: string[] = [];
    const cli = this.clienteSolicitud(b.cliente, body?.cliente, problemasCliente);
    if (problemasCliente.length) throw new BadRequestException(problemasCliente.join(' '));
    const emitibles = b.lineas.filter((l: any) => l.en_bsale);
    const totales = totalesDe(emitibles);
    const clave = `AMS-O-${b.cotizacion.id}-${b.oc.id}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    const emision = fechaAEpoch(fecha);
    const solicitud: Record<string, any> = {
      documentTypeId: b.tipo_documento_id,
      emissionDate: emision,
      expirationDate: fechaAEpoch(sumarDias(fecha, b.dias_vencimiento)),
      declareSii: 0,
      ...('clientId' in cli ? { clientId: cli.clientId } : { client: cli.client }),
      details: emitibles.map((l: any) => ({ code: l.sku, quantity: l.cantidad, netUnitValue: l.neto_unitario, taxId: `[${IVA_ID}]` })),
      references: b.referencias.map((r: any) => referenciaParaBsale(r, emision)),
      salesId,
    };
    const vista = this.vista(b, {
      tipo: `Orden en Bsale (${b.tipo_documento})`,
      sii: false,
      descuenta_stock: false,
      clienteNuevo: (cli as any).clienteNuevo,
      lineas: emitibles.map((l: any) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto })),
      totales,
      fecha_emision: fecha,
      vencimiento: sumarDias(fecha, b.dias_vencimiento),
      notas: ['No va al SII ni mueve stock: deja la orden del cliente registrada en Bsale para despacharla y facturarla desde ahí.'],
    });
    if (!real) return { simulacion: true, emision_apagada: body?.simular !== true, solicitud, totales, vista };

    return this.emitirReal({
      usuario, clave, salesId, tipo: 'nota_venta', ruta: '/documents.json', solicitud, vista,
      licitacionId: b.cotizacion.id, origenDocId: b.oc.id,
      lineas: emitibles.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      registrar: async (doc: any) => {
        // La orden de compra del sistema queda enlazada a su nota de venta.
        const { error } = await this.supabase
          .getClient()
          .from('licitacion_documentos')
          .update({ bsale_id: Number(doc.id) || null, bsale_url: doc.urlPublicView || doc.urlPdf || null })
          .eq('id', b.oc.id);
        if (error) throw new Error(error.message);
        return b.oc.id;
      },
      verificar: async () => [],
      sinPdf: true,
    });
  }

  // ── Emisión real (común) ───────────────────────────────────────────────

  async emitirReal(p: {
    usuario: { id: string; email: string }; clave: string; salesId: string; tipo: 'guia' | 'nota_venta' | 'factura' | 'boleta' | 'nota_credito'; ruta: string;
    solicitud: Record<string, any>; vista: any; licitacionId: number | null; origenDocId: number | null; lineas: any[];
    registrar: (doc: any, pdf: { path: string; size: number } | null) => Promise<number | null>;
    verificar: (doc: any) => Promise<string[]>; sinPdf?: boolean; bucket?: string;
  }) {
    const db = this.supabase.getClient();
    const fila = {
      sales_id: p.salesId, clave: p.clave, tipo: p.tipo, licitacion_id: p.licitacionId, guias_doc_ids: [] as number[],
      origen_doc_id: p.origenDocId, lineas: p.lineas, estado: 'enviando', solicitud: p.solicitud, usuario: p.usuario.email || null,
      error: null as string | null, updated_at: new Date().toISOString(),
    };
    const { data: previa, error: errPrevia } = await db.from('bsale_emisiones').select('id, estado, updated_at').eq('sales_id', p.salesId).maybeSingle();
    if (errPrevia) throw new BadRequestException('Falta aplicar la migración de emisiones de Bsale (bsale_emisiones). Sin ese registro no se emite.');
    let emisionId: number;
    if (previa) {
      const reciente = Date.now() - new Date((previa as any).updated_at).getTime() < 90 * 1000;
      if ((previa as any).estado === 'enviando' && reciente) throw new ConflictException('Ya hay una emisión en curso para esta orden. Espera un momento.');
      if ((previa as any).estado === 'incierta') {
        throw new ConflictException('El intento anterior quedó sin confirmar: revisa en Bsale si el documento se emitió antes de volver a intentar (vuelve a abrir el borrador: lo ya despachado se descuenta solo).');
      }
      const { error } = await db.from('bsale_emisiones').update(fila).eq('id', (previa as any).id);
      if (error) throw new BadRequestException(error.message);
      emisionId = (previa as any).id;
    } else {
      const { data, error } = await db.from('bsale_emisiones').insert([fila]).select('id').single();
      if (error) {
        if (/tipo|origen_doc_id|lineas/.test(String(error.message)) && /column|schema cache/i.test(String(error.message))) {
          throw new BadRequestException('Falta aplicar la migración 20261004_bsale_emisiones_tipo.sql en Supabase (guías y órdenes en Bsale).');
        }
        if (/licitacion_id/.test(String(error.message)) && /null/i.test(String(error.message))) {
          throw new BadRequestException('Falta aplicar la migración 20261005_bsale_emisiones_libre.sql en Supabase (documentos libres).');
        }
        throw new ConflictException('Ya hay una emisión en curso para esta orden.');
      }
      emisionId = (data as any).id;
    }

    let respuesta: any = null;
    try {
      respuesta = await this.facturacion.apiPost(p.ruta, p.solicitud);
    } catch (e: any) {
      const incierta = e?.incierta === true;
      await db.from('bsale_emisiones').update({ estado: incierta ? 'incierta' : 'error', error: String(e?.message || e).slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', emisionId);
      if (incierta) throw new BadGatewayException('Bsale no respondió y no se sabe si el documento se emitió. Revisa en Bsale antes de volver a intentar.');
      throw new BadRequestException(`Bsale rechazó el documento: ${String(e?.message || e).slice(0, 400)}`);
    }
    // /shippings.json devuelve el despacho con su guía adentro; /returns.json, la
    // devolución con su nota de crédito; /documents.json, el documento.
    let doc: any = respuesta?.guide || respuesta?.credit_note || respuesta?.document || respuesta;
    const idInterno = Number(respuesta?.guide?.id || respuesta?.credit_note?.id) || 0;
    if (doc && !doc.number && idInterno) {
      try { doc = await this.facturacion.apiGet(`/documents/${idInterno}.json`); } catch { /* se sigue con lo que hay */ }
    }
    const emitida = {
      estado: 'emitida', respuesta, bsale_id: Number(doc?.id) || null, numero: doc?.number != null ? String(doc.number) : null,
      neto: Number(doc?.netAmount) || null, total: Number(doc?.totalAmount) || null, url_pdf: doc?.urlPdf || doc?.urlPublicView || null,
      fecha_emision: epochAFecha(p.solicitud.emissionDate), updated_at: new Date().toISOString(),
    };
    await db.from('bsale_emisiones').update(emitida).eq('id', emisionId);
    this.logger.log(`${p.tipo === 'guia' ? 'Guía' : p.tipo === 'factura' ? 'Factura' : p.tipo === 'boleta' ? 'Boleta' : p.tipo === 'nota_credito' ? 'Nota de crédito' : 'Nota de venta'} ${emitida.numero} emitida en Bsale (${p.licitacionId ? `cotización ${p.licitacionId}` : 'libre'}) por ${p.usuario.email}`);

    const avisos = await p.verificar(doc);
    let pdf: { path: string; size: number } | null = null;
    if (!p.sinPdf && emitida.url_pdf) {
      for (let intento = 0; intento < 4 && !pdf; intento++) {
        try {
          const r = await fetch(String(emitida.url_pdf));
          if (r.ok && /pdf/i.test(r.headers.get('content-type') || '')) {
            const buf = Buffer.from(await r.arrayBuffer());
            const path = `${p.licitacionId || 'libre'}/${Date.now()}-bsale-${p.tipo}-${emitida.numero || emitida.bsale_id}.pdf`;
            const { error } = await db.storage.from(p.bucket || 'guia-despacho').upload(path, buf, { contentType: 'application/pdf', upsert: false });
            if (!error) pdf = { path, size: buf.length };
          }
        } catch { /* se reintenta */ }
        if (!pdf) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!pdf) avisos.push('No se pudo guardar el PDF en el sistema; se puede ver desde Bsale.');
    }
    let documentoId: number | null = null;
    try {
      documentoId = await p.registrar(doc, pdf);
      /* (2026-10-07) La venta directa crea su cotización al registrar: el
         registro de la emisión nació sin ella y la pestaña «Venta directa» no
         la mostraba. Se toma de la cotización donde quedó el documento. */
      let licitacionId = p.licitacionId;
      if (!licitacionId && documentoId) {
        const { data: d } = await db.from('licitacion_documentos').select('licitacion_id').eq('id', documentoId).maybeSingle();
        licitacionId = Number((d as any)?.licitacion_id) || null;
      }
      await db.from('bsale_emisiones').update({ documento_id: documentoId, ...(licitacionId ? { licitacion_id: licitacionId } : {}), updated_at: new Date().toISOString() }).eq('id', emisionId);
    } catch (e: any) {
      this.logger.error(`${p.tipo} ${emitida.numero} emitida en Bsale pero NO registrada en el sistema: ${e?.message || e}`);
      avisos.push(`El documento ${emitida.numero} se emitió en Bsale pero no quedó registrado en la cotización (${String(e?.message || e).slice(0, 120)}). Regístralo a mano en Trazabilidad.`);
    }
    return { emitida: true, registrada: !!documentoId, tipo: p.tipo, numero: emitida.numero, neto: emitida.neto, total: emitida.total, url_pdf: emitida.url_pdf, documento_id: documentoId, vista: p.vista, avisos };
  }
}
