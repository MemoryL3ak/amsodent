import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BsaleFacturacionService, EMISOR, epochAFecha } from './bsale-facturacion.service';

/* ── Impresión en formato carta (2026-10-07) ─────────────────────────────────
   Pedido de Ariel: "revisar formato de impresión de guías, facturas, boletas y
   notas de crédito: por defecto trae un formato de impresión térmica, pero la
   idea es tener también la opción en formato normal".
   En la cuenta de Bsale el formato va por TIPO de documento: «BOLETA
   ELECTRÓNICA T» y «NOTA DE DÉBITO ELECTRÓNICA T» salen en rollo térmico de
   80 mm; factura, guía y nota de crédito ya salen en hoja (~200×270 mm). Bsale
   no tiene parámetro para cambiar el formato del PDF (probado 2026-10-07).
   Por eso se arma aquí una representación impresa en CARTA con los datos del
   documento en Bsale y su timbre electrónico (urlTimbre, la imagen PDF417 que
   exige el SII), y el front la dibuja en PDF. Datos fijos del emisor:
   EMISOR, resolución SII y dónde verificar, tal como los imprime Bsale. */

const NOMBRE_DTE: Record<number, string> = {
  33: 'Factura electrónica', 34: 'Factura exenta electrónica', 39: 'Boleta electrónica', 41: 'Boleta exenta electrónica',
  52: 'Guía de despacho electrónica', 56: 'Nota de débito electrónica', 61: 'Nota de crédito electrónica',
  801: 'Orden de compra', 802: 'Nota de pedido', 803: 'Contrato', 804: 'Resolución', 805: 'Proceso ChileCompra', HES: 'HES',
} as any;

const rutConPuntos = (rut: any) => {
  const limpio = String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return String(rut || '');
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
};

@Injectable()
export class BsaleImpresionService {
  constructor(private facturacion: BsaleFacturacionService) {}

  get resolucion(): string {
    return process.env.BSALE_RESOLUCION_SII || 'Res. 80 del 22-08-2014';
  }

  async datos(bsaleId: number) {
    const id = Number(bsaleId);
    if (!id) throw new BadRequestException('Falta el documento.');
    if (!this.facturacion.configurado) throw new BadRequestException('La integración con Bsale no está configurada.');
    const d = await this.facturacion.apiGet(`/documents/${id}.json?expand=[references,payments,client,document_type,sellers]`);
    if (!d?.id) throw new NotFoundException('El documento no está en Bsale.');
    const detalles = await this.facturacion.todos(`/documents/${id}/details.json`, '&expand=[variant,product]');
    const { dte } = await this.facturacion.listas();

    const tipoNombre = String(d.document_type?.name || '').trim();
    const codigoSii = Number(d.document_type?.codeSii) || 0;
    const esBoleta = codigoSii === 39 || codigoSii === 41;
    // Las boletas muestran precios con IVA (así las imprime Bsale); el resto, netos.
    const conIva = esBoleta;

    let timbre: string | null = null;
    if (d.urlTimbre) {
      try {
        const r = await fetch(String(d.urlTimbre), { signal: AbortSignal.timeout(12000) });
        if (r.ok) timbre = `data:${(r.headers.get('content-type') || 'image/png').split(';')[0]};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
      } catch { /* sin timbre: el PDF lo avisa */ }
    }

    const c = d.client || {};
    const nombreCliente = String(c.company || `${c.firstName || ''} ${c.lastName || ''}`).trim();
    return {
      emisor: { ...EMISOR, rut: EMISOR.rut },
      resolucion: this.resolucion,
      verificacion: esBoleta ? 'Verifique documentos en: http://tuboleta.bsale.cl' : 'Verifique documento: www.sii.cl',
      tipo: (NOMBRE_DTE[codigoSii] || tipoNombre.replace(/\s+T$/i, '')).toUpperCase(),
      codigo_sii: codigoSii,
      numero: String(d.number ?? ''),
      fecha: epochAFecha(d.emissionDate),
      vencimiento: epochAFecha(d.expirationDate),
      formato_bsale: /\sT$/i.test(tipoNombre) ? 'termica' : 'carta',
      url_pdf: d.urlPdf || null,
      cliente: {
        rut: rutConPuntos(c.code),
        razon_social: nombreCliente || 'Consumidor final',
        giro: String(c.activity || '').trim(),
        direccion: String(c.address || '').trim(),
        comuna: String(c.municipality || '').trim(),
        ciudad: String(c.city || '').trim(),
        email: String(c.email || '').trim(),
      },
      despacho: d.address ? { direccion: String(d.address || ''), comuna: String(d.municipality || ''), ciudad: String(d.city || '') } : null,
      forma_pago: ((d.payments?.items || d.payments || []) as any[]).map((p) => p?.name).filter(Boolean).join(', ') || null,
      vendedor: ((d.sellers?.items || []) as any[]).map((s) => `${s.firstName || ''} ${s.lastName || ''}`.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ') || null,
      lineas: detalles.map((x: any) => {
        const nombre = [String(x.product?.name || '').trim(), String(x.variant?.description || '').trim()].filter(Boolean).join(' · ') || String(x.note || x.comment || '').trim();
        return {
          codigo: String(x.variant?.code || '').trim(),
          descripcion: nombre || 'Detalle',
          cantidad: Number(x.quantity) || 0,
          precio_unitario: Math.round(Number(conIva ? x.totalUnitValue : x.netUnitValue) || 0),
          descuento_pct: Number(x.discountPercentage) || 0,
          total: Math.round(Number(conIva ? x.totalAmount : x.netAmount) || 0),
        };
      }),
      precios_con_iva: conIva,
      referencias: ((d.references?.items || []) as any[]).map((r) => {
        const cod = dte.get(Number(r?.dte_code?.id)) || 0;
        return { tipo: NOMBRE_DTE[cod] || `Documento ${cod || ''}`.trim(), folio: String(r.number || ''), fecha: epochAFecha(r.referenceDate), razon: String(r.reason || '') };
      }),
      totales: {
        neto: Math.round(Number(d.netAmount) || 0),
        exento: Math.round(Number(d.exemptAmount) || 0),
        iva: Math.round(Number(d.taxAmount) || 0),
        total: Math.round(Number(d.totalAmount) || 0),
      },
      timbre,
    };
  }
}
