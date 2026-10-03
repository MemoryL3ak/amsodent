import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';
import {
  BsaleFacturacionService, fechaAEpoch, folioCotizacion, normOc, normRut, ocDeReferencia, referenciaGuia, referenciaOcFactura, referenciaOcGuia, referenciaParaBsale, referenciaVista, sumarDias, totalesDe,
} from './bsale-facturacion.service';
import { BsaleDespachosService } from './bsale-despachos.service';

/* ── Guías y facturas LIBRES en Bsale (2026-10-03) ───────────────────────────
   Pedido de Ariel: "necesito la opción de crear guías y facturas de manera
   libre". Sin orden de compra ni cotización de por medio: se elige el cliente
   (por RUT; si no está en Bsale se crea), se arman las líneas a mano (SKU,
   cantidad, precio neto), se completan despacho o forma de pago, y opcional-
   mente se referencia una OC o una guía y se cuelga de una cotización para
   que quede en Trazabilidad. Mismos dos pasos: simular y después emitir. */

const DTE_OC = 801;
const DTE_GUIA = 52;
const IVA_ID = 1;
const MAX_FOLIO_REF = 18;

type Problema = { codigo: string; mensaje: string };
type Linea = { sku: string; cantidad: number; neto_unitario: number };

const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const normSku = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const texto = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
const rutBsale = (v: any) => {
  const limpio = normRut(v);
  return limpio.length > 1 ? `${limpio.slice(0, -1)}-${limpio.slice(-1)}` : limpio;
};

