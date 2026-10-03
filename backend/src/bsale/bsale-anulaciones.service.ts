import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';
import { BsaleFacturacionService, EMISOR, epochAFecha, fechaAEpoch, normRut } from './bsale-facturacion.service';
import { BsaleDespachosService } from './bsale-despachos.service';

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
   queda "incierta" y no se reintenta hasta revisar en Bsale (emitirReal). */

const DTE_FACTURA = 33;
const DTE_BOLETA = 39;
const DTE_NC = 61;
const DTE_GUIA = 52;

// Qué pasa con el dinero (campo `type` de la devolución en Bsale).
export const TIPOS_DEVOLUCION = [
  { id: 2, nombre: 'Rebajar la deuda del cliente', detalle: 'Venta a crédito: el documento deja de cobrarse.' },
  { id: 0, nombre: 'Devolver el dinero', detalle: 'Se le devuelve el pago al cliente (sale de caja en Bsale).' },
  { id: 3, nombre: 'Sin movimiento de dinero', detalle: 'Solo se anula el documento; el pago, si lo hubo, se gestiona aparte.' },
];

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

  // ── Borrador ──────────────────────────────────────────────────────────

  async preparar(userId: string, q: { bsale_id?: any; documento_id?: any; tipo?: any; numero?: any }) {
    await this.facturacion.exigirRol(userId);
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    const db = this.supabase.getClient();

    // 1) Ubicar el documento en Bsale
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
    if (previas.length) {
      const devuelto = previas.reduce((a, r) => a + (Number(r.amount) || 0), 0);
      const total = devuelto >= Number(doc.totalAmount || 0);
      problemas.push({
        codigo: total ? 'ya_anulado' : 'nc_parcial',
        mensaje: total
          ? `Este documento ya está anulado en Bsale (devolución por $${devuelto.toLocaleString('es-CL')}).`
          : `Este documento ya tiene una nota de crédito parcial por $${devuelto.toLocaleString('es-CL')}: complétala en Bsale.`,
      });
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
      tipos_devolucion: TIPOS_DEVOLUCION,
      tipo_devolucion: credito ? 2 : 3,
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

  // ── Simular / emitir ──────────────────────────────────────────────────

  async emitir(usuario: { id: string; email: string }, body: any) {
    const simular = body?.simular === true;
    const real = this.facturacion.emisionActiva && !simular;
    const b: any = await this.preparar(usuario.id, { bsale_id: body?.bsale_id, documento_id: body?.documento_id, tipo: body?.tipo, numero: body?.numero });
    const motivo = texto(body?.motivo, 250);
    if (motivo.length < 5) b.problemas.push({ codigo: 'motivo', mensaje: 'Escribe el motivo de la anulación (sale impreso en la nota de crédito).' });
    const tipoDev = TIPOS_DEVOLUCION.find((t) => t.id === Number(body?.tipo_devolucion ?? b.tipo_devolucion));
    if (!tipoDev) b.problemas.push({ codigo: 'tipo_devolucion', mensaje: 'Elige qué pasa con el dinero.' });
    if (b.problemas.length) {
      if (simular) return { simulacion: true, bloqueada: true, problemas: b.problemas, avisos: b.avisos, original: b.original, huella: b.huella };
      throw new BadRequestException(`No se puede anular: ${b.problemas.map((p: Problema) => p.mensaje).join(' ')}`);
    }
    // La huella cubre el documento; el motivo y el tipo van en la firma de la pantalla.
    if (!simular && (!body?.huella || body.huella !== b.huella)) {
      throw new ConflictException('El documento cambió en Bsale desde la simulación. Simula de nuevo antes de anular.');
    }

    const o = b.original;
    const emision = fechaAEpoch(b.fecha_emision);
    const solicitud: Record<string, any> = {
      documentTypeId: b.nc_tipo_id,
      officeId: o.oficina_id,
      referenceDocumentId: o.bsale_id,
      emissionDate: emision,
      expirationDate: emision,
      motive: motivo,
      declareSii: 1,
      priceAdjustment: 0,
      editTexts: 0,
      type: tipoDev!.id,
      ...(o.cliente?.rut
        ? { client: { code: o.cliente.rut, company: o.cliente.razon_social, activity: o.cliente.giro || undefined, address: o.cliente.direccion || undefined, municipality: o.cliente.comuna || undefined, city: o.cliente.ciudad || undefined } }
        : {}),
      details: o.lineas.map((l: any) => ({ documentDetailId: l.detalle_id, quantity: l.cantidad, unitValue: l.neto_unitario })),
    };
    const vista = {
      tipo: 'Nota de crédito electrónica',
      sii: true,
      descuenta_stock: false,
      stock_texto: 'Reingresa stock',
      emisor: EMISOR,
      cliente: o.cliente || {},
      lineas: o.lineas.map((l: any) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto })),
      totales: o.totales,
      referencias: [{ tipo: o.tipo, folio: o.numero, fecha: o.fecha, razon: `Anula documento de referencia · ${motivo}` }],
      forma_pago: tipoDev!.nombre,
      forma_pago_titulo: 'Qué pasa con el dinero',
      fecha_emision: b.fecha_emision,
      notas: [
        `Anula completa la ${o.tipo.toLowerCase()} N° ${o.numero} por $${Number(o.totales.total).toLocaleString('es-CL')}.`,
        'Bsale reingresa al stock las cantidades devueltas.',
        b.cotizacion
          ? `Quedará registrada en la cotización #${b.cotizacion.id} como nota de crédito de esa ${o.tipo.toLowerCase()}: Seguimiento de Pagos la descuenta del saldo.`
          : 'El documento no está en ninguna cotización: la nota de crédito queda solo en Bsale y en Emitidas.',
      ],
    };
    if (!real) return { simulacion: true, emision_apagada: !simular, solicitud, vista, huella: b.huella, avisos: b.avisos, totales: o.totales };

    const clave = `AMS-NC-${o.bsale_id}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    return this.despachos.emitirReal({
      usuario, clave, salesId, tipo: 'nota_credito', ruta: '/returns.json', solicitud, vista,
      licitacionId: b.cotizacion?.id || null, origenDocId: b.registro?.documento_id || null,
      lineas: o.lineas.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      bucket: 'factura',
      registrar: async (nc: any, pdf: any) => {
        if (!b.registro) return null;
        const creado = await this.licitaciones.createDocumento({
          licitacion_id: b.registro.licitacion_id, tipo: 'nota_credito', numero: String(nc.number),
          // Las notas de crédito se guardan en BRUTO (así se cargan a mano y así las descuenta Seguimiento de Pagos).
          monto: Number(nc.totalAmount) || Number(o.totales.total) || null,
          fecha_oc: b.fecha_emision, deriva_de_id: b.registro.documento_id, descripcion: `Anula ${o.tipo.toLowerCase()} N° ${o.numero}: ${motivo}`,
          bucket: pdf ? 'factura' : null, storage_path: pdf?.path || null, file_name: pdf ? `Nota de crédito ${nc.number}.pdf` : null,
          mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null, bsale_id: Number(nc.id) || null, bsale_url: nc.urlPdf || nc.urlPublicView || null,
        });
        return Number((creado as any)?.id) || null;
      },
      verificar: async (nc: any) => {
        const avisos: string[] = [];
        if (Number(nc?.totalAmount) && Math.abs(Number(nc.totalAmount) - Number(o.totales.total)) > 2) {
          avisos.push(`La nota de crédito ${nc.number} salió por $${Number(nc.totalAmount).toLocaleString('es-CL')} y el documento era de $${Number(o.totales.total).toLocaleString('es-CL')}: revísala en Bsale.`);
        }
        return avisos;
      },
    });
  }
}
