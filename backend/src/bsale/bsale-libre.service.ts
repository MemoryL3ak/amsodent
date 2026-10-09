import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from '../licitaciones/licitaciones.service';
import {
  BsaleFacturacionService, EMISOR, fechaAEpoch, folioCotizacion, normOc, normRut, ocDeReferencia, referenciaGuia, referenciaOcFactura, referenciaOcGuia, referenciaParaBsale, referenciaVista, sumarDias, totalesDe,
} from './bsale-facturacion.service';
import { BsaleDespachosService, OBSERVACION_MAX, limpiarObservacion, observacionSugerida } from './bsale-despachos.service';

/* ── Guías, facturas y boletas LIBRES en Bsale (2026-10-03) ──────────────────
   Pedido de Ariel: "necesito la opción de crear guías y facturas de manera
   libre". Sin orden de compra ni cotización de por medio: se elige el cliente
   (por RUT; si no está en Bsale se crea), se arman las líneas a mano (SKU,
   cantidad, precio neto), se completan despacho o forma de pago, y opcional-
   mente se referencia una OC o una guía y se cuelga de una cotización para
   que quede en Trazabilidad. Mismos dos pasos: simular y después emitir.

   VENTA DIRECTA (2026-10-03, segundo pedido): "emitir boletas/facturas
   instantáneamente; al generarlas se debe crear automáticamente una
   cotización". Es el mismo armado con `venta_directa: true` y tipo boleta o
   factura: al emitir, el sistema crea la cotización particular (adjudicada,
   a nombre del cliente, con los ítems), le registra el documento como
   factura_boleta y, si se pagó al emitir, el comprobante de pago. Es lo que
   el mesón hacía a mano ("meson", "boleta") en cuatro pantallas. */

const DTE_OC = 801;
const DTE_GUIA = 52;
const DTE_BOLETA = 39;
const IVA_ID = 1;
const MAX_FOLIO_REF = 18;
// RUT genérico del SII para boletas a consumidor final.
const RUT_CONSUMIDOR_FINAL = '66666666-6';

type Tipo = 'guia' | 'factura' | 'boleta';
type Problema = { codigo: string; mensaje: string };

const hoyEnChile = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const normSku = (v: any) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const texto = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
const rutBsale = (v: any) => {
  const limpio = normRut(v);
  return limpio.length > 1 ? `${limpio.slice(0, -1)}-${limpio.slice(-1)}` : limpio;
};
// RUT con dígito verificador correcto (descarta rellenos como 000000000).
const rutValido = (v: any) => {
  const limpio = normRut(v);
  if (limpio.length < 2) return false;
  const cuerpo = limpio.slice(0, -1);
  if (!/^\d+$/.test(cuerpo) || Number(cuerpo) === 0) return false;
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (suma % 11);
  return limpio.slice(-1) === (r === 11 ? '0' : r === 10 ? 'K' : String(r));
};
const esCredito = (nombreForma: any) => /^cr[eé]dito$/i.test(String(nombreForma || '').trim());
// Tipo de traslado de la guía de una venta directa: «Operación constituye venta».
const TRASLADO_VENTA = 1;
const etiquetaTipo = (t: Tipo) => (t === 'guia' ? 'Guía de despacho electrónica' : t === 'boleta' ? 'Boleta electrónica' : 'Factura electrónica');

/* La forma de pago de Bsale traducida al medio que usa Seguimiento de Pagos
   (transferencia | transbank | getnet | efectivo | webpay …). */
