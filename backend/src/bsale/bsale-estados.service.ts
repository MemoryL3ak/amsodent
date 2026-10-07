import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BsaleFacturacionService, folioGuia } from './bsale-facturacion.service';

/* ── Estado en Bsale de facturas, boletas y guías (2026-10-07) ───────────────
   Pedido de Ariel: "traerme el estado de las facturas, boletas, guías desde
   Bsale". Bsale dice, por documento (docs.bsale.dev/documentos):
     · state: 0 activo · 1 inactivo (anulado: las guías se anulan allá).
     · informedSii: 0 aceptado por el SII · 1 enviado (esperando) · 2 rechazado.
     · responseMsgSii: la respuesta del SII, tal cual.
   (commercialState no está documentado: no se muestra.)
   (2026-10-07) Pedido de Ariel: "al emitir una NC debemos ver reflejada esta
   anulación". Una nota de crédito NO cambia el estado de la factura en Bsale
   (sigue activa): se leen las devoluciones (/returns.json) y cada factura o
   boleta trae sus notas de crédito — completa (anulada) o parcial —, sean
   emitidas desde el sistema o hechas a mano en Bsale.
   Se leen TODAS las facturas, boletas y guías de Bsale (son cientos: ~20
   consultas) y se cruzan con los documentos del sistema por id de Bsale o,
   si se subieron a mano, por tipo + número. Caché de 10 minutos. */

export type Clase = 'factura' | 'boleta' | 'guia';
export type EstadoBsale = {
  estado: 'vigente' | 'anulado' | 'no_encontrado';
  sii: 'aceptado' | 'enviado' | 'rechazado' | null;
  sii_mensaje: string | null;
  bsale_id: number | null;
  numero: string | null;
  url: string | null;
  total: number | null;
  clase: Clase;
  // Notas de crédito que la referencian en Bsale: lo acreditado (bruto) y sus N°.
  nc: { total: number; numeros: string[]; completa: boolean } | null;
  // NC que solo corrigen texto (giro, dirección, forma de pago): no cambian el monto.
  nc_texto: string[];
};

const CODIGOS: Record<string, Clase> = { '33': 'factura', '34': 'factura', '39': 'boleta', '41': 'boleta', '52': 'guia' };
const siiDe = (v: any): EstadoBsale['sii'] => (Number(v) === 0 ? 'aceptado' : Number(v) === 1 ? 'enviado' : Number(v) === 2 ? 'rechazado' : null);

