import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';
import { BsaleFacturacionService, EMISOR, epochAFecha, fechaAEpoch, normRut, totalesDe } from './bsale-facturacion.service';
import { BsaleDespachosService } from './bsale-despachos.service';
import { BsaleEstadosService } from './bsale-estados.service';
import { DevolucionesService, DineroNc } from '../licitaciones/devoluciones.service';

/* ── Anular facturas y boletas en Bsale con nota de crédito (2026-10-03) ─────
   Pedido de Ariel: "implementa lo de anular documentos". En Chile una factura
   o boleta electrónica no se borra: se anula con una NOTA DE CRÉDITO que la
   referencia. En Bsale eso es una DEVOLUCIÓN (POST /returns.json): Bsale emite
   la nota de crédito (tipo 61) y reingresa al stock lo devuelto — así están
   las 77 notas de crédito de la cuenta (p. ej. la devolución 14 anula la
   factura 415 completa, type 2, y sus 200 unidades volvieron al stock).

   Mismos dos pasos que todo lo demás: simular (vista de la nota de crédito) y
   después emitir la oficial. Se anula el documento COMPLETO.
   · El documento se busca en Bsale por su id, por el documento del sistema
     (Trazabilidad) o por tipo + N°: sirve también para las facturas hechas a
     mano en Bsale.
   · No deja anular dos veces: si Bsale ya tiene una devolución de ese
     documento, se bloquea (una nota parcial se completa en Bsale).
   · Si el documento está en una cotización, la nota de crédito queda ahí como
     `nota_credito` (monto BRUTO, como se cargan a mano) colgada de la factura,
     y Seguimiento de Pagos la descuenta del saldo.
   · Las GUÍAS no: no hay forma documentada de anularlas por la API; se anulan
     en Bsale (en la cuenta hay 25 anuladas así).
   `/returns.json` no recibe `salesId`: si la respuesta se pierde, la emisión
   queda "incierta" y no se reintenta hasta revisar en Bsale (emitirReal).

   (2026-10-07) Pedido de Ariel: "permitir generar notas de crédito y notas de
   débito a las facturas emitidas". La nota de crédito tiene tres modos (los
   documenta docs.bsale.dev/devoluciones):
   · total: anula el documento completo (lo de antes).
   · parcial: devuelve parte de las cantidades; Bsale reingresa ese stock.
   · ajuste: rebaja de precio por unidad (priceAdjustment: 1), sin devolver
     productos ni mover stock.
   Se pueden emitir varias parciales/ajustes mientras quede saldo; por línea
   no se devuelve más de lo que queda (las de ajuste no devuelven unidades). */

const DTE_FACTURA = 33;
const DTE_BOLETA = 39;
const DTE_NC = 61;
const DTE_ND = 56;
const IVA_ID = 1; // "IVA 19%" en la cuenta de Amsodent (igual que en despachos y libre)
const DTE_GUIA = 52;

export const MODOS_NC = [
  { id: 'total', nombre: 'Anular completa', detalle: 'Anula todo el documento y reingresa todo su stock.' },
  { id: 'parcial', nombre: 'Devolución parcial', detalle: 'Devuelve parte de los productos: se elige cuánto de cada línea y Bsale reingresa ese stock.' },
  { id: 'ajuste', nombre: 'Ajuste de precio', detalle: 'Rebaja el precio por unidad sin devolver productos (no mueve stock).' },
];

/* Qué pasa con el dinero (2026-10-08). Pedido de Ariel: "si se devolverá el
   dinero o se dejará como saldo a favor se determina en el proceso de emisión
   de la NC". `bsale` es el campo `type` de la devolución en Bsale (0 devuelve
   dinero de caja, 2 rebaja la deuda, 3 no mueve dinero); `id` es lo que la
   nota de crédito guarda en `dinero` y lo que Trazabilidad → Facturas usa
   para mostrar la devolución pendiente o el saldo a favor (DevolucionesService). */
export const TIPOS_DEVOLUCION: { id: DineroNc; bsale: number; nombre: string; detalle: string }[] = [
  { id: 'devolver', bsale: 0, nombre: 'Devolver el dinero al cliente', detalle: 'Ya pagó: queda una devolución pendiente en Trazabilidad → Facturas hasta registrar la transferencia o el efectivo devuelto.' },
  { id: 'saldo_favor', bsale: 3, nombre: 'Dejar saldo a favor del cliente', detalle: 'Ya pagó y el monto queda a su favor: se aplica a otra factura suya desde Trazabilidad → Facturas.' },
  { id: 'rebajar_deuda', bsale: 2, nombre: 'Rebajar la deuda (no había pagado)', detalle: 'Venta a crédito o sin pago: el documento deja de cobrarse; no hay dinero que devolver.' },
  { id: 'sin_movimiento', bsale: 3, nombre: 'Sin movimiento de dinero', detalle: 'Solo se anula el documento; el dinero, si lo hubo, se gestiona aparte.' },
];
// Lo que mandaba la pantalla antes (el `type` de Bsale a secas).
const LEGADO_DINERO: Record<string, DineroNc> = { '0': 'devolver', '2': 'rebajar_deuda', '3': 'sin_movimiento' };
export const dineroDe = (v: any) => TIPOS_DEVOLUCION.find((t) => t.id === String(v ?? '')) || TIPOS_DEVOLUCION.find((t) => t.id === LEGADO_DINERO[String(v ?? '')]) || null;

type Problema = { codigo: string; mensaje: string };