export function medioDePago(nombreBsale: any): string {
  const n = String(nombreBsale || '').toLowerCase();
  if (/efectivo/.test(n)) return 'efectivo';
  if (/transferencia/.test(n)) return 'transferencia';
  if (/getnet/.test(n)) return 'getnet';
  if (/tbk|transbank/.test(n)) return 'transbank';
  if (/webpay/.test(n)) return 'webpay';
  if (/mercado ?pago/.test(n)) return 'mercadopago';
  if (/tarjeta/.test(n)) return 'tarjeta';
  if (/cheque/.test(n)) return 'cheque';
  return n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'otro';
}

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
      formas_pago: formas.map((f) => ({ ...f, credito: esCredito(f.nombre) })),
      forma_pago_id: formas.find((f) => esCredito(f.nombre))?.id || formas[0]?.id || null,
      // Para la venta directa se parte de efectivo (lo más común en el mesón).
      forma_pago_venta_id: formas.find((f) => /efectivo/i.test(f.nombre))?.id || formas.find((f) => !esCredito(f.nombre))?.id || null,
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
    if (enBsale) return this.clienteDeBsale(enBsale);
    const { data } = await this.supabase.getClient().from('clientes').select('rut, nombre, direccion, comuna').limit(200);
    const propio = (data || []).find((c: any) => normRut(c.rut) === normRut(rut));
    return {
      id: null, nuevo: true, rut: rutBsale(rut),
      razon_social: String(propio?.nombre || '').trim(), giro: '', direccion: String(propio?.direccion || '').trim(),
      comuna: String(propio?.comuna || '').trim(), ciudad: String(propio?.comuna || '').trim(), email: '',
    };
  }

  /* Crear el cliente en Bsale desde el sistema (2026-10-07). Pedido de Ariel:
     en la venta directa, si el RUT no está en Bsale, una ventana con todos
     los campos que Bsale pide para crearlo. Empresa: razón social y giro;
     persona: nombres y apellidos. Dirección, comuna y ciudad siempre. Como
     toda acción en Bsale: se puede simular, y con la emisión apagada solo
     se simula. Si el RUT ya existe, devuelve el que hay (no duplica). */
  async crearCliente(usuario: { id: string; email: string }, body: any) {
    await this.facturacion.exigirRol(usuario.id);
    if (!rutValido(body?.rut)) throw new BadRequestException('El RUT no es válido (revisa el dígito verificador).');
    const rut = rutBsale(body.rut);
    const existente = await this.despachos.clientePorRut(rut);
    if (existente) return { ya_existia: true, cliente: this.clienteDeBsale(existente) };
    const persona = body?.tipo === 'persona';
    const c = {
      razon_social: texto(body?.razon_social, 120), nombres: texto(body?.nombres, 60), apellidos: texto(body?.apellidos, 60),
      giro: texto(body?.giro, 80), direccion: texto(body?.direccion, 120), comuna: texto(body?.comuna, 60), ciudad: texto(body?.ciudad, 60),
      email: texto(body?.email, 120), telefono: texto(body?.telefono, 30),
    };
    const faltan: string[] = [];
    if (persona) {
      if (!c.nombres) faltan.push('los nombres');
      if (!c.apellidos) faltan.push('los apellidos');
    } else {
      if (!c.razon_social) faltan.push('la razón social');
      if (!c.giro) faltan.push('el giro');
    }
    if (!c.direccion) faltan.push('la dirección');
    if (!c.comuna) faltan.push('la comuna');
    if (!c.ciudad) faltan.push('la ciudad');
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) faltan.push('un correo válido');
    if (faltan.length) throw new BadRequestException(`Falta ${faltan.join(', ')}.`);
    const solicitud: Record<string, any> = {
      code: rut,
      companyOrPerson: persona ? 0 : 1,
      ...(persona ? { firstName: c.nombres, lastName: c.apellidos } : { company: c.razon_social }),
      ...(c.giro ? { activity: c.giro } : {}),
      address: c.direccion, municipality: c.comuna, city: c.ciudad,
      ...(c.email ? { email: c.email } : {}),
      ...(c.telefono ? { phone: c.telefono } : {}),
    };
    if (body?.simular === true || !this.facturacion.emisionActiva) {
      return { simulacion: true, emision_apagada: body?.simular !== true, solicitud };
    }
    const creado = await this.facturacion.apiEnviar('POST', '/clients.json', solicitud);
    this.logger.log(`Cliente ${rut} creado en Bsale (id ${creado?.id}) por ${usuario.email}`);
    return { creado: true, cliente: this.clienteDeBsale(creado) };
  }

  private clienteDeBsale(c: any) {
    return {
      id: Number(c.id), nuevo: false, rut: String(c.code || ''),
      razon_social: String(c.company || `${c.firstName || ''} ${c.lastName || ''}`).trim(),
      giro: String(c.activity || ''), direccion: String(c.address || ''), comuna: String(c.municipality || ''),
      ciudad: String(c.city || ''), email: String(c.email || ''),
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

  /* Datos de una cotización para armar su documento (2026-10-07): boleta o
     factura del particular desde Trazabilidad, o guía desde la cotización
     adjudicada que no tiene orden de compra. Las líneas salen de sus ítems
     (precio neto unitario, con el flete repartido, igual que su total); los
     ítems sin SKU se informan aparte porque no pueden ir en Bsale. */
  async desdeCotizacion(userId: string, idRaw: any) {
    await this.facturacion.exigirRol(userId);
    const id = Number(idRaw);
    if (!(id > 0)) throw new BadRequestException('Indica la cotización.');
    const db = this.supabase.getClient();
    const { data: lic } = await db
      .from('licitaciones')
      .select('id, id_licitacion, nombre_entidad, rut_entidad, giro, direccion, comuna, email, tipo_cliente, estado')
      .eq('id', id)
      .maybeSingle();
    if (!lic) throw new BadRequestException(`No existe la cotización #${id}.`);
    const { data: items } = await db.from('items_licitacion').select('producto, sku, cantidad, valor_unitario, orden, observacion').eq('licitacion_id', id).order('orden', { ascending: true });
    const lineas: { sku: string; producto: string; cantidad: number; neto_unitario: number; observacion: string }[] = [];
    const sinSku: string[] = [];
    for (const it of (items as any[]) || []) {
      const cantidad = Number(it?.cantidad) || 0;
      if (!(cantidad > 0)) continue;
      const sku = normSku(it?.sku);
      const nombre = String(it?.producto || '').trim();
      if (!sku) { sinSku.push(nombre.slice(0, 80) || 'Ítem sin nombre'); continue; }
      const neto = Math.round(Number(it?.valor_unitario) || 0);
      const obs = String(it?.observacion || '').trim();
      const previa = lineas.find((l) => l.sku === sku);
      if (previa) {
        // Mismo SKU dos veces: una sola línea con el precio promedio ponderado.
        const total = previa.neto_unitario * previa.cantidad + neto * cantidad;
        previa.cantidad += cantidad;
        previa.neto_unitario = Math.round(total / previa.cantidad);
        if (obs && !previa.observacion.includes(obs)) previa.observacion = [previa.observacion, obs].filter(Boolean).join(' / ');
      } else {
        lineas.push({ sku, producto: nombre, cantidad, neto_unitario: neto, observacion: obs });
      }
    }
    const particular = /particular/i.test(String((lic as any).tipo_cliente || ''));
    const l: any = lic;
    // Hay particulares con RUT de relleno (000000000): se deja vacío para que
    // la boleta vaya a consumidor final y no se cree un cliente inválido en Bsale.
    const rut = rutValido(l.rut_entidad) ? rutBsale(l.rut_entidad) : '';
    return {
      cotizacion: { id: l.id, codigo: l.id_licitacion || null, cliente: l.nombre_entidad || '', particular, estado: l.estado || '' },
      rut_descartado: !rut && String(l.rut_entidad || '').trim() ? String(l.rut_entidad) : null,
      cliente: {
        rut, razon_social: String(l.nombre_entidad || ''), giro: String(l.giro || ''),
        direccion: String(l.direccion || ''), comuna: String(l.comuna || ''), ciudad: String(l.comuna || ''), email: String(l.email || ''),
      },
      lineas,
      sin_sku: sinSku,
      // Para el atributo «Observación» de la guía en Bsale (editable en pantalla).
      observacion_sugerida: observacionSugerida(lineas),
      observacion_max: OBSERVACION_MAX,
      tipo_sugerido: particular ? 'boleta' : 'factura',
    };
  }

  // ── Armado y validación ────────────────────────────────────────────────

  private async armar(body: any) {
    const tipo: Tipo = body?.tipo === 'factura' ? 'factura' : body?.tipo === 'boleta' ? 'boleta' : 'guia';
    const ventaDirecta = body?.venta_directa === true;
    const esBoleta = tipo === 'boleta';
    /* (2026-10-08) Pedido de Ariel: en la venta directa, casilla «Emitir guía de
       despacho» marcada por defecto. Con ella la boleta/factura va SIN despacho
       inmediato (dispatch) y el stock lo rebaja la guía, que se emite enseguida
       desde las líneas del documento: así no sale dos veces. */
    const conGuia = ventaDirecta && tipo !== 'guia' && body?.con_guia !== false;
    const problemas: Problema[] = [];
    const avisos: Problema[] = [];
    if (ventaDirecta && tipo === 'guia') problemas.push({ codigo: 'venta_guia', mensaje: 'La venta directa emite boleta o factura, no guía.' });

    // Cliente. En una boleta es opcional: sin RUT va a consumidor final.
    const rut = rutBsale(body?.cliente?.rut);
    const sinCliente = esBoleta && !rut;
    if (!rut && !esBoleta) problemas.push({ codigo: 'sin_rut', mensaje: 'Indica el RUT del cliente.' });
    const enBsale = rut ? await this.despachos.clientePorRut(rut) : null;
    const cliente: any = sinCliente
      ? null
      : enBsale
        ? this.clienteDeBsale(enBsale)
        : {
            id: null, nuevo: true, rut,
            razon_social: texto(body?.cliente?.razon_social, 120), giro: texto(body?.cliente?.giro, 80), direccion: texto(body?.cliente?.direccion, 120),
            comuna: texto(body?.cliente?.comuna, 60), ciudad: texto(body?.cliente?.ciudad, 60), email: texto(body?.cliente?.email, 120),
          };
    if (cliente?.nuevo && rut) {
      avisos.push({ codigo: 'cliente_nuevo', mensaje: `El cliente (RUT ${rut}) no existe en Bsale: se creará con los datos ingresados.` });
      if (esBoleta) {
        if (!cliente.razon_social) problemas.push({ codigo: 'cliente_incompleto', mensaje: 'Para crear el cliente en Bsale indica al menos su nombre o razón social (o deja la boleta sin cliente).' });
      } else if (!cliente.razon_social || !cliente.giro || !cliente.direccion || !cliente.comuna) {
        problemas.push({ codigo: 'cliente_incompleto', mensaje: 'El cliente nuevo necesita razón social, giro, dirección y comuna (Bsale los exige).' });
      }
    }

    // Líneas
    const crudas: any[] = Array.isArray(body?.lineas) ? body.lineas : [];
    const lineas: any[] = [];
    const vistos = new Set<string>();
    // Observación por producto (2026-10-08): la pantalla la manda por SKU; va al atributo «Observación» de la guía.
    const obsPorSku = body?.observaciones && typeof body.observaciones === 'object'
      ? new Map<string, any>(Object.keys(body.observaciones).map((k) => [normSku(k), body.observaciones[k]]))
      : null;
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
        observacion: limpiarObservacion(obsPorSku ? obsPorSku.get(sku) ?? l?.observacion : l?.observacion).slice(0, OBSERVACION_MAX),
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

    // Cotización a la que se cuelga (opcional; la venta directa crea la suya).
    let cotizacion: any = null;
    let licCot: any = null;
    if (!ventaDirecta && body?.cotizacion_id != null && String(body.cotizacion_id).trim() !== '') {
      const id = Number(body.cotizacion_id);
      const { data: lic } = id > 0 ? await this.supabase.getClient().from('licitaciones').select('id, id_licitacion, nombre_entidad, rut_entidad, tipo_cliente').eq('id', id).maybeSingle() : { data: null };
      if (!lic) problemas.push({ codigo: 'cotizacion', mensaje: `No existe la cotización #${body.cotizacion_id}.` });
      else {
        licCot = lic;
        cotizacion = { id: lic.id, codigo: lic.id_licitacion || null, cliente: lic.nombre_entidad || '', particular: /particular/i.test(String(lic.tipo_cliente || '')) };
        if (normRut(lic.rut_entidad) && rut && normRut(lic.rut_entidad) !== normRut(rut)) {
          avisos.push({ codigo: 'rut_cotizacion', mensaje: `La cotización #${lic.id} es de ${lic.nombre_entidad} (RUT ${lic.rut_entidad}), distinto del cliente del documento.` });
        }
      }
    }

    // Referencias (opcionales; la venta directa no lleva).
    //   OC en guía: folio = cotización, razón = N° de OC. OC en factura: N° de OC en ambos.
    //   Guía (en una factura): folio = N° de guía, razón = N° de OC si se conoce.
    const referencias: any[] = [];
    for (const r of ventaDirecta ? [] : Array.isArray(body?.referencias) ? body.referencias : []) {
      const numero = normOc(r?.numero);
      if (!numero) continue;
      const esGuia = r?.tipo === 'guia';
      const f = String(r?.fecha || '').slice(0, 10);
      const fechaRef = /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
      const ref = esGuia ? referenciaGuia(numero, fechaRef) : tipo === 'guia' ? referenciaOcGuia(licCot ? folioCotizacion(licCot) : numero, numero, fechaRef) : referenciaOcFactura(numero, fechaRef);
      if (ref.folio.length > MAX_FOLIO_REF) problemas.push({ codigo: 'folio_largo', mensaje: `El folio de referencia ${ref.folio} supera los ${MAX_FOLIO_REF} caracteres que acepta el SII.` });
      referencias.push(ref);
    }
    const ocReferenciada = referencias.find((r) => r.codigo_sii === DTE_OC)?.numero;
    if (ocReferenciada) for (const r of referencias) if (r.codigo_sii === DTE_GUIA) r.razon = ocReferenciada;

    // Tipo de documento y sus datos propios
    let tipoDocumentoId = 0;
    let despacho: any = null;
    let formaPago: any = null;
    let dias = 0;
    let descuentaStock = tipo === 'guia';
    let traslado: any = null;
    let credito = false;
    let pagadaAhora = false;
    let comprobante = '';
    let guiaVenta: any = null;
    if (tipo === 'guia') {
      const td = await this.despachos.tipoDocumento(String(DTE_GUIA), /gu[ií]a/i);
      tipoDocumentoId = Number(td?.id) || 0;
      if (!td) problemas.push({ codigo: 'sin_tipo', mensaje: 'La cuenta de Bsale no tiene activa la guía de despacho electrónica.' });
      const d = body?.despacho || {};
      despacho = {
        direccion: texto(d.direccion ?? cliente?.direccion, 120), comuna: texto(d.comuna ?? cliente?.comuna, 60), ciudad: texto(d.ciudad ?? cliente?.ciudad, 60),
        destinatario: texto(d.destinatario ?? cliente?.razon_social, 120), tipo_traslado_id: Number(d.tipo_traslado_id) || 0,
      };
      const traslados = await this.despachos.tiposTraslado();
      traslado = traslados.find((t) => t.id === despacho.tipo_traslado_id) || null;
      if (!despacho.direccion || !despacho.comuna || !despacho.ciudad || !despacho.destinatario) problemas.push({ codigo: 'despacho', mensaje: 'Completa destinatario, dirección, comuna y ciudad del despacho.' });
      if (!traslado) problemas.push({ codigo: 'traslado', mensaje: 'Elige el tipo de traslado.' });
    } else {
      const { tipoFactura, formas } = await this.facturacion.listas();
      if (esBoleta) {
        const tb = await this.despachos.tipoDocumento(String(DTE_BOLETA), /boleta/i);
        tipoDocumentoId = Number(tb?.id) || 0;
        if (!tb) problemas.push({ codigo: 'sin_tipo', mensaje: 'La cuenta de Bsale no tiene activa la boleta electrónica.' });
      } else {
        tipoDocumentoId = Number(tipoFactura?.id) || 0;
        if (!tipoFactura) problemas.push({ codigo: 'sin_tipo', mensaje: 'La cuenta de Bsale no tiene activa la factura electrónica.' });
      }
      formaPago = formas.find((f) => f.id === Number(body?.forma_pago_id)) || null;
      if (!formaPago) problemas.push({ codigo: 'forma_pago', mensaje: 'Elige la forma de pago.' });
      credito = !!formaPago && esCredito(formaPago.nombre);
      if (esBoleta && credito) problemas.push({ codigo: 'boleta_credito', mensaje: 'Una boleta se paga al emitirla: elige efectivo, transferencia, tarjeta o Webpay.' });
      dias = esBoleta ? 0 : Math.round(Number(body?.dias_vencimiento ?? 30));
      if (!Number.isFinite(dias) || dias < 0 || dias > 365) problemas.push({ codigo: 'plazo', mensaje: 'El plazo de vencimiento debe estar entre 0 y 365 días.' });
      // Una factura que no viene de una guía es la que mueve el stock. La venta directa siempre lo mueve.
      const refGuia = referencias.some((r) => r.codigo_sii === DTE_GUIA);
      descuentaStock = ventaDirecta ? !conGuia : body?.descuenta_stock == null ? !refGuia : body.descuenta_stock === true;
      if (refGuia && descuentaStock) avisos.push({ codigo: 'stock_doble', mensaje: 'La factura referencia una guía y además descuenta stock: si la guía ya lo descontó, saldría dos veces.' });
      if (!refGuia && !descuentaStock && !conGuia) avisos.push({ codigo: 'sin_stock', mensaje: 'La factura no descuenta stock: el stock en Bsale quedará como está.' });
      pagadaAhora = ventaDirecta && !!formaPago && !credito;
      if (conGuia) {
        const tg = await this.despachos.tipoDocumento(String(DTE_GUIA), /gu[ií]a/i);
        const d = body?.despacho || {};
        const despachoGuia = {
          direccion: texto(d.direccion ?? cliente?.direccion, 120), comuna: texto(d.comuna ?? cliente?.comuna, 60), ciudad: texto(d.ciudad ?? cliente?.ciudad, 60),
          destinatario: texto(d.destinatario ?? cliente?.razon_social, 120), tipo_traslado_id: Number(d.tipo_traslado_id) || TRASLADO_VENTA,
        };
        const traslados = await this.despachos.tiposTraslado();
        const trasladoGuia = traslados.find((t) => t.id === despachoGuia.tipo_traslado_id) || null;
        if (!tg) problemas.push({ codigo: 'sin_tipo_guia', mensaje: 'La cuenta de Bsale no tiene activa la guía de despacho electrónica: desmarca «Emitir guía de despacho».' });
        if (sinCliente) problemas.push({ codigo: 'guia_sin_cliente', mensaje: 'La guía de despacho necesita un cliente con RUT: indícalo o desmarca «Emitir guía de despacho».' });
        if (!despachoGuia.direccion || !despachoGuia.comuna || !despachoGuia.ciudad || !despachoGuia.destinatario) problemas.push({ codigo: 'despacho_guia', mensaje: 'Para la guía de despacho completa destinatario, dirección, comuna y ciudad (o desmarca «Emitir guía de despacho»).' });
        guiaVenta = { tipo_documento_id: Number(tg?.id) || 0, despacho: despachoGuia, traslado: trasladoGuia };
      }
      /* N° de comprobante del pago (2026-10-07). Pedido de Ariel: "al crear
         una boleta/factura nos debe solicitar ingresar el N° de comprobante".
         En la venta directa pagada al emitir es obligatorio (salvo efectivo,
         que no tiene comprobante); desde una cotización es opcional y, si
         viene, el documento queda pagado. A crédito no aplica. */
      comprobante = credito ? '' : texto(body?.comprobante, 60);
      if (pagadaAhora && !comprobante && medioDePago(formaPago?.nombre) !== 'efectivo') {
        problemas.push({ codigo: 'falta_comprobante', mensaje: `Indica el N° de comprobante del pago (${formaPago?.nombre}).` });
      }
      // A crédito rige el mismo freno por mora que al cotizar.
      if (ventaDirecta && credito && rut) {
        try {
          const bloqueo: any = await this.licitaciones.estadoBloqueoCliente(rut, 'Cliente Particular');
          if (bloqueo?.bloqueado) problemas.push({ codigo: 'mora', mensaje: `Cliente bloqueado por deuda: ${bloqueo.diasAtrasoMax} días de atraso (máximo permitido ${bloqueo.umbral}). Cóbrale al contado o pide el desbloqueo a un administrador.` });
        } catch { /* sin datos de mora no se frena */ }
      }
    }

    // Observación de la guía → atributo adicional del documento (2026-10-07).
    // Con `observaciones` por SKU (2026-10-08) cada texto va en la línea de su
    // producto (nota del detalle) y acá queda solo lo general. También para
    // la guía de la venta directa.
    const notasPorLinea = !!obsPorSku;
    const observacion = tipo === 'guia' || conGuia ? limpiarObservacion(body?.observacion) : '';
    if (observacion.length > OBSERVACION_MAX) problemas.push({ codigo: 'observacion_larga', mensaje: `La observación tiene ${observacion.length} caracteres; en Bsale caben hasta ${OBSERVACION_MAX}. Acórtala.` });
    const borrador = {
      observacion,
      notas_por_linea: notasPorLinea,
      comprobante,
      tipo, venta_directa: ventaDirecta, tipo_documento_id: tipoDocumentoId, cliente, lineas, totales, fecha_emision: fecha, referencias, despacho,
      con_guia: conGuia, guia: guiaVenta,
      traslado: traslado ? { id: traslado.id, nombre: traslado.nombre } : null,
      forma_pago: formaPago ? { id: formaPago.id, nombre: formaPago.nombre } : null, dias_vencimiento: dias, credito,
      medio_pago: formaPago ? medioDePago(formaPago.nombre) : null, pagada_ahora: pagadaAhora,
      vencimiento: tipo === 'guia' ? null : sumarDias(fecha, dias), descuenta_stock: descuentaStock, cotizacion, problemas, avisos,
    };
    const huella = this.facturacion.huellaDe({
      cliente: { id: cliente?.id || cliente?.rut || 'consumidor-final' }, tipo_documento_id: tipoDocumentoId,
      lineas: lineas.map((l) => ({ detalle_id: l.variante_id, cantidad: l.cantidad, neto: l.neto_unitario })),
      referencias: [...referencias.map((r) => ({ codigo_sii: r.codigo_sii, folio: r.folio, numero: r.numero })), { codigo_sii: 0, numero: `${tipo}|${ventaDirecta}|${fecha}|${JSON.stringify(despacho)}|${formaPago?.id}|${dias}|${descuentaStock}|${conGuia}|${conGuia ? JSON.stringify(guiaVenta?.despacho) : ''}|${cotizacion?.id || ''}|${cliente?.nuevo ? JSON.stringify(cliente) : ''}|${observacion}|${lineas.map((l) => l.observacion || '').join('|')}` }],
      totales,
    });
    return { ...borrador, huella };
  }

  private vista(b: any) {
    const c = b.cliente;
    const nombreCliente = c?.razon_social || 'consumidor final';
    return {
      tipo: etiquetaTipo(b.tipo),
      sii: true,
      descuenta_stock: b.descuenta_stock,
      emisor: EMISOR,
      cliente: c ? { razon_social: c.razon_social, rut: c.rut, giro: c.giro, direccion: c.direccion, comuna: c.comuna, nuevo: c.nuevo } : {},
      lineas: b.lineas.map((l: any) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto, observacion: b.tipo === 'guia' && b.notas_por_linea ? l.observacion || null : null })),
      totales: b.totales,
      referencias: b.referencias.map(referenciaVista),
      forma_pago: b.forma_pago?.nombre || null,
      fecha_emision: b.fecha_emision,
      vencimiento: b.tipo === 'factura' ? b.vencimiento : null,
      despacho: b.despacho ? { ...b.despacho, tipo_traslado: b.traslado?.nombre || null } : null,
      guia: b.guia ? { ...b.guia.despacho, tipo_traslado: b.guia.traslado?.nombre || null } : null,
      notas: [
        b.tipo === 'guia'
          ? 'Bsale descuenta el stock al emitir la guía.'
          : b.con_guia
            ? `Enseguida se emite la guía de despacho con las mismas líneas (${b.guia?.traslado?.nombre || 'Operación constituye venta'}) a ${b.guia?.despacho?.direccion || '—'}, ${b.guia?.despacho?.comuna || '—'}: el stock lo rebaja la guía, no la ${b.tipo}.`
            : b.descuenta_stock ? `La ${b.tipo} descuenta el stock en Bsale${b.venta_directa ? '' : ' (no viene de una guía)'}.` : 'La factura no mueve stock.',
        b.venta_directa
          ? `Al emitir se crea en el sistema una cotización particular adjudicada a nombre de ${nombreCliente}, con estos ítems y el documento registrado${b.pagada_ahora ? ` y pagado (${b.forma_pago?.nombre}).` : ' con el pago pendiente (crédito): aparecerá en Seguimiento de Pagos.'}`
          : b.cotizacion ? `Quedará registrada en la cotización #${b.cotizacion.id}${b.cotizacion.codigo ? ` (${b.cotizacion.codigo})` : ''}.` : 'No se indicó cotización: quedará solo en Bsale y en el historial de Emitidas.',
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
    const c = b.cliente;
    const cli = !c
      ? {}
      : c.nuevo
        ? {
            client: {
              code: c.rut, company: c.razon_social, companyOrPerson: 1,
              ...(c.giro ? { activity: c.giro } : {}), ...(c.direccion ? { address: c.direccion } : {}), ...(c.comuna ? { municipality: c.comuna } : {}),
              ...(c.ciudad ? { city: c.ciudad } : {}), ...(c.email ? { email: c.email } : {}),
            },
          }
        : { clientId: c.id };
    const letra = b.tipo === 'guia' ? 'G' : b.tipo === 'boleta' ? 'B' : 'F';
    // AMS-V-…: venta directa (la que crea su cotización); AMS-L-…: documento libre.
    const clave = `AMS-${b.venta_directa ? 'V' : 'L'}-${letra}-${b.huella}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;
    const details = b.lineas.map((l: any) => ({
      code: l.sku, quantity: l.cantidad, netUnitValue: l.neto_unitario, taxId: `[${IVA_ID}]`,
      // Observación del producto → nota de su línea en la guía (2026-10-08).
      ...(b.tipo === 'guia' && b.notas_por_linea && l.observacion ? { comment: l.observacion } : {}),
    }));
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
            ...cli, details, payments: [{ paymentTypeId: b.forma_pago.id, amount: b.totales.total, recordDate: emision }], ...(references.length ? { references } : {}), salesId,
            ...(b.descuenta_stock ? { dispatch: 1 } : {}),
          };
    const obs = b.tipo === 'guia' ? await this.despachos.observacionParaBsale(b.observacion, b.tipo_documento_id) : { texto: '', atributo: null, aviso: null };
    if (obs.atributo) solicitud.dynamicAttributes = [obs.atributo];
    const vista: any = this.vista(b);
    if (obs.texto) vista.observacion = obs.texto;
    if (obs.aviso) vista.notas = [...vista.notas, obs.aviso];
    // (2026-10-07) Guía, factura o boleta se envían solas al cliente (si queda en
    // una cotización: la venta directa crea la suya). Sin cotización no se envía.
    vista.correo = b.cotizacion || b.venta_directa
      ? await this.despachos.correoPrevio(b.cotizacion?.id || null, b.cliente?.email || null)
      : { activo: false, para: null, motivo: 'Sin cotización: el documento no se envía por correo.' };
    if (!real) {
      return { simulacion: true, emision_apagada: !simular, solicitud, totales: b.totales, vista, huella: b.huella, avisos: b.avisos };
    }

    const esGuia = b.tipo === 'guia';
    let creada: any = null;
    let comprobanteRegistrado: { numero: string; pagada: boolean } | null = null;
    const r = await this.despachos.emitirReal({
      usuario, clave, salesId, tipo: b.tipo, ruta: esGuia ? '/shippings.json' : '/documents.json', solicitud, vista,
      licitacionId: b.cotizacion?.id || null, origenDocId: null,
      lineas: b.lineas.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario, ...(l.observacion ? { observacion: l.observacion } : {}) })),
      bucket: esGuia ? 'guia-despacho' : 'factura',
      ...(b.cotizacion || b.venta_directa ? { correo: { tipo: b.tipo, para: b.cliente?.email || null } } : {}),
      registrar: async (doc: any, pdf: any) => {
        if (b.venta_directa) {
          const res = await this.registrarVentaDirecta(b, doc, pdf, usuario);
          creada = res.cotizacion;
          return res.documentoId;
        }
        if (!b.cotizacion) return null; // sin cotización no hay dónde colgarlo: queda en Bsale y en Emitidas
        if (esGuia) {
          // Si la cotización tiene una sola orden de compra, la guía cuelga de ella.
          const { data: ocs } = await this.supabase.getClient().from('licitacion_documentos').select('id').eq('licitacion_id', b.cotizacion.id).eq('tipo', 'orden_compra');
          const creado = await this.licitaciones.createDocumento({
            licitacion_id: b.cotizacion.id, tipo: 'guia_despacho', numero: String(doc.number), monto: null, fecha_oc: b.fecha_emision,
            deriva_de_id: (ocs || []).length === 1 ? (ocs as any[])[0].id : null,
            empresa_despacho: String(body?.seguimiento?.empresa || '').trim().slice(0, 60) || null,
            n_seguimiento: String(body?.seguimiento?.numero || '').trim().slice(0, 80) || null,
            bucket: pdf ? 'guia-despacho' : null, storage_path: pdf?.path || null, file_name: pdf ? `Guía ${doc.number}.pdf` : null,
            mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null, bsale_id: Number(doc.id) || null, bsale_url: doc.urlPdf || doc.urlPublicView || null,
          });
          return Number((creado as any)?.id) || null;
        }
        const etiqueta = b.tipo === 'boleta' ? 'Boleta' : 'Factura';
        // Cliente particular: su documento es "Factura o Boleta" (así lo leen Trazabilidad y Pagos).
        const comoParticular = b.cotizacion.particular === true;
        const fila = await this.insertarTolerante('licitacion_documentos', {
          licitacion_id: b.cotizacion.id, tipo: comoParticular ? 'factura_boleta' : 'factura', numero: String(doc.number),
          monto: Number(doc.netAmount ?? b.totales.neto) || null, fecha_oc: comoParticular ? b.fecha_emision : null,
          fecha_factura: b.fecha_emision, deriva_de_id: null, guias_ids: null, bucket: pdf ? 'factura' : null, storage_path: pdf?.path || null,
          file_name: pdf ? `${etiqueta} ${doc.number}.pdf` : null, mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null,
          bsale_id: Number(doc.id) || null, bsale_url: doc.urlPdf || doc.urlPublicView || null, ...(b.tipo === 'boleta' ? { descripcion: 'Boleta electrónica' } : {}),
        });
        const docId = Number(fila?.id) || null;
        if (docId && b.comprobante && !b.credito) {
          try {
            const pago: any = await this.licitaciones.createDocumento({
              licitacion_id: b.cotizacion.id, tipo: 'comprobante_pago', numero: b.comprobante, monto: Number(doc.netAmount ?? b.totales.neto) || b.totales.neto,
              fecha_oc: b.fecha_emision, deriva_de_id: docId, forma_pago: b.medio_pago,
              descripcion: `Pago de la ${b.tipo} ${doc.number} (${b.forma_pago?.nombre || 'pago'}), registrado al emitirla.`,
            });
            comprobanteRegistrado = { numero: b.comprobante, pagada: !!pago?.factura_pagada };
          } catch (e: any) {
            this.logger.warn(`${etiqueta} ${doc.number}: el comprobante ${b.comprobante} no se pudo registrar: ${e?.message || e}`);
          }
        }
        return docId;
      },
      verificar: async (doc: any) => {
        const avisos: string[] = [];
        const sinObs = obs.atributo ? await this.despachos.avisoObservacion(Number(doc.id), doc.number, obs.texto) : null;
        if (sinObs) avisos.push(sinObs);
        if (b.tipo === 'guia' && b.notas_por_linea) {
          const sinNotas = await this.despachos.avisoNotasLineas(Number(doc.id), doc.number, b.lineas);
          if (sinNotas) avisos.push(sinNotas);
        }
        if (!b.referencias.length) return avisos;
        try {
          const completo = await this.facturacion.apiGet(`/documents/${Number(doc.id)}.json?expand=[references]`);
          const refs: any[] = completo?.references?.items || [];
          for (const ref of b.referencias) {
            const esta = ref.codigo_sii === DTE_OC ? refs.some((x: any) => ocDeReferencia(x) === ref.numero) : refs.some((x: any) => normOc(x?.number) === normOc(ref.folio));
            if (!esta) avisos.push(`El documento ${doc.number} salió sin la referencia ${ref.codigo_sii === DTE_OC ? 'a la orden de compra' : 'a la guía'} ${ref.numero}: agrégala en Bsale.`);
          }
        } catch { /* la verificación no frena nada */ }
        return avisos;
      },
    });
    // (2026-10-08) Venta directa con guía: se emite enseguida desde las líneas del documento.
    let guia: any = null;
    if (b.con_guia && r?.emitida && r?.bsale_id) guia = await this.emitirGuiaDeVenta(usuario, b, r, clave, creada, body);
    return { ...r, cotizacion: creada, comprobante: comprobanteRegistrado, guia };
  }

  /* Guía de despacho de la venta directa, desde las líneas del documento recién
     emitido (Bsale: `details` con el detailId del documento origen y
     «Operación constituye venta»). Si falla, la boleta/factura ya está
     emitida SIN rebajar stock: se avisa y queda «Emitir guía» en la cotización. */
  private async emitirGuiaDeVenta(usuario: { id: string; email: string }, b: any, docEmitido: any, claveBase: string, cotizacion: any, body: any) {
    try {
      const g = b.guia;
      const lineasDoc: any[] = await this.facturacion.todos(`/documents/${Number(docEmitido.bsale_id)}/details.json`, '');
      // La observación de cada producto va en la línea de la guía (nota del detalle); se reconoce por la variante.
      const obsPorVariante = new Map<number, string>(b.lineas.filter((l: any) => l.variante_id && l.observacion).map((l: any) => [Number(l.variante_id), String(l.observacion)]));
      const details = lineasDoc
        .map((d: any) => {
          const nota = b.notas_por_linea ? obsPorVariante.get(Number(d?.variant?.id)) : null;
          return { detailId: Number(d.id), quantity: Number(d.quantity) || 0, ...(nota ? { comment: nota } : {}) };
        })
        .filter((d) => d.detailId && d.quantity > 0);
      if (!details.length) throw new Error('Bsale no devolvió las líneas del documento emitido.');
      const clienteId = b.cliente?.id || (b.cliente?.rut ? (await this.despachos.clientePorRut(b.cliente.rut))?.id : null);
      const emision = fechaAEpoch(b.fecha_emision);
      const claveG = `${claveBase}-G`;
      const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', claveG).eq('estado', 'emitida');
      const salesId = `${claveG}-${(previas || []).length}`;
      const solicitud: Record<string, any> = {
        documentTypeId: g.tipo_documento_id, emissionDate: emision, expirationDate: emision, declareSii: 1,
        shippingTypeId: g.despacho.tipo_traslado_id, address: g.despacho.direccion, municipality: g.despacho.comuna, city: g.despacho.ciudad, recipient: g.despacho.destinatario,
        ...(clienteId ? { clientId: clienteId } : {}), details, salesId,
      };
      const obs = await this.despachos.observacionParaBsale(b.observacion || '', g.tipo_documento_id);
      if (obs.atributo) solicitud.dynamicAttributes = [obs.atributo];
      const vista: any = this.vista({
        ...b, tipo: 'guia', tipo_documento_id: g.tipo_documento_id, despacho: g.despacho, traslado: g.traslado, descuenta_stock: true, con_guia: false, guia: null, referencias: [],
        venta_directa: false, cotizacion: cotizacion ? { id: cotizacion.id, codigo: cotizacion.codigo } : null,
      });
      const r = await this.despachos.emitirReal({
        usuario, clave: claveG, salesId, tipo: 'guia', ruta: '/shippings.json', solicitud, vista,
        licitacionId: cotizacion?.id || null, origenDocId: docEmitido.documento_id || null,
        lineas: b.lineas.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario, ...(l.observacion ? { observacion: l.observacion } : {}) })),
        bucket: 'guia-despacho',
        correo: { tipo: 'guia', para: b.cliente?.email || null },
        registrar: async (doc: any, pdf: any) => {
          if (!cotizacion?.id) return null;
          const creado = await this.licitaciones.createDocumento({
            licitacion_id: cotizacion.id, tipo: 'guia_despacho', numero: String(doc.number), monto: Number(doc.netAmount) || b.totales.neto || null, fecha_oc: b.fecha_emision,
            deriva_de_id: null,
            empresa_despacho: String(body?.seguimiento?.empresa || '').trim().slice(0, 60) || null,
            n_seguimiento: String(body?.seguimiento?.numero || '').trim().slice(0, 80) || null,
            bucket: pdf ? 'guia-despacho' : null, storage_path: pdf?.path || null, file_name: pdf ? `Guía ${doc.number}.pdf` : null,
            mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null, bsale_id: Number(doc.id) || null, bsale_url: doc.urlPdf || doc.urlPublicView || null,
          });
          const guiaId = Number((creado as any)?.id) || null;
          // La boleta/factura queda enlazada a su guía: así no aparece en «Guías por facturar».
          if (guiaId && docEmitido.documento_id) {
            await this.supabase.getClient().from('licitacion_documentos').update({ guias_ids: [guiaId] }).eq('id', Number(docEmitido.documento_id));
          }
          return guiaId;
        },
        verificar: async (doc: any) => {
          const avisos: string[] = [];
          const sinObs = obs.atributo ? await this.despachos.avisoObservacion(Number(doc.id), doc.number, obs.texto) : null;
          if (sinObs) avisos.push(sinObs);
          if (b.notas_por_linea) {
            const sinNotas = await this.despachos.avisoNotasLineas(Number(doc.id), doc.number, b.lineas);
            if (sinNotas) avisos.push(sinNotas);
          }
          return avisos;
        },
      });
      return { emitida: true, numero: r.numero, url_pdf: r.url_pdf, documento_id: r.documento_id, avisos: r.avisos || [] };
    } catch (e: any) {
      const error = String(e?.message || e).slice(0, 200);
      this.logger.warn(`Venta directa ${docEmitido.numero}: la guía no se pudo emitir: ${error}`);
      return { emitida: false, error };
    }
  }

  // ── Venta directa: la cotización que antes se armaba a mano ────────────

  /* Crea la cotización particular ADJUDICADA con los ítems vendidos, registra
     el documento emitido como factura_boleta (monto NETO, como todo en
     licitacion_documentos) y, si se pagó al emitir, el comprobante de pago con
     el medio. Corre después de que Bsale confirmó el documento: si algo falla
     acá, emitirReal lo avisa y el documento ya existe en Bsale. */
  private async registrarVentaDirecta(b: any, doc: any, pdf: { path: string; size: number } | null, usuario: { id: string; email: string }) {
    const db = this.supabase.getClient();
    const { data: perfil } = await db.from('profiles').select('nombre, celular, email').eq('id', usuario.id).maybeSingle();
    const c = b.cliente;
    const nombreCliente = texto(c?.razon_social, 160) || 'Consumidor final';
    const etiqueta = etiquetaTipo(b.tipo);
    const numero = String(doc.number);
    const hoy = b.fecha_emision;
    const ahora = new Date().toISOString();

    const lic = await this.insertarTolerante('licitaciones', {
      id_licitacion: `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      nombre: `Venta directa · ${etiqueta} N° ${numero} · ${nombreCliente}`.slice(0, 200),
      fecha_hora_cierre: null, fecha: hoy, monto: 0, lista_precios: 1,
      rut_entidad: c?.rut || RUT_CONSUMIDOR_FINAL, nombre_entidad: nombreCliente, giro: c?.giro || null,
      tipo_cliente: 'Cliente Particular', tipo_compra: 'Cliente particular', departamento: b.tipo === 'boleta' ? 'boleta' : 'factura', municipalidad: '',
      direccion: c?.direccion || '', sucursal: 'Casa Matriz', region: '', comuna: c?.comuna || '', contacto: '', email: c?.email || '', telefono: '',
      condicion_venta: b.credito ? `Crédito ${b.dias_vencimiento} días` : 'Contado',
      creado_por: usuario.email, estado: 'Adjudicada', fecha_adjudicada: ahora, madre_id: null, jerarquia: 'madre', flete_estimado: 0,
      total_con_iva: b.totales.total, total_sin_iva: b.totales.neto, total_iva: b.totales.iva,
      observaciones: `Creada automáticamente por la venta directa: ${etiqueta} N° ${numero} emitida en Bsale por ${usuario.email}.`,
      vendedor_nombre: (perfil as any)?.nombre || null, vendedor_celular: (perfil as any)?.celular || null, vendedor_correo: (perfil as any)?.email || usuario.email,
      estado_entrega: 'Entregado', estado_envio: 'retirado',
    });
    const licId = Number(lic.id);
    // Para cliente particular el código de la cotización es su propio número.
    await db.from('licitaciones').update({ id_licitacion: String(licId) }).eq('id', licId);

    const skus = b.lineas.map((l: any) => l.sku);
    const { data: prods } = await db.from('productos').select('sku, formato, categoria, costo').in('sku', skus);
    const porSku = new Map<string, any>((prods || []).map((p: any) => [normSku(p.sku), p]));
    await this.licitaciones.insertItems(
      b.lineas.map((l: any, i: number) => {
        const p = porSku.get(l.sku);
        return {
          licitacion_id: licId, orden: i + 1, producto: l.producto, formato: p?.formato || null, cantidad: l.cantidad,
          valor_unitario: l.neto_unitario, sku: l.sku, total: l.neto, categoria: p?.categoria || null, observacion: null,
          costo: p?.costo != null ? Number(p.costo) : null,
        };
      }),
    );

    const documento = await this.insertarTolerante('licitacion_documentos', {
      licitacion_id: licId, tipo: 'factura_boleta', numero, descripcion: etiqueta, monto: Number(doc.netAmount ?? b.totales.neto) || b.totales.neto,
      fecha_oc: hoy, fecha_factura: hoy, deriva_de_id: null,
      bucket: pdf ? 'factura' : null, storage_path: pdf?.path || null, file_name: pdf ? `${etiqueta} ${numero}.pdf` : null,
      mime_type: pdf ? 'application/pdf' : null, size_bytes: pdf?.size || null,
      bsale_id: Number(doc.id) || null, bsale_url: doc.urlPdf || doc.urlPublicView || null,
      pagada: b.pagada_ahora, fecha_pago: b.pagada_ahora ? hoy : null, forma_pago: b.pagada_ahora ? b.medio_pago : null,
    });
    const documentoId = Number(documento?.id) || null;
    if (b.pagada_ahora && documentoId) {
      try {
        await this.insertarTolerante('licitacion_documentos', {
          licitacion_id: licId, tipo: 'comprobante_pago', numero: b.comprobante || `Pago ${b.forma_pago.nombre}`, monto: b.totales.neto, fecha_oc: hoy,
          deriva_de_id: documentoId, forma_pago: b.medio_pago, descripcion: `Pago recibido al emitir la ${b.tipo} (${b.forma_pago.nombre}).`,
        });
      } catch (e: any) {
        this.logger.warn(`Venta directa ${numero}: el comprobante de pago no se pudo registrar: ${e?.message || e}`);
      }
    }
    this.logger.log(`Venta directa: ${etiqueta} ${numero} → cotización #${licId} (${nombreCliente}) por ${usuario.email}`);
    return { documentoId, cotizacion: { id: licId, codigo: String(licId), nombre: nombreCliente, pagada: b.pagada_ahora } };
  }

  /* Inserta tolerando columnas que aún no existen (migraciones pendientes):
     quita la columna que la base no reconoce y reintenta. */
  private async insertarTolerante(tabla: string, fila: Record<string, any>): Promise<any> {
    const db = this.supabase.getClient();
    let payload: Record<string, any> = { ...fila };
    for (let intento = 0; intento < 10; intento++) {
      const r: any = await db.from(tabla).insert([payload]).select().single();
      if (!r.error) return r.data;
      const msg = String(r.error.message || '');
      const m = msg.match(/Could not find the '([^']+)' column/i) || msg.match(/column "?([a-zA-Z0-9_]+)"? (?:of relation|does not exist)/i);
      const col = m?.[1];
      if (!col || !(col in payload)) throw new Error(`${tabla}: ${msg}`);
      const { [col]: _omitida, ...resto } = payload;
      payload = resto;
    }
    throw new Error(`${tabla}: demasiadas columnas desconocidas`);
  }
}