@Injectable()
export class BsaleEstadosService {
  private readonly logger = new Logger(BsaleEstadosService.name);
  private cache: { ts: number; datos: any } | null = null;
  private enCurso: Promise<any> | null = null;

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
  ) {}

  /* Todos los documentos de Bsale de las tres clases, indexados. */
  private async leerBsale() {
    const tipos = await this.facturacion.todos('/document_types.json', '&state=0');
    const porId = new Map<number, any>();
    const porClaseNumero = new Map<string, any>();
    const primero: Partial<Record<Clase, string>> = {};
    for (const t of tipos) {
      const clase = CODIGOS[String(t?.codeSii || '')];
      if (!clase || Number(t?.isElectronicDocument) !== 1) continue;
      const docs = await this.facturacion.todos('/documents.json', `&documenttypeid=${Number(t.id)}`);
      for (const d of docs) {
        const fila = {
          clase,
          bsale_id: Number(d.id),
          numero: String(d.number ?? ''),
          state: Number(d.state),
          informedSii: d.informedSii,
          responseMsgSii: d.responseMsgSii ?? null,
          url: d.urlPdf || d.urlPublicView || null,
          total: Number(d.totalAmount) || null,
          fecha: d.emissionDate ? new Date(Number(d.emissionDate) * 1000).toISOString().slice(0, 10) : null,
        };
        porId.set(fila.bsale_id, fila);
        // Si el mismo número existe dos veces (otro tipo de la misma clase), manda el vigente.
        const k = `${clase}|${fila.numero}`;
        const previa = porClaseNumero.get(k);
        if (!previa || (previa.state !== 0 && fila.state === 0)) porClaseNumero.set(k, fila);
        if (fila.fecha && (!primero[clase] || fila.fecha < (primero[clase] as string))) primero[clase] = fila.fecha;
      }
    }
    // Notas de crédito: devoluciones de Bsale con su documento de referencia
    // (amount = bruto acreditado; la NC expandida trae su N° y su estado).
    // Una NC anulada en Bsale no cuenta; las que solo corrigen texto
    // (editTexts = 1, monto 0) van aparte. Si falla, los estados salen igual.
    const ncPorDoc = new Map<number, { total: number; numeros: string[]; texto: string[] }>();
    try {
      for (const r of await this.facturacion.todos('/returns.json', '&expand=[reference_document,credit_note]')) {
        const ref = Number(r?.reference_document?.id);
        if (!ref || Number(r?.credit_note?.state) === 1) continue;
        const x = ncPorDoc.get(ref) || { total: 0, numeros: [], texto: [] };
        const numero = r?.credit_note?.number != null ? String(r.credit_note.number) : '';
        if (Number(r?.amount) > 0) {
          x.total += Number(r.amount);
          if (numero) x.numeros.push(numero);
        } else if (numero) x.texto.push(numero);
        ncPorDoc.set(ref, x);
      }
    } catch (e: any) {
      this.logger.warn(`No se pudieron leer las notas de crédito de Bsale: ${e?.message || e}`);
    }
    return { porId, porClaseNumero, primero, ncPorDoc };
  }

  /* Estado de cada factura / boleta / guía del sistema, por id del documento. */
  async estados(opts: { refrescar?: boolean } = {}) {
    if (!this.facturacion.configurado) return { configurado: false, estados: {}, resumen: null };
    if (!opts.refrescar && this.cache && Date.now() - this.cache.ts < 10 * 60 * 1000) return this.cache.datos;
    if (this.enCurso) return this.enCurso;
    this.enCurso = this.calcular()
      .then((datos) => { this.cache = { ts: Date.now(), datos }; return datos; })
      .finally(() => { this.enCurso = null; });
    return this.enCurso;
  }

  private async calcular() {
    const { porId, porClaseNumero, primero, ncPorDoc } = await this.leerBsale();
    const db = this.supabase.getClient();
    const docs: any[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await db
        .from('licitacion_documentos')
        .select('id, tipo, numero, bsale_id, descripcion, fecha_factura, fecha_oc, created_at')
        .in('tipo', ['factura', 'factura_boleta', 'guia_despacho'])
        .range(desde, desde + 999);
      if (error) throw new Error(error.message);
      docs.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const estados: Record<number, EstadoBsale> = {};
    const resumen = { revisados: 0, vigentes: 0, anulados: 0, anulados_nc: 0, con_nc_parcial: 0, sii_pendiente: 0, sii_rechazado: 0, no_encontrados: 0 };
    for (const d of docs) {
      const clases: Clase[] = d.tipo === 'guia_despacho'
        ? ['guia']
        : d.tipo === 'factura'
          ? ['factura']
          : /boleta/i.test(String(d.descripcion || '')) ? ['boleta', 'factura'] : ['factura', 'boleta'];
      const folio = folioGuia(d.numero);
      let b: any = d.bsale_id ? porId.get(Number(d.bsale_id)) : null;
      if (!b && folio) for (const c of clases) { b = porClaseNumero.get(`${c}|${folio}`); if (b) break; }
      const fecha = String(d.fecha_factura || d.fecha_oc || d.created_at || '').slice(0, 10);
      if (!b) {
        // Solo cuenta como "no encontrado" si es de cuando ya se emitía en Bsale.
        const desde = primero[clases[0]];
        if (!folio || !desde || !fecha || fecha < desde) continue;
        estados[d.id] = { estado: 'no_encontrado', sii: null, sii_mensaje: null, bsale_id: null, numero: folio, url: null, total: null, clase: clases[0], nc: null, nc_texto: [] };
        resumen.revisados++; resumen.no_encontrados++;
        continue;
      }
      const nc = ncPorDoc.get(b.bsale_id);
      const e: EstadoBsale = {
        nc: nc && nc.total > 0 ? { total: nc.total, numeros: nc.numeros, completa: !!b.total && nc.total >= b.total - 2 } : null,
        nc_texto: nc?.texto || [],
        estado: b.state === 1 ? 'anulado' : 'vigente',
        sii: siiDe(b.informedSii),
        sii_mensaje: b.responseMsgSii,
        bsale_id: b.bsale_id,
        numero: b.numero,
        url: b.url,
        total: b.total,
        clase: b.clase,
      };
      estados[d.id] = e;
      resumen.revisados++;
      if (e.estado === 'anulado') resumen.anulados++; else resumen.vigentes++;
      if (e.nc?.completa) resumen.anulados_nc++; else if (e.nc) resumen.con_nc_parcial++;
      if (e.sii === 'enviado') resumen.sii_pendiente++;
      if (e.sii === 'rechazado') resumen.sii_rechazado++;
    }
    this.logger.log(`Estados Bsale: ${JSON.stringify(resumen)}`);
    return { configurado: true, actualizado_at: new Date().toISOString(), estados, resumen };
  }

  /* Recién emitida una nota de crédito desde el sistema: se anota en la caché
     para que la factura salga anulada / con NC al tiro, sin releer Bsale
     entero (~18 s). La próxima lectura completa la confirma. */
  anotarNotaCredito(bsaleIdReferencia: number, nc: { numero: string | number | null; total: number | null }) {
    const datos = this.cache?.datos;
    if (!datos?.estados || !bsaleIdReferencia || !(Number(nc.total) > 0)) return;
    for (const e of Object.values(datos.estados) as EstadoBsale[]) {
      if (e.bsale_id !== Number(bsaleIdReferencia)) continue;
      const total = (e.nc?.total || 0) + Number(nc.total);
      const numeros = [...(e.nc?.numeros || []), ...(nc.numero != null ? [String(nc.numero)] : [])];
      e.nc = { total, numeros, completa: !!e.total && total >= e.total - 2 };
    }
  }
}