@Injectable()
export class BsaleLibreService {
  private readonly logger = new Logger(BsaleLibreService.name);

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
    private despachos: BsaleDespachosService,
    private licitaciones: LicitacionesService,
  ) {}

  // ── Para armar el documento en pantalla ────────────────────────────────

  async opciones(userId: string) {
    await this.facturacion.exigirRol(userId);
    const [{ formas }, traslados] = await Promise.all([this.facturacion.listas(), this.despachos.tiposTraslado()]);
    return {
      modo: this.facturacion.emisionActiva ? 'activa' : 'simulacion',
      formas_pago: formas,
      forma_pago_id: formas.find((f) => /^cr[eé]dito$/i.test(f.nombre))?.id || formas[0]?.id || null,
      tipos_traslado: traslados,
      tipo_traslado_id: traslados.find((t) => t.id === 2)?.id || traslados[0]?.id || null,
      fecha_emision: hoyEnChile(),
    };
  }

  /* Clientes del sistema que calzan con lo escrito (RUT o nombre): para
     elegir uno sin tipear el RUT entero. */
  async buscarClientes(userId: string, q: string) {
    await this.facturacion.exigirRol(userId);
    const t = texto(q, 60);
    if (t.length < 2) return [];
    const patron = `%${t.replace(/[%_]/g, '')}%`;
    const { data } = await this.supabase
      .getClient()
      .from('clientes')
      .select('rut, nombre, direccion, comuna, region, email, tipo_cliente')
      .or(`rut.ilike.${patron},nombre.ilike.${patron}`)
      .limit(10);
    return (data || []).map((c: any) => ({
      rut: String(c.rut || ''),
      nombre: String(c.nombre || ''),
      direccion: String(c.direccion || ''),
      comuna: String(c.comuna || ''),
      region: String(c.region || ''),
      email: String(c.email || ''),
      tipo: String(c.tipo_cliente || ''),
    }));
  }

  /* El cliente como lo verá el documento: el que Bsale tiene con ese RUT o,
     si no existe, uno nuevo con lo que el sistema sepa de él. */
  async cliente(userId: string, rut: string) {
    await this.facturacion.exigirRol(userId);
    if (!normRut(rut)) throw new BadRequestException('Indica el RUT del cliente.');
    const enBsale = await this.despachos.clientePorRut(rut);
    if (enBsale) {
      return {
        id: Number(enBsale.id), nuevo: false, rut: String(enBsale.code || ''),
        razon_social: String(enBsale.company || `${enBsale.firstName || ''} ${enBsale.lastName || ''}`).trim(),
        giro: String(enBsale.activity || ''), direccion: String(enBsale.address || ''), comuna: String(enBsale.municipality || ''),
        ciudad: String(enBsale.city || ''), email: String(enBsale.email || ''),
      };
    }
    const { data } = await this.supabase.getClient().from('clientes').select('rut, nombre, direccion, comuna').limit(200);
    const propio = (data || []).find((c: any) => normRut(c.rut) === normRut(rut));
    return {
      id: null, nuevo: true, rut: rutBsale(rut),
      razon_social: String(propio?.nombre || '').trim(), giro: '', direccion: String(propio?.direccion || '').trim(),
      comuna: String(propio?.comuna || '').trim(), ciudad: String(propio?.comuna || '').trim(), email: '',
    };
  }

  /* Productos del catálogo que calzan (SKU o nombre), con sus listas: para
     agregarlos como líneas. Si el SKU no está en Bsale se dice al simular. */
  async buscarProductos(userId: string, q: string) {
    await this.facturacion.exigirRol(userId);
    const t = texto(q, 60);
    if (t.length < 2) return [];
    const patron = `%${t.replace(/[%_]/g, '')}%`;
    const { data } = await this.supabase
      .getClient()
      .from('productos')
      .select('sku, nombre, formato, lista1, lista2, stock, estado')
      .or(`sku.ilike.${patron},nombre.ilike.${patron}`)
      .limit(40);
    return (data || [])
      .filter((p: any) => String(p.estado || '') !== 'Inactivo' && normSku(p.sku))
      .slice(0, 15)
      .map((p: any) => ({
        sku: normSku(p.sku), nombre: String(p.nombre || ''), formato: String(p.formato || ''),
        lista1: Number(p.lista1) || 0, lista2: Number(p.lista2) || 0, stock: Number(p.stock) || 0,
      }));
  }

  // ── Armado y validación ────────────────────────────────────────────────

  private async armar(body: any) {
    const tipo = body?.tipo === 'factura' ? 'factura' : 'guia';
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];

    // Cliente
    const rut = rutBsale(body?.cliente?.rut);
    if (!rut) problemas.push({ codigo: 'sin_rut', mensaje: 'Indica el RUT del cliente.' });
    const enBsale = rut ? await this.despachos.clientePorRut(rut) : null;
    const cliente = enBsale
      ? {
          id: Number(enBsale.id), nuevo: false, rut: String(enBsale.code || ''),
          razon_social: String(enBsale.company || `${enBsale.firstName || ''} ${enBsale.lastName || ''}`).trim(),
          giro: String(enBsale.activity || ''), direccion: String(enBsale.address || ''), comuna: String(enBsale.municipality || ''),
          ciudad: String(enBsale.city || ''), email: String(enBsale.email || ''),
        }
      : {
          id: null, nuevo: true, rut,
          razon_social: texto(body?.cliente?.razon_social, 120), giro: texto(body?.cliente?.giro, 80), direccion: texto(body?.cliente?.direccion, 120),
          comuna: texto(body?.cliente?.comuna, 60), ciudad: texto(body?.cliente?.ciudad, 60), email: texto(body?.cliente?.email, 120),
        };
    if (cliente.nuevo && rut) {
      avisos.push({ codigo: 'cliente_nuevo', mensaje: `El cliente (RUT ${rut}) no existe en Bsale: se creará con los datos ingresados.` });
      if (!cliente.razon_social || !cliente.giro || !cliente.direccion || !cliente.comuna) {
        problemas.push({ codigo: 'cliente_incompleto', mensaje: 'El cliente nuevo necesita razón social, giro, dirección y comuna (Bsale los exige).' });
      }
    }

    // Líneas
    const crudas: any[] = Array.isArray(body?.lineas) ? body.lineas : [];
    const lineas: any[] = [];
    const vistos = new Set<string>();
    for (const l of crudas) {
      const sku = normSku(l?.sku);
      if (!sku || vistos.has(sku)) continue;
      vistos.add(sku);
      const cantidad = Number(l?.cantidad);
      const neto = Math.round(Number(l?.neto_unitario));
      const variante = await this.despachos.variantePorSku(sku);
      if (!variante) problemas.push({ codigo: 'sku_no_en_bsale', mensaje: `El SKU ${sku} no está en Bsale.` });
      if (!(cantidad > 0)) problemas.push({ codigo: 'cantidad', mensaje: `${sku}: la cantidad debe ser mayor que 0.` });
      if (!(neto > 0)) problemas.push({ codigo: 'precio', mensaje: `${sku}: indica el precio neto unitario.` });
      lineas.push({
        sku, producto: texto(l?.producto, 160) || String(variante?.product?.name || ''), cantidad, neto_unitario: neto,
        neto: Math.round(cantidad * neto), en_bsale: !!variante, variante_id: variante ? Number(variante.id) : null,
      });
    }
    if (!lineas.length) problemas.push({ codigo: 'sin_lineas', mensaje: 'Agrega al menos un producto.' });
    if (lineas.length > 200) problemas.push({ codigo: 'muchas_lineas', mensaje: 'Máximo 200 líneas por documento.' });
    const totales = totalesDe(lineas);

    // Fecha
    const hoy = hoyEnChile();
    const fecha = String(body?.fecha_emision || hoy).slice(0, 10);
    if (!Number.isFinite(fechaAEpoch(fecha))) problemas.push({ codigo: 'fecha', mensaje: 'La fecha de emisión no es válida.' });
    else if (fecha > hoy) problemas.push({ codigo: 'fecha_futura', mensaje: 'La fecha de emisión no puede ser futura.' });
    else if (fecha < sumarDias(hoy, -30)) problemas.push({ codigo: 'fecha_antigua', mensaje: 'La fecha de emisión no puede tener más de 30 días.' });

    // Cotización a la que se cuelga (opcional): su código va como FOLIO en la referencia a la OC.
    let cotizacion: any = null;
    let licCot: any = null;
    if (body?.cotizacion_id != null && String(body.cotizacion_id).trim() !== '') {
      const id = Number(body.cotizacion_id);
      const { data: lic } = id > 0 ? await this.supabase.getClient().from('licitaciones').select('id, id_licitacion, nombre_entidad, rut_entidad').eq('id', id).maybeSingle() : { data: null };
      if (!lic) problemas.push({ codigo: 'cotizacion', mensaje: `No existe la cotización #${body.cotizacion_id}.` });
      else {
        licCot = lic;
        cotizacion = { id: lic.id, codigo: lic.id_licitacion || null, cliente: lic.nombre_entidad || '' };
        if (normRut(lic.rut_entidad) && rut && normRut(lic.rut_entidad) !== normRut(rut)) {
          avisos.push({ codigo: 'rut_cotizacion', mensaje: `La cotización #${lic.id} es de ${lic.nombre_entidad} (RUT ${lic.rut_entidad}), distinto del cliente del documento.` });
        }
      }
    }

    // Referencias (opcionales). OC en guía: folio = cotización, razón = N° de OC. OC en factura: N° de OC en ambos. Guía: folio = N° de guía.
    const referencias: any[] = [];
    for (const r of Array.isArray(body?.referencias) ? body.referencias : []) {
      const numero = normOc(r?.numero);
      if (!numero) continue;
      const esGuia = r?.tipo === 'guia';
      const f = String(r?.fecha || '').slice(0, 10);
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
      const ref = esGuia ? referenciaGuia(numero, fecha) : tipo === 'guia' ? referenciaOcGuia(licCot ? folioCotizacion(licCot) : numero, numero, fecha) : referenciaOcFactura(numero, fecha);
      if (ref.folio.length > MAX_FOLIO_REF) problemas.push({ codigo: 'folio_largo', mensaje: `El folio de referencia ${ref.folio} supera los ${MAX_FOLIO_REF} caracteres que acepta el SII.` });
      referencias.push(ref);
    }

    // Tipo de documento y sus datos propios
    let tipoDocumentoId = 0;
    let despacho: any = null;
    let formaPago: any = null;
    let dias = 0;
    let descuentaStock = tipo === 'guia';
    let traslado: any = null;
    if (tipo === 'guia') {
      const td = await this.despachos.tipoDocumento(String(DTE_GUIA), /gu[ií]a/i);
      tipoDocumentoId = Number(td?.id) || 0;
      if (!td) problemas.push({ codigo: 'sin_tipo', mensaje: 'La cuenta de Bsale no tiene activa la guía de despacho electrónica.' });
      const d = body?.despacho || {};
      despacho = {
        direccion: texto(d.direccion ?? cliente.direccion, 120), comuna: texto(d.comuna ?? cliente.comuna, 60), ciudad: texto(d.ciudad ?? cliente.ciudad, 60),
        destinatario: texto(d.destinatario ?? cliente.razon_social, 120), tipo_traslado_id: Number(d.tipo_traslado_id) || 0,
      };
      const traslados = await this.despachos.tiposTraslado();
      traslado = traslados.find((t) => t.id === despacho.tipo_traslado_id) || null;
      if (!despacho.direccion || !despacho.comuna || !despacho.ciudad || !despacho.destinatario) problemas.push({ codigo: 'despacho', mensaje: 'Completa destinatario, dirección, comuna y ciudad del despacho.' });
      if (!traslado) problemas.push({ codigo: 'traslado', mensaje: 'Elige el tipo de traslado.' });
    } else {
      const { tipoFactura, formas } = await this.facturacion.listas();
      tipoDocumentoId = Number(tipoFactura?.id) || 0;
      if (!tipoFactura) problemas.push({ codigo: 'sin_tipo', mensaje: 'La cuenta de Bsale no tiene activa la factura electrónica.' });
      formaPago = formas.find((f) => f.id === Number(body?.forma_pago_id)) || null;
      if (!formaPago) problemas.push({ codigo: 'forma_pago', mensaje: 'Elige la forma de pago.' });
      dias = Math.round(Number(body?.dias_vencimiento ?? 30));
      if (!Number.isFinite(dias) || dias < 0 || dias > 365) problemas.push({ codigo: 'plazo', mensaje: 'El plazo de vencimiento debe estar entre 0 y 365 días.' });
      // Una factura que no viene de una guía es la que mueve el stock.
      const refGuia = referencias.some((r) => r.codigo_sii === DTE_GUIA);
      descuentaStock = body?.descuenta_stock == null ? !refGuia : body.descuenta_stock === true;
      if (refGuia && descuentaStock) avisos.push({ codigo: 'stock_doble', mensaje: 'La factura referencia una guía y además descuenta stock: si la guía ya lo descontó, saldría dos veces.' });
      if (!refGuia && !descuentaStock) avisos.push({ codigo: 'sin_stock', mensaje: 'La factura no descuenta stock: el stock en Bsale quedará como está.' });
    }

    const borrador = {
      tipo, tipo_documento_id: tipoDocumentoId, cliente, lineas, totales, fecha_emision: fecha, referencias, despacho,
      traslado: traslado ? { id: traslado.id, nombre: traslado.nombre } : null,
      forma_pago: formaPago ? { id: formaPago.id, nombre: formaPago.nombre } : null, dias_vencimiento: dias,
      vencimiento: tipo === 'factura' ? sumarDias(fecha, dias) : null, descuenta_stock: descuentaStock, cotizacion, problemas, avisos,
    };
    const huella = this.facturacion.huellaDe({
      cliente: { id: cliente.id || cliente.rut }, tipo_documento_id: tipoDocumentoId,
      lineas: lineas.map((l) => ({ detalle_id: l.variante_id, cantidad: l.cantidad, neto: l.neto_unitario })),
      referencias: [...referencias.map((r) => ({ codigo_sii: r.codigo_sii, folio: r.folio, numero: r.numero })), { codigo_sii: 0, numero: `${fecha}|${JSON.stringify(despacho)}|${formaPago?.id}|${dias}|${descuentaStock}|${cotizacion?.id || ''}|${cliente.nuevo ? JSON.stringify(cliente) : ''}` }],
      totales,
    });
    return { ...borrador, huella };
  }

  private vista(b: any) {
    return {
      tipo: b.tipo === 'guia' ? 'Guía de despacho electrónica' : 'Factura electrónica',
      sii: true,
      descuenta_stock: b.descuenta_stock,
      cliente: { razon_social: b.cliente.razon_social, rut: b.cliente.rut, giro: b.cliente.giro, direccion: b.cliente.direccion, comuna: b.cliente.comuna, nuevo: b.cliente.nuevo },
      lineas: b.lineas.map((l: any) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto })),
      totales: b.totales,
      referencias: b.referencias.map(referenciaVista),
      forma_pago: b.forma_pago?.nombre || null,
      fecha_emision: b.fecha_emision,
      vencimiento: b.vencimiento,
      despacho: b.despacho ? { ...b.despacho, tipo_traslado: b.traslado?.nombre || null } : null,
      notas: [
        b.tipo === 'guia' ? 'Bsale descuenta el stock al emitir la guía.' : b.descuenta_stock ? 'La factura descuenta el stock en Bsale (no viene de una guía).' : 'La factura no mueve stock.',
        b.cotizacion ? `Quedará registrada en la cotización #${b.cotizacion.id}${b.cotizacion.codigo ? ` (${b.cotizacion.codigo})` : ''}.` : 'No se indicó cotización: quedará solo en Bsale y en el historial de Emitidas.',
      ],
    };
  }

  // ── Simular / emitir ───────────────────────────────────────────────────

  async emitir(usuario: { id: string; email: string }, body: any) {
    await this.facturacion.exigirRol(usuario.id);
    const simular = body?.simular === true;
    const real = this.facturacion.emisionActiva && !simular;
    const b: any = await this.armar(body);
    if (b.problemas.length) {
      if (simular) return { simulacion: true, bloqueada: true, problemas: b.problemas, avisos: b.avisos, huella: b.huella, totales: b.totales };
      throw new BadRequestException(`No se puede emitir: ${b.problemas.map((p: Problema) => p.mensaje).join(' ')}`);
    }
    if (!simular && (!body?.huella || body.huella !== b.huella)) {
      throw new ConflictException('Los datos cambiaron desde la simulación. Simula de nuevo antes de emitir.');
    }

    const emision = fechaAEpoch(b.fecha_emision);
    const cli = b.cliente.nuevo
      ? { client: { code: b.cliente.rut, company: b.cliente.razon_social, activity: b.cliente.giro, address: b.cliente.direccion, municipality: b.cliente.comuna, city: b.cliente.ciudad, ...(b.cliente.email ? { email: b.cliente.email } : {}), companyOrPerson: 1 } }
      : { clientId: b.cliente.id };
    const clave = `AMS-L-${b.tipo === 'guia' ? 'G' : 'F'}-${b.huella}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    const details = b.lineas.map((l: any) => ({ code: l.sku, quantity: l.cantidad, netUnitValue: l.neto_unitario, taxId: `[${IVA_ID}]` }));
    const references = b.referencias.map((r: any) => referenciaParaBsale(r, emision));
    const solicitud: Record<string, any> =
      b.tipo === 'guia'
        ? {
            documentTypeId: b.tipo_documento_id, emissionDate: emision, expirationDate: emision, declareSii: 1,
            shippingTypeId: b.despacho.tipo_traslado_id, address: b.despacho.direccion, municipality: b.despacho.comuna, city: b.despacho.ciudad, recipient: b.despacho.destinatario,
            ...cli, details, references, salesId,
          }
        : {
            documentTypeId: b.tipo_documento_id, emissionDate: emision, expirationDate: fechaAEpoch(b.vencimiento), declareSii: 1,
            ...cli, details, payments: [{ paymentTypeId: b.forma_pago.id, amount: b.totales.total, recordDate: emision }], references, salesId,
            ...(b.descuenta_stock ? { dispatch: 1 } : {}),
          };
    const vista = this.vista(b);
    if (!real) {
      return { simulacion: true, emision_apagada: !simular, solicitud, totales: b.totales, vista, huella: b.huella, avisos: b.avisos };
    }

    const esGuia = b.tipo === 'guia';
    return this.despachos.emitirReal({
      usuario, clave, salesId, tipo: esGuia ? 'guia' : 'factura', ruta: esGuia ? '/shippings.json' : '/documents.json', solicitud, vista,
      licitacionId: b.cotizacion?.id || null, origenDocId: null,
      lineas: b.lineas.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      bucket: esGuia ? 'guia-despacho' : 'factura',
      registrar: async (doc: any, pdf: any) => {
        if (!b.cotizacion) return null; // sin cotización no hay dónde colgarlo: queda en Bsale y en Emitidas
        if (esGuia) {
          // Si la cotización tiene una sola orden de compra, la guía cuelga de ella.
          const { data: ocs } = await this.supabase.getClient().from('licitacion_documentos').select('id').eq('licitacion_id', b.cotizacion.id).eq('tipo', 'orden_compra');
          const creado = await this.licitaciones.createDocumento({
            licitacion_id: b.cotizacion.id, tipo: 'guia_despacho', numero: String(doc.number), monto: null, fecha_oc: b.fecha_emision,
            deriva_de_id: (ocs || []).length === 1 ? (ocs as any[])[0].id : null, empresa_despacho: null, n_seguimiento: null,
            bucket: pdf ? 'guia-despacho' : null, storage_path: pdf?.path || null, file_name: pdf ? `Guía ${doc.number}.pdf` : null,
            mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null, bsale_id: Number(doc.id) || null, bsale_url: doc.urlPdf || doc.urlPublicView || null,
          });
          return Number((creado as any)?.id) || null;
        }
        const documento: Record<string, any> = {
          licitacion_id: b.cotizacion.id, tipo: 'factura', numero: String(doc.number), monto: Number(doc.netAmount ?? b.totales.neto) || null, fecha_oc: null,
          fecha_factura: b.fecha_emision, deriva_de_id: null, guias_ids: null, bucket: pdf ? 'factura' : null, storage_path: pdf?.path || null,
          file_name: pdf ? `Factura ${doc.number}.pdf` : null, mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null,
          bsale_id: Number(doc.id) || null, bsale_url: doc.urlPdf || doc.urlPublicView || null,
        };
        let r: any = await this.supabase.getClient().from('licitacion_documentos').insert([documento]).select('id').single();
        if (r.error && /bsale_id|bsale_url/.test(String(r.error.message))) {
          const { bsale_id: _a, bsale_url: _b, ...sin } = documento;
          r = await this.supabase.getClient().from('licitacion_documentos').insert([sin]).select('id').single();
        }
        if (r.error) throw new Error(r.error.message);
        return Number(r.data?.id) || null;
      },
      verificar: async (doc: any) => {
        const avisos: string[] = [];
        if (!b.referencias.length) return avisos;
        try {
          const completo = await this.facturacion.apiGet(`/documents/${Number(doc.id)}.json?expand=[references]`);
          const refs: any[] = completo?.references?.items || [];
          for (const r of b.referencias) {
            const esta = r.codigo_sii === DTE_OC ? refs.some((x: any) => ocDeReferencia(x) === r.numero) : refs.some((x: any) => normOc(x?.number) === normOc(r.folio));
            if (!esta) avisos.push(`El documento ${doc.number} salió sin la referencia ${r.codigo_sii === DTE_OC ? 'a la orden de compra' : 'a la guía'} ${r.numero}: agrégala en Bsale.`);
          }
        } catch { /* la verificación no frena nada */ }
        return avisos;
      },
    });
  }
}