const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const texto = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
const nombreTipo = (sii: number) => (sii === DTE_BOLETA ? 'Boleta electrónica' : sii === DTE_FACTURA ? 'Factura electrónica' : sii === DTE_GUIA ? 'Guía de despacho electrónica' : 'Documento');

@Injectable()
export class BsaleAnulacionesService {
  private readonly logger = new Logger(BsaleAnulacionesService.name);

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
    private despachos: BsaleDespachosService,
    private licitaciones: LicitacionesService,
    private estados: BsaleEstadosService,
    private devoluciones: DevolucionesService,
  ) {}

  // ── Encontrar el documento ────────────────────────────────────────────

  private async tiposPorSii(): Promise<Map<number, any>> {
    const tipos = await this.facturacion.todos('/document_types.json', '&state=0');
    const m = new Map<number, any>();
    for (const t of tipos) if (Number(t.isElectronicDocument) === 1 && Number(t.codeSii)) m.set(Number(t.codeSii), t);
    return m;
  }

  private async documentoBsale(id: number) {
    return this.facturacion.apiGet(`/documents/${Number(id)}.json?expand=[details,client,document_type,office,payments]`);
  }

  /* Busca por N° entre los tipos indicados. Si hay más de uno, el que calce
     con el neto del sistema o, si no, con el RUT del cliente. */
  private async buscarPorNumero(numero: string, siis: number[], pista: { neto?: number | null; rut?: string | null } = {}) {
    const tipos = await this.tiposPorSii();
    const encontrados: any[] = [];
    for (const sii of siis) {
      const t = tipos.get(sii);
      if (!t) continue;
      const r = await this.facturacion.apiGet(`/documents.json?documenttypeid=${Number(t.id)}&number=${encodeURIComponent(numero)}&limit=10`);
      for (const d of r?.items || []) encontrados.push(d);
    }
    if (encontrados.length <= 1) return encontrados[0] || null;
    const porNeto = encontrados.filter((d) => pista.neto != null && Math.abs(Number(d.netAmount) - Number(pista.neto)) <= 2);
    if (porNeto.length === 1) return porNeto[0];
    if (pista.rut) {
      const conDetalle = await Promise.all(encontrados.map((d) => this.documentoBsale(Number(d.id))));
      const porRut = conDetalle.filter((d) => normRut(d?.client?.code) === normRut(pista.rut));
      if (porRut.length === 1) return porRut[0];
    }
    return encontrados[0];
  }

  /* Devoluciones que Bsale ya tiene para un documento (notas de crédito previas). */
  private async devolucionesDe(bsaleId: number) {
    const todas: any[] = await this.facturacion.todos('/returns.json', '&expand=[reference_document,credit_note]');
    return todas.filter((r) => Number(r?.reference_document?.id) === Number(bsaleId));
  }

  /* El documento del sistema (Trazabilidad) que corresponde al de Bsale. */
  private async registroDe(doc: any, documentoId: number | null) {
    const db = this.supabase.getClient();
    if (documentoId) {
      const { data } = await db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero').eq('id', documentoId).maybeSingle();
      if (data) return { documento_id: Number((data as any).id), licitacion_id: Number((data as any).licitacion_id) };
    }
    let r: any = await db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero').eq('bsale_id', Number(doc.id));
    let filas: any[] = r.error ? [] : r.data || [];
    if (!filas.length) {
      r = await db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero').eq('numero', String(doc.number)).in('tipo', ['factura', 'factura_boleta']);
      filas = r.data || [];
      if (filas.length > 1) {
        // Mismo N° en varias cotizaciones (factura y boleta comparten numeración distinta): el del RUT del cliente.
        const { data: lics } = await db.from('licitaciones').select('id, rut_entidad').in('id', filas.map((f) => Number(f.licitacion_id)));
        const rut = normRut(doc?.client?.code);
        const delCliente = filas.filter((f) => normRut((lics || []).find((l: any) => Number(l.id) === Number(f.licitacion_id))?.rut_entidad) === rut);
        filas = delCliente.length ? delCliente : filas;
      }
    }
    const f = filas[0];
    return f ? { documento_id: Number(f.id), licitacion_id: Number(f.licitacion_id) } : null;
  }

  /* Ubica el documento en Bsale: por su id, por el documento del sistema
     (Trazabilidad) o por tipo + N°. */
  private async ubicar(q: { bsale_id?: any; documento_id?: any; tipo?: any; numero?: any }) {
    const db = this.supabase.getClient();
    let doc: any = null;
    let documentoId: number | null = Number(q?.documento_id) || null;
    if (Number(q?.bsale_id) > 0) {
      doc = await this.documentoBsale(Number(q.bsale_id)).catch(() => null);
    } else if (documentoId) {
      const { data: d } = await db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero, monto, descripcion, bsale_id').eq('id', documentoId).maybeSingle();
      if (!d) throw new BadRequestException('Ese documento no existe en el sistema.');
      if (!['factura', 'factura_boleta'].includes(String((d as any).tipo))) throw new BadRequestException('Solo se anulan facturas y boletas (las guías se anulan en Bsale).');
      if (Number((d as any).bsale_id) > 0) doc = await this.documentoBsale(Number((d as any).bsale_id)).catch(() => null);
      if (!doc) {
        const numero = String((d as any).numero || '').trim().match(/\d+/)?.[0] || '';
        const esBoleta = /boleta/i.test(String((d as any).descripcion || ''));
        const { data: lic } = await db.from('licitaciones').select('rut_entidad').eq('id', Number((d as any).licitacion_id)).maybeSingle();
        const encontrado = numero
          ? await this.buscarPorNumero(numero, (d as any).tipo === 'factura' ? [DTE_FACTURA] : esBoleta ? [DTE_BOLETA] : [DTE_FACTURA, DTE_BOLETA], { neto: Number((d as any).monto) || null, rut: (lic as any)?.rut_entidad })
          : null;
        if (encontrado) doc = await this.documentoBsale(Number(encontrado.id));
      }
    } else {
      const numero = String(q?.numero ?? '').trim().match(/\d+/)?.[0] || '';
      if (!numero) throw new BadRequestException('Indica el N° del documento.');
      const sii = q?.tipo === 'boleta' ? DTE_BOLETA : DTE_FACTURA;
      const encontrado = await this.buscarPorNumero(numero, [sii]);
      if (encontrado) doc = await this.documentoBsale(Number(encontrado.id));
    }
    if (!doc?.id) throw new BadRequestException('No se encontró el documento en Bsale. Revisa el tipo y el N°.');
    return { doc, documentoId };
  }

  // ── Borrador ──────────────────────────────────────────────────────────

  async preparar(userId: string, q: { bsale_id?: any; documento_id?: any; tipo?: any; numero?: any }) {
    await this.facturacion.exigirRol(userId);
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    const db = this.supabase.getClient();

    // 1) Ubicar el documento en Bsale
    const { doc, documentoId } = await this.ubicar(q);

    // 2) ¿Se puede anular?
    const tipos = await this.tiposPorSii();
    const tipoDoc = [...tipos.values()].find((t) => Number(t.id) === Number(doc.document_type?.id));
    const sii = Number(tipoDoc?.codeSii) || 0;
    if (sii === DTE_GUIA) problemas.push({ codigo: 'guia', mensaje: 'Las guías de despacho no se anulan con nota de crédito: se anulan en Bsale.' });
    else if (sii !== DTE_FACTURA && sii !== DTE_BOLETA) problemas.push({ codigo: 'tipo', mensaje: `Solo se anulan facturas y boletas electrónicas (este es ${tipoDoc?.name || 'otro tipo de documento'}).` });
    if (Number(doc.state) !== 0) problemas.push({ codigo: 'inactivo', mensaje: 'El documento está inactivo en Bsale.' });
    const ncTipo = tipos.get(DTE_NC);
    if (!ncTipo) problemas.push({ codigo: 'sin_nc', mensaje: 'La cuenta de Bsale no tiene activa la nota de crédito electrónica.' });

    const previas = await this.devolucionesDe(Number(doc.id));
    const devueltoMonto = previas.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const saldoDisponible = Math.max(0, Number(doc.totalAmount || 0) - devueltoMonto);
    if (previas.length && saldoDisponible <= 2) {
      problemas.push({ codigo: 'ya_anulado', mensaje: `Este documento ya está anulado en Bsale (notas de crédito por $${devueltoMonto.toLocaleString('es-CL')}).` });
    } else if (previas.length) {
      avisos.push({ codigo: 'nc_previas', mensaje: `Ya tiene nota${previas.length === 1 ? '' : 's'} de crédito por $${devueltoMonto.toLocaleString('es-CL')}: queda un saldo de $${saldoDisponible.toLocaleString('es-CL')} para otra nota parcial o de ajuste.` });
    }
    // Unidades ya devueltas por línea (las de ajuste de precio no devuelven unidades).
    const devueltoPorDetalle = new Map<number, number>();
    for (const r of previas) {
      if (Number(r?.priceAdjustment) === 1) continue;
      const dets = await this.facturacion.todos(`/returns/${Number(r.id)}/details.json`).catch(() => [] as any[]);
      for (const d of dets) devueltoPorDetalle.set(Number(d.documentDetailId), (devueltoPorDetalle.get(Number(d.documentDetailId)) || 0) + (Number(d.quantity) || 0));
    }

    // 3) Líneas: se devuelve todo. Bsale entrega el detalle de a 25 líneas:
    // si hay más (factura 416: 41 líneas), se piden todas.
    let detalles: any[] = doc.details?.items || [];
    if (Number(doc.details?.count || 0) > detalles.length) {
      detalles = await this.facturacion.todos(`/documents/${Number(doc.id)}/details.json`, '&expand=[variant]');
    }
    const lineas = detalles.map((d: any) => ({
      detalle_id: Number(d.id),
      sku: String(d.variant?.code || '').trim(),
      producto: String(d.variant?.description || d.description || d.variant?.product?.name || '').trim() || String(d.note || '').trim(),
      cantidad: Number(d.quantity || 0),
      neto_unitario: Number(d.netUnitValue || 0),
      neto: Number(d.netAmount ?? Number(d.quantity || 0) * Number(d.netUnitValue || 0)) || 0,
      devuelto: devueltoPorDetalle.get(Number(d.id)) || 0,
      disponible: Math.max(0, Number(d.quantity || 0) - (devueltoPorDetalle.get(Number(d.id)) || 0)),
    }));
    if (!lineas.length) problemas.push({ codigo: 'sin_lineas', mensaje: 'El documento no tiene líneas en Bsale.' });
    // Bsale a veces no trae el nombre en el detalle: se busca la variante.
    for (const l of lineas) {
      if (!l.producto && l.sku) {
        const v = await this.despachos.variantePorSku(l.sku).catch(() => null);
        l.producto = String(v?.product?.name || '').trim();
      }
    }

    const registro = await this.registroDe(doc, documentoId);
    let cotizacion: any = null;
    if (registro) {
      const { data: lic } = await db.from('licitaciones').select('id, id_licitacion, nombre_entidad').eq('id', registro.licitacion_id).maybeSingle();
      cotizacion = lic ? { id: Number((lic as any).id), codigo: (lic as any).id_licitacion || null, cliente: (lic as any).nombre_entidad || '' } : null;
    } else {
      avisos.push({ codigo: 'sin_registro', mensaje: 'Este documento no está en ninguna cotización del sistema: la nota de crédito quedará solo en Bsale y en el historial de Emitidas.' });
    }

    const credito = (doc.payments?.items || doc.payments || []).some?.((p: any) => /cr[eé]dito/i.test(String(p?.name || p?.payment_type?.name || '')));
    // Lo que el cliente tiene pagado de este documento en el sistema: decide qué pasa con el dinero.
    let pago: { bruto: number; fecha: string | null; medio: string | null } = { bruto: 0, fecha: null, medio: null };
    if (registro) {
      try {
        const cf = await this.devoluciones.cuentaFactura(registro.documento_id);
        const ultimo = [...cf.pagos].sort((a: any, b: any) => String(b.fecha_oc || '').localeCompare(String(a.fecha_oc || '')))[0];
        pago = {
          bruto: Math.max(0, cf.pagado_bruto - cf.devuelto_bruto), fecha: ultimo?.fecha_oc || null,
          medio: ultimo?.forma_pago || (ultimo?.tipo === 'webpay' ? 'Webpay' : ultimo?.tipo === 'efectivo' ? 'Efectivo' : null),
        };
      } catch { /* sin cuenta en el sistema: se decide a mano */ }
    }
    const c = doc.client || null;
    return {
      original: {
        bsale_id: Number(doc.id),
        tipo: nombreTipo(sii),
        codigo_sii: sii,
        numero: String(doc.number),
        fecha: epochAFecha(doc.emissionDate),
        url: doc.urlPdf || doc.urlPublicView || null,
        cliente: c ? { rut: String(c.code || ''), razon_social: String(c.company || `${c.firstName || ''} ${c.lastName || ''}`).trim(), giro: String(c.activity || ''), direccion: String(c.address || ''), comuna: String(c.municipality || ''), ciudad: String(c.city || '') } : null,
        totales: { neto: Number(doc.netAmount || 0), iva: Number(doc.taxAmount || 0), total: Number(doc.totalAmount || 0) },
        lineas,
        oficina_id: Number(doc.office?.id) || 1,
      },
      nc_tipo_id: Number(ncTipo?.id) || null,
      modos: MODOS_NC,
      saldo: { devuelto: devueltoMonto, disponible: saldoDisponible },
      tipos_devolucion: TIPOS_DEVOLUCION,
      tipo_devolucion: pago.bruto > 0 ? 'devolver' : credito ? 'rebajar_deuda' : 'sin_movimiento',
      pago,
      cotizacion,
      registro,
      previas: previas.map((r) => ({ id: Number(r.id), monto: Number(r.amount) || 0, nota_credito_id: Number(r.credit_note?.id) || null, motivo: String(r.motive || '') })),
      problemas,
      avisos,
      fecha_emision: hoyEnChile(),
      modo: this.facturacion.emisionActiva ? 'activa' : 'simulacion',
      huella: this.facturacion.huellaDe({ cliente: { id: c?.id || c?.code || 'sin-cliente' }, tipo_documento_id: Number(doc.id), lineas: lineas.map((l: any) => ({ detalle_id: l.detalle_id, cantidad: l.cantidad, neto: l.neto_unitario })), referencias: previas.map((r) => ({ codigo_sii: 0, numero: String(r.id) })), totales: { total: Number(doc.totalAmount || 0) } }),
    };
  }

  // ── Nota de débito (2026-10-07) ──────────────────────────────────────
  /* Aumenta lo que el cliente debe por una factura (intereses, diferencia de
     precio, flete no cobrado…). En Bsale es un documento más (tipo 56, POST
     /documents.json) con líneas de texto libre y la referencia a la factura.
     La cuenta nunca había emitido una: tras emitir se relee para confirmar la
     referencia y el total. Queda en la cotización como `nota_debito` (BRUTO,
     igual que la nota de crédito) y Seguimiento de Pagos la suma al saldo. */
  async prepararDebito(userId: string, q: { bsale_id?: any; documento_id?: any; numero?: any }) {
    await this.facturacion.exigirRol(userId);
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    const db = this.supabase.getClient();
    const { doc, documentoId } = await this.ubicar({ ...q, tipo: 'factura' });
    const tipos = await this.tiposPorSii();
    const tipoDoc = [...tipos.values()].find((t) => Number(t.id) === Number(doc.document_type?.id));
    const sii = Number(tipoDoc?.codeSii) || 0;
    if (sii !== DTE_FACTURA) problemas.push({ codigo: 'tipo', mensaje: `La nota de débito se emite sobre facturas electrónicas (este es ${tipoDoc?.name || 'otro tipo de documento'}).` });
    if (Number(doc.state) !== 0) problemas.push({ codigo: 'inactivo', mensaje: 'La factura está anulada (inactiva) en Bsale.' });
    const ndTipo = tipos.get(DTE_ND);
    if (!ndTipo) problemas.push({ codigo: 'sin_nd', mensaje: 'La cuenta de Bsale no tiene activa la nota de débito electrónica.' });
    const registro = await this.registroDe(doc, documentoId);
    let cotizacion: any = null;
    if (registro) {
      const { data: lic } = await db.from('licitaciones').select('id, id_licitacion, nombre_entidad').eq('id', registro.licitacion_id).maybeSingle();
      cotizacion = lic ? { id: Number((lic as any).id), codigo: (lic as any).id_licitacion || null, cliente: (lic as any).nombre_entidad || '' } : null;
    } else {
      avisos.push({ codigo: 'sin_registro', mensaje: 'La factura no está en ninguna cotización del sistema: la nota de débito quedará solo en Bsale y en Emitidas.' });
    }
    const c = doc.client || null;
    return {
      original: {
        bsale_id: Number(doc.id),
        tipo: nombreTipo(sii),
        codigo_sii: sii,
        numero: String(doc.number),
        fecha: epochAFecha(doc.emissionDate),
        url: doc.urlPdf || doc.urlPublicView || null,
        cliente_id: Number(c?.id) || null,
        cliente: c ? { rut: String(c.code || ''), razon_social: String(c.company || `${c.firstName || ''} ${c.lastName || ''}`).trim(), giro: String(c.activity || ''), direccion: String(c.address || ''), comuna: String(c.municipality || ''), ciudad: String(c.city || '') } : null,
        totales: { neto: Number(doc.netAmount || 0), iva: Number(doc.taxAmount || 0), total: Number(doc.totalAmount || 0) },
        oficina_id: Number(doc.office?.id) || 1,
      },
      nd_tipo_id: Number(ndTipo?.id) || null,
      cotizacion,
      registro,
      problemas,
      avisos,
      fecha_emision: hoyEnChile(),
      modo: this.facturacion.emisionActiva ? 'activa' : 'simulacion',
      huella: this.facturacion.huellaDe({ cliente: { id: c?.id || c?.code || 'sin-cliente' }, tipo_documento_id: Number(doc.id), lineas: [], referencias: [{ codigo_sii: DTE_FACTURA, numero: String(doc.number) }], totales: { total: Number(doc.totalAmount || 0), estado: Number(doc.state) } as any }),
    };
  }

  async emitirDebito(usuario: { id: string; email: string }, body: any) {
    const simular = body?.simular === true;
    const real = this.facturacion.emisionActiva && !simular;
    const b: any = await this.prepararDebito(usuario.id, { bsale_id: body?.bsale_id, documento_id: body?.documento_id, numero: body?.numero });
    const motivo = texto(body?.motivo, 90); // el SII admite 90 caracteres en la razón de la referencia
    if (motivo.length < 5) b.problemas.push({ codigo: 'motivo', mensaje: 'Escribe el motivo (sale en la referencia a la factura).' });
    const lineas = (Array.isArray(body?.lineas) ? body.lineas : [])
      .map((l: any) => ({ descripcion: texto(l?.descripcion, 120), cantidad: Number(l?.cantidad), neto_unitario: Math.round(Number(l?.neto_unitario)) }))
      .filter((l: any) => l.descripcion || l.cantidad || l.neto_unitario);
    if (!lineas.length) b.problemas.push({ codigo: 'sin_lineas', mensaje: 'Agrega al menos una línea con su descripción, cantidad y valor neto.' });
    if (lineas.length > 20) b.problemas.push({ codigo: 'muchas_lineas', mensaje: 'Una nota de débito admite hasta 20 líneas.' });
    lineas.forEach((l: any, i: number) => {
      if (!l.descripcion) b.problemas.push({ codigo: 'descripcion', mensaje: `Línea ${i + 1}: falta la descripción.` });
      if (!(l.cantidad > 0)) b.problemas.push({ codigo: 'cantidad', mensaje: `Línea ${i + 1}: la cantidad debe ser mayor que 0.` });
      if (!(l.neto_unitario > 0)) b.problemas.push({ codigo: 'valor', mensaje: `Línea ${i + 1}: el valor neto debe ser mayor que $0.` });
    });
    const dias = Math.round(Number(body?.dias_vencimiento ?? 30));
    if (!Number.isFinite(dias) || dias < 0 || dias > 365) b.problemas.push({ codigo: 'plazo', mensaje: 'El plazo debe estar entre 0 y 365 días.' });
    const o = b.original;
    if (b.problemas.length) {
      if (simular) return { simulacion: true, bloqueada: true, problemas: b.problemas, avisos: b.avisos, original: o, huella: b.huella };
      throw new BadRequestException(`No se puede emitir la nota de débito: ${b.problemas.map((p: Problema) => p.mensaje).join(' ')}`);
    }
    if (!simular && (!body?.huella || body.huella !== b.huella)) {
      throw new ConflictException('La factura cambió en Bsale desde la simulación. Simula de nuevo antes de emitir.');
    }
    const totales = totalesDe(lineas.map((l: any) => ({ neto: Math.round(l.cantidad * l.neto_unitario) })));
    const emision = fechaAEpoch(b.fecha_emision);
    const vence = new Date(`${b.fecha_emision}T12:00:00Z`);
    vence.setUTCDate(vence.getUTCDate() + dias);
    const clave = `AMS-ND-${o.bsale_id}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    const solicitud: Record<string, any> = {
      documentTypeId: b.nd_tipo_id,
      officeId: o.oficina_id,
      emissionDate: emision,
      expirationDate: fechaAEpoch(vence.toISOString().slice(0, 10)),
      declareSii: 1,
      ...(o.cliente_id
        ? { clientId: o.cliente_id }
        : o.cliente?.rut
          ? { client: { code: o.cliente.rut, company: o.cliente.razon_social, activity: o.cliente.giro || undefined, address: o.cliente.direccion || undefined, municipality: o.cliente.comuna || undefined, city: o.cliente.ciudad || undefined } }
          : {}),
      details: lineas.map((l: any) => ({ comment: l.descripcion, quantity: l.cantidad, netUnitValue: l.neto_unitario, taxId: `[${IVA_ID}]` })),
      references: [{ number: o.numero, referenceDate: fechaAEpoch(o.fecha), reason: motivo, codeSii: DTE_FACTURA }],
      salesId,
    };
    const doc = o.tipo.toLowerCase();
    const vista = {
      tipo: 'Nota de débito electrónica',
      sii: true,
      descuenta_stock: false,
      stock_texto: 'No mueve stock',
      emisor: EMISOR,
      cliente: o.cliente || {},
      lineas: lineas.map((l: any) => ({ sku: '', producto: l.descripcion, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: Math.round(l.cantidad * l.neto_unitario) })),
      totales,
      referencias: [{ tipo: o.tipo, folio: o.numero, fecha: o.fecha, razon: motivo }],
      fecha_emision: b.fecha_emision,
      vencimiento: vence.toISOString().slice(0, 10),
      notas: [
        `Aumenta en $${totales.total.toLocaleString('es-CL')} lo que el cliente debe por la ${doc} N° ${o.numero}.`,
        b.cotizacion
          ? `Quedará registrada en la cotización #${b.cotizacion.id} colgada de esa ${doc}: Seguimiento de Pagos la suma al saldo.`
          : 'La factura no está en ninguna cotización: la nota de débito queda solo en Bsale y en Emitidas.',
      ],
    };
    if (!real) return { simulacion: true, emision_apagada: !simular, solicitud, vista, huella: b.huella, avisos: b.avisos, totales };

    return this.despachos.emitirReal({
      usuario, clave, salesId, tipo: 'nota_debito', ruta: '/documents.json', solicitud, vista,
      licitacionId: b.cotizacion?.id || null, origenDocId: b.registro?.documento_id || null,
      lineas: lineas.map((l: any) => ({ sku: '', cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      bucket: 'factura',
      registrar: async (nd: any, pdf: any) => {
        if (!b.registro) return null;
        try {
          const creado = await this.licitaciones.createDocumento({
            licitacion_id: b.registro.licitacion_id, tipo: 'nota_debito', numero: String(nd.number),
            // En BRUTO, como la nota de crédito: Seguimiento de Pagos la suma al saldo de la factura.
            monto: Number(nd.totalAmount) || Number(totales.total) || null,
            fecha_oc: b.fecha_emision, deriva_de_id: b.registro.documento_id, descripcion: `Nota de débito de ${doc} N° ${o.numero}: ${motivo}`,
            bucket: pdf ? 'factura' : null, storage_path: pdf?.path || null, file_name: pdf ? `Nota de débito ${nd.number}.pdf` : null,
            mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null, bsale_id: Number(nd.id) || null, bsale_url: nd.urlPdf || nd.urlPublicView || null,
          });
          return Number((creado as any)?.id) || null;
        } catch (e: any) {
          if (/tipo_check|check constraint/i.test(String(e?.message || ''))) throw new Error('falta aplicar la migración 20261007_documentos_nota_debito en Supabase');
          throw e;
        }
      },
      verificar: async (nd: any) => {
        const avisos: string[] = [];
        try {
          const completo = await this.facturacion.apiGet(`/documents/${Number(nd.id)}.json?expand=[references]`);
          const refs: any[] = completo?.references?.items || [];
          if (!refs.some((r: any) => String(r?.number) === String(o.numero))) avisos.push(`La nota de débito ${nd.number} salió SIN la referencia a la ${doc} ${o.numero}: agrégala en Bsale.`);
          if (Number.isFinite(Number(completo?.totalAmount)) && Math.abs(Number(completo.totalAmount) - totales.total) > 2) {
            avisos.push(`Bsale calculó $${Number(completo.totalAmount).toLocaleString('es-CL')} y la simulación decía $${totales.total.toLocaleString('es-CL')}.`);
          }
        } catch { /* la verificación no frena nada */ }
        return avisos;
      },
    });
  }

  // ── Simular / emitir ──────────────────────────────────────────────────

  async emitir(usuario: { id: string; email: string }, body: any) {
    const simular = body?.simular === true;
    const real = this.facturacion.emisionActiva && !simular;
    const b: any = await this.preparar(usuario.id, { bsale_id: body?.bsale_id, documento_id: body?.documento_id, tipo: body?.tipo, numero: body?.numero });
    const motivo = texto(body?.motivo, 250);
    if (motivo.length < 5) b.problemas.push({ codigo: 'motivo', mensaje: 'Escribe el motivo (sale impreso en la nota de crédito).' });
    const tipoDev = dineroDe(body?.tipo_devolucion ?? b.tipo_devolucion);
    if (!tipoDev) b.problemas.push({ codigo: 'tipo_devolucion', mensaje: 'Elige qué pasa con el dinero.' });
    const modo: 'total' | 'parcial' | 'ajuste' = body?.modo === 'parcial' || body?.modo === 'ajuste' ? body.modo : 'total';
    const o = b.original;

    // Líneas de la nota según el modo (valor = neto unitario que se acredita).
    const elegidas: any[] = [];
    if (modo === 'total') {
      if (b.previas.length) b.problemas.push({ codigo: 'nc_parcial', mensaje: 'Este documento ya tiene notas de crédito: para el saldo usa una devolución parcial o un ajuste de precio.' });
      for (const l of o.lineas) elegidas.push({ ...l, valor: l.neto_unitario });
    } else {
      for (const p of Array.isArray(body?.lineas) ? body.lineas : []) {
        const l = o.lineas.find((x: any) => x.detalle_id === Number(p?.detalle_id));
        const cant = Number(p?.cantidad);
        if (!l || !(cant > 0)) continue;
        const nombre = l.sku || l.producto || `línea ${l.detalle_id}`;
        if (modo === 'parcial') {
          if (cant > l.disponible + 1e-9) b.problemas.push({ codigo: 'cantidad', mensaje: `${nombre}: se pueden devolver hasta ${l.disponible} (ya se devolvieron ${l.devuelto} de ${l.cantidad}).` });
          elegidas.push({ ...l, cantidad: cant, valor: l.neto_unitario });
        } else {
          const rebaja = Math.round(Number(p?.neto_unitario));
          if (cant > l.cantidad + 1e-9) b.problemas.push({ codigo: 'cantidad', mensaje: `${nombre}: la factura tiene ${l.cantidad} unidades.` });
          if (!(rebaja > 0) || rebaja > l.neto_unitario) b.problemas.push({ codigo: 'rebaja', mensaje: `${nombre}: la rebaja por unidad debe ser mayor que $0 y no más que su precio neto ($${Number(l.neto_unitario).toLocaleString('es-CL')}).` });
          elegidas.push({ ...l, cantidad: cant, valor: rebaja });
        }
      }
      if (!elegidas.length) b.problemas.push({ codigo: 'sin_lineas', mensaje: modo === 'parcial' ? 'Indica qué productos y cuántas unidades se devuelven.' : 'Indica a qué productos se les rebaja el precio y cuánto por unidad.' });
    }
    const totales = modo === 'total' ? o.totales : totalesDe(elegidas.map((l) => ({ neto: Math.round(l.cantidad * l.valor) })));
    if (modo !== 'total' && totales.total > Number(b.saldo?.disponible ?? o.totales.total) + 2) {
      b.problemas.push({ codigo: 'supera_saldo', mensaje: `La nota de crédito ($${totales.total.toLocaleString('es-CL')}) supera el saldo del documento ($${Number(b.saldo.disponible).toLocaleString('es-CL')}).` });
    }
    if (b.problemas.length) {
      if (simular) return { simulacion: true, bloqueada: true, problemas: b.problemas, avisos: b.avisos, original: o, huella: b.huella };
      throw new BadRequestException(`No se puede emitir la nota de crédito: ${b.problemas.map((p: Problema) => p.mensaje).join(' ')}`);
    }
    // La huella cubre el documento; modo, líneas, motivo y tipo van en la firma de la pantalla.
    if (!simular && (!body?.huella || body.huella !== b.huella)) {
      throw new ConflictException('El documento cambió en Bsale desde la simulación. Simula de nuevo antes de emitir.');
    }

    const emision = fechaAEpoch(b.fecha_emision);
    const solicitud: Record<string, any> = {
      documentTypeId: b.nc_tipo_id,
      officeId: o.oficina_id,
      referenceDocumentId: o.bsale_id,
      emissionDate: emision,
      expirationDate: emision,
      motive: motivo,
      declareSii: 1,
      priceAdjustment: modo === 'ajuste' ? 1 : 0,
      editTexts: 0,
      type: tipoDev!.bsale,
      ...(o.cliente?.rut
        ? { client: { code: o.cliente.rut, company: o.cliente.razon_social, activity: o.cliente.giro || undefined, address: o.cliente.direccion || undefined, municipality: o.cliente.comuna || undefined, city: o.cliente.ciudad || undefined } }
        : {}),
      details: elegidas.map((l: any) => ({ documentDetailId: l.detalle_id, quantity: l.cantidad, unitValue: l.valor })),
    };
    const doc = o.tipo.toLowerCase();
    const razon = modo === 'total' ? 'Anula documento de referencia' : modo === 'parcial' ? 'Devolución parcial' : 'Corrige montos (ajuste de precio)';
    const vista = {
      tipo: 'Nota de crédito electrónica',
      sii: true,
      descuenta_stock: false,
      stock_texto: modo === 'ajuste' ? 'No mueve stock' : 'Reingresa stock',
      emisor: EMISOR,
      cliente: o.cliente || {},
      lineas: elegidas.map((l: any) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.valor, neto: Math.round(l.cantidad * l.valor) })),
      totales,
      referencias: [{ tipo: o.tipo, folio: o.numero, fecha: o.fecha, razon: `${razon} · ${motivo}` }],
      forma_pago: tipoDev!.nombre,
      forma_pago_titulo: 'Qué pasa con el dinero',
      fecha_emision: b.fecha_emision,
      notas: [
        modo === 'total'
          ? `Anula completa la ${doc} N° ${o.numero} por $${Number(o.totales.total).toLocaleString('es-CL')}.`
          : modo === 'parcial'
            ? `Devolución parcial de la ${doc} N° ${o.numero}: $${totales.total.toLocaleString('es-CL')} de $${Number(o.totales.total).toLocaleString('es-CL')}.`
            : `Ajuste de precio de la ${doc} N° ${o.numero}: rebaja $${totales.total.toLocaleString('es-CL')} sin devolver productos.`,
        modo === 'ajuste' ? 'No mueve stock: es solo una corrección de montos.' : 'Bsale reingresa al stock las cantidades devueltas.',
        tipoDev!.id === 'devolver' && Number(b.pago?.bruto) > 0
          ? `El cliente tiene pagados $${Number(b.pago.bruto).toLocaleString('es-CL')}: quedará una devolución pendiente de hasta $${Math.min(Number(b.pago.bruto), totales.total).toLocaleString('es-CL')} en Trazabilidad → Facturas hasta que se registre.`
          : tipoDev!.id === 'saldo_favor' && Number(b.pago?.bruto) > 0
            ? `El cliente tiene pagados $${Number(b.pago.bruto).toLocaleString('es-CL')}: hasta $${Math.min(Number(b.pago.bruto), totales.total).toLocaleString('es-CL')} quedarán a su favor para aplicarlos a otra factura desde Trazabilidad → Facturas.`
            : tipoDev!.id === 'devolver' || tipoDev!.id === 'saldo_favor'
              ? 'El sistema no tiene pagos registrados de este documento: no quedará dinero pendiente de devolver.'
              : `Dinero: ${tipoDev!.nombre.toLowerCase()}.`,
        b.cotizacion
          ? `Quedará registrada en la cotización #${b.cotizacion.id} como nota de crédito de esa ${doc}: Seguimiento de Pagos la descuenta del saldo.`
          : 'El documento no está en ninguna cotización: la nota de crédito queda solo en Bsale y en Emitidas.',
      ],
    };
    if (!real) return { simulacion: true, emision_apagada: !simular, solicitud, vista, huella: b.huella, avisos: b.avisos, totales, modo };

    const clave = `AMS-NC-${o.bsale_id}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    const descripcion = modo === 'total'
      ? `Anula ${doc} N° ${o.numero}: ${motivo}`
      : modo === 'parcial'
        ? `Devolución parcial de ${doc} N° ${o.numero}: ${motivo}`
        : `Ajuste de precio de ${doc} N° ${o.numero}: ${motivo}`;
    const r = await this.despachos.emitirReal({
      usuario, clave, salesId, tipo: 'nota_credito', ruta: '/returns.json', solicitud, vista,
      licitacionId: b.cotizacion?.id || null, origenDocId: b.registro?.documento_id || null,
      lineas: elegidas.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.valor })),
      bucket: 'factura',
      registrar: async (nc: any, pdf: any) => {
        if (!b.registro) return null;
        const creado = await this.licitaciones.createDocumento({
          licitacion_id: b.registro.licitacion_id, tipo: 'nota_credito', numero: String(nc.number),
          // Las notas de crédito se guardan en BRUTO (así se cargan a mano y así las descuenta Seguimiento de Pagos).
          monto: Number(nc.totalAmount) || Number(totales.total) || null,
          fecha_oc: b.fecha_emision, deriva_de_id: b.registro.documento_id, descripcion,
          // Qué pasa con el dinero (2026-10-08): lo lee Trazabilidad → Facturas.
          dinero: tipoDev!.id,
          bucket: pdf ? 'factura' : null, storage_path: pdf?.path || null, file_name: pdf ? `Nota de crédito ${nc.number}.pdf` : null,
          mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null, bsale_id: Number(nc.id) || null, bsale_url: nc.urlPdf || nc.urlPublicView || null,
        });
        return Number((creado as any)?.id) || null;
      },
      verificar: async (nc: any) => {
        const avisos: string[] = [];
        if (Number(nc?.totalAmount) && Math.abs(Number(nc.totalAmount) - Number(totales.total)) > 2) {
          avisos.push(`La nota de crédito ${nc.number} salió por $${Number(nc.totalAmount).toLocaleString('es-CL')} y debía ser de $${Number(totales.total).toLocaleString('es-CL')}: revísala en Bsale.`);
        }
        return avisos;
      },
    });
    // La factura se ve anulada / con NC de inmediato (pestaña Facturas, Pagos, cotización).
    if ((r as any)?.emitida) this.estados.anotarNotaCredito(Number(o.bsale_id), { numero: (r as any).numero ?? null, total: Number((r as any).total) || Number(totales.total) || null });
    // (2026-10-08) Qué quedó en manos del cliente: devolución pendiente (con
    // aviso a admin y contabilidad) o saldo a favor. Lo calcula DevolucionesService.
    let pendienteDevolver = 0;
    let saldoFavor = 0;
    if ((r as any)?.emitida && (r as any)?.documento_id) {
      try {
        const cn = await this.devoluciones.cuentaNotaCredito(Number((r as any).documento_id));
        pendienteDevolver = cn.pendiente_devolver;
        saldoFavor = cn.saldo_favor;
        if (pendienteDevolver > 0) {
          await this.devoluciones.avisarDevolucionPendiente({
            ncId: Number((r as any).documento_id), facturaId: Number(b.registro.documento_id), licitacionId: b.cotizacion?.id || null, monto: pendienteDevolver,
            cliente: b.cotizacion?.cliente || o.cliente?.razon_social || '', numeroNc: String((r as any).numero ?? ''), numeroFactura: String(o.numero), etiqueta: doc,
          });
        }
      } catch (e: any) {
        this.logger.warn(`NC ${(r as any).numero}: no se pudo calcular el dinero pendiente: ${e?.message || e}`);
      }
    }
    return { ...(r as any), dinero: tipoDev!.id, pendiente_devolver: pendienteDevolver, saldo_favor: saldoFavor };
  }
}
