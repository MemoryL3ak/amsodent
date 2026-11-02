import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { InventarioService } from '../inventario/inventario.service';
import { BsaleFacturacionService, EMISOR, fechaAEpoch, totalesDe } from './bsale-facturacion.service';
import { BsaleDespachosService } from './bsale-despachos.service';

/* ============================================================================
   Guía de traslado interno en Bsale (2026-11-02)
   ----------------------------------------------------------------------------
   Bsale mueve stock entre SUS sucursales con una guía de despacho electrónica
   de tipo «Traslados internos (no constituye venta)» (código SII 5): se crea
   por POST /v1/shippings.json con `officeId` (origen) y `destinationOfficeId`
   (destino). Al emitirla Bsale descuenta el origen; el destino sube cuando la
   recepciona (shipping.received = 1), lo que la sincronización detecta y
   refleja en el traslado del sistema.

   Un traslado del inventario (InventarioService) se emite acá cuando ambas
   sucursales tienen `bsale_office_id`. Dos pasos, como el resto de las
   emisiones: Simular (vista previa, no escribe) y Emitir (real, irreversible
   ante el SII). La emisión real pasa por BsaleDespachosService.emitirReal
   (registro en bsale_emisiones, POST, PDF).

   Lo que Bsale exige para reconocer el traslado como interno: la propia
   empresa debe existir como CLIENTE (ayuda de Bsale); se busca por el RUT del
   emisor. Los valores unitarios van con el costo neto del catálogo: no es una
   venta, pero la guía electrónica lleva montos.
   NUNCA se ha emitido una guía de traslado real desde acá (la cuenta tiene
   una sola sucursal al 2026-11-02): la primera debe supervisarse en Bsale.
============================================================================ */

const IVA_ID = 1;
const DTE_GUIA = '52';
const CODIGO_SII_TRASLADO_INTERNO = 5;

function hoyChile(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

@Injectable()
export class BsaleTrasladosService {
  private readonly logger = new Logger(BsaleTrasladosService.name);
  private cacheOficinas: { ts: number; items: any[] } | null = null;

  constructor(
    private supabase: SupabaseService,
    private inventario: InventarioService,
    private facturacion: BsaleFacturacionService,
    private despachos: BsaleDespachosService,
  ) {}

  /* Sucursales de la cuenta de Bsale (/offices.json), 10 min en caché. Para
     el mantenedor de sucursales del inventario (elegir bsale_office_id). */
  async oficinas() {
    if (this.cacheOficinas && Date.now() - this.cacheOficinas.ts < 10 * 60 * 1000) return this.cacheOficinas.items;
    const items = (await this.facturacion.todos('/offices.json')).map((o: any) => ({
      id: Number(o?.id),
      nombre: String(o?.name || '').trim(),
      direccion: String(o?.address || '').trim(),
      comuna: String(o?.municipality || '').trim(),
      ciudad: String(o?.city || '').trim(),
      activa: Number(o?.state) === 0,
    })).filter((o: any) => o.id);
    this.cacheOficinas = { ts: Date.now(), items };
    return items;
  }

  /* Borrador de la guía para un traslado: qué iría a Bsale y qué lo impide. No escribe nada. */
  async preparar(trasladoId: number) {
    if (!trasladoId) throw new BadRequestException('Falta el traslado.');
    const t = await this.inventario.trasladoPorId(trasladoId);
    const sucursales = await this.inventario.listarSucursales();
    const origen = sucursales.find((s) => s.id === t.origen.id) || null;
    const destino = sucursales.find((s) => s.id === t.destino.id) || null;
    const problemas: string[] = [];

    if (t.estado !== 'en_transito') {
      problemas.push(`El traslado #${t.id} está ${t.estado === 'recibido' ? 'recibido' : 'anulado'}: la guía en Bsale se emite mientras está en tránsito.`);
    }
    if (t.bsale_id) problemas.push(`Este traslado ya tiene la guía N° ${t.bsale_numero || t.bsale_doc_id || t.bsale_id} en Bsale.`);
    if (!origen?.bsale_office_id) problemas.push(`La sucursal de origen «${t.origen.nombre}» no está asociada a una sucursal de Bsale (pestaña Sucursales → editar).`);
    if (!destino?.bsale_office_id) problemas.push(`La sucursal de destino «${t.destino.nombre}» no está asociada a una sucursal de Bsale (pestaña Sucursales → editar).`);
    if (origen?.bsale_office_id && origen.bsale_office_id === destino?.bsale_office_id) {
      problemas.push('El origen y el destino apuntan a la misma sucursal de Bsale: no hay traslado que emitir.');
    }

    let oficinas: any[] = [];
    try {
      oficinas = await this.oficinas();
    } catch (e: any) {
      problemas.push(`No se pudieron leer las sucursales de Bsale: ${String(e?.message || e).slice(0, 100)}.`);
    }
    const ofOrigen = oficinas.find((o) => o.id === Number(origen?.bsale_office_id)) || null;
    const ofDestino = oficinas.find((o) => o.id === Number(destino?.bsale_office_id)) || null;
    if (oficinas.length && origen?.bsale_office_id && !ofOrigen) problemas.push(`Bsale no tiene la sucursal ${origen.bsale_office_id} (origen).`);
    if (oficinas.length && destino?.bsale_office_id && !ofDestino) problemas.push(`Bsale no tiene la sucursal ${destino.bsale_office_id} (destino).`);
    if (ofOrigen && !ofOrigen.activa) problemas.push(`La sucursal de Bsale «${ofOrigen.nombre}» (origen) está inactiva.`);
    if (ofDestino && !ofDestino.activa) problemas.push(`La sucursal de Bsale «${ofDestino.nombre}» (destino) está inactiva.`);

    let tipoDoc: any = null;
    try {
      tipoDoc = await this.despachos.tipoDocumento(DTE_GUIA, /gu[ií]a/i);
    } catch (e: any) {
      problemas.push(`No se pudo leer los tipos de documento de Bsale: ${String(e?.message || e).slice(0, 100)}.`);
    }
    if (!tipoDoc && !problemas.some((p) => p.includes('tipos de documento'))) {
      problemas.push('La cuenta de Bsale no tiene activa la guía de despacho electrónica.');
    }
    let tiposTraslado: Array<{ id: number; nombre: string; codigo_sii: number | null }> = [];
    try {
      tiposTraslado = await this.despachos.tiposTraslado();
    } catch { /* se avisa abajo */ }
    const interno = tiposTraslado.find((x) => x.codigo_sii === CODIGO_SII_TRASLADO_INTERNO) || tiposTraslado.find((x) => /interno/i.test(x.nombre)) || null;
    if (!interno) problemas.push('Bsale no tiene el tipo de despacho «Traslados internos (no constituye venta)».');

    let cliente: any = null;
    try {
      cliente = await this.despachos.clientePorRut(EMISOR.rut);
    } catch (e: any) {
      problemas.push(`No se pudo buscar el cliente en Bsale: ${String(e?.message || e).slice(0, 100)}.`);
    }
    if (!cliente && !problemas.some((p) => p.includes('buscar el cliente'))) {
      problemas.push(`Para una guía de traslado interno, Bsale exige que la propia empresa exista como cliente: crea a ${EMISOR.razon_social} (RUT ${EMISOR.rut}) en Bsale → Clientes.`);
    }

    // Líneas: SKU en Bsale y costo neto del catálogo como valor unitario.
    const ids = [...new Set((t.lineas || []).map((l: any) => Number(l.producto_id)))];
    const costos = new Map<number, number>();
    if (ids.length) {
      const { data } = await this.supabase.getClient().from('productos').select('id, costo').in('id', ids);
      for (const p of data || []) costos.set(Number(p.id), Math.max(0, Math.round(Number(p.costo) || 0)));
    }
    const lineas: any[] = [];
    for (const l of t.lineas || []) {
      const sku = String(l.sku || '').trim();
      let variante: any = null;
      if (!sku) problemas.push(`${l.nombre || `producto ${l.producto_id}`}: sin SKU, no puede ir a Bsale.`);
      else {
        try {
          variante = await this.despachos.variantePorSku(sku);
        } catch { /* queda como no encontrada */ }
        if (!variante) problemas.push(`El SKU ${sku} no está en Bsale.`);
      }
      const neto_unitario = costos.get(Number(l.producto_id)) || 0;
      lineas.push({
        sku,
        producto: l.nombre || String(variante?.product?.name || '').trim() || sku,
        cantidad: Number(l.cantidad) || 0,
        neto_unitario,
        neto: Math.round(neto_unitario * (Number(l.cantidad) || 0)),
        variante_id: variante ? Number(variante.id) : null,
        en_bsale: !!variante,
      });
    }
    if (!lineas.length) problemas.push('El traslado no tiene líneas.');
    const totales = totalesDe(lineas);

    const despacho = {
      direccion: texto(ofDestino?.direccion || destino?.direccion, 120),
      comuna: texto(ofDestino?.comuna || destino?.comuna, 60),
      ciudad: texto(ofDestino?.ciudad || ofDestino?.comuna || destino?.comuna, 60),
      destinatario: texto(`${EMISOR.razon_social} · ${destino?.nombre || ''}`, 120),
      tipo_traslado_id: interno?.id || null,
      tipo_traslado: interno?.nombre || null,
    };
    if (!despacho.direccion || !despacho.comuna) {
      problemas.push(`La sucursal de destino «${destino?.nombre || ''}» necesita dirección y comuna (en el sistema o en su sucursal de Bsale).`);
    }

    const fecha_emision = hoyChile();
    const huella = this.facturacion.huellaDe({
      cliente: { id: cliente?.id || EMISOR.rut },
      tipo_documento_id: tipoDoc?.id || null,
      lineas: lineas.map((l) => ({ detalle_id: l.variante_id, cantidad: l.cantidad, neto: l.neto_unitario })),
      referencias: [{ traslado: t.id, origen: origen?.bsale_office_id || null, destino: destino?.bsale_office_id || null }],
      totales,
    });

    return {
      traslado: { id: t.id, estado: t.estado, motivo: t.motivo, referencia: t.referencia, created_at: t.created_at, usuario_email: t.usuario_email },
      origen: { ...t.origen, bsale_office_id: origen?.bsale_office_id || null, oficina: ofOrigen },
      destino: { ...t.destino, bsale_office_id: destino?.bsale_office_id || null, oficina: ofDestino },
      cliente: cliente ? { id: Number(cliente.id), razon_social: String(cliente.company || `${cliente.firstName || ''} ${cliente.lastName || ''}`).trim(), rut: String(cliente.code || EMISOR.rut) } : null,
      tipo_documento_id: tipoDoc ? Number(tipoDoc.id) : null,
      despacho,
      lineas,
      totales,
      fecha_emision,
      problemas,
      listo: problemas.length === 0,
      huella,
      emision_activa: this.facturacion.emisionActiva,
    };
  }

  /* Emite la guía (o la simula con `simular: true`). */
  async emitir(usuario: { id: string; email: string }, body: { traslado_id?: number; huella?: string; simular?: boolean }) {
    const b = await this.preparar(Number(body?.traslado_id));
    if (b.problemas.length) throw new BadRequestException(`No se puede emitir: ${b.problemas.join(' ')}`);
    if (!body?.huella || body.huella !== b.huella) {
      throw new ConflictException('El traslado cambió desde que revisaste el borrador. Vuelve a abrirlo.');
    }
    const real = this.facturacion.emisionActiva && body?.simular !== true;
    const emision = fechaAEpoch(b.fecha_emision);
    const clave = `AMS-T-${b.traslado.id}`;
    const { data: previas } = await this.supabase.getClient().from('bsale_emisiones').select('id').eq('clave', clave).eq('estado', 'emitida');
    const salesId = `${clave}-${(previas || []).length}`;

    const solicitud: Record<string, any> = {
      documentTypeId: b.tipo_documento_id,
      emissionDate: emision,
      expirationDate: emision,
      declareSii: 1,
      shippingTypeId: b.despacho.tipo_traslado_id,
      officeId: b.origen.bsale_office_id,
      destinationOfficeId: b.destino.bsale_office_id,
      address: b.despacho.direccion,
      municipality: b.despacho.comuna,
      city: b.despacho.ciudad,
      recipient: b.despacho.destinatario,
      clientId: b.cliente!.id,
      details: b.lineas.map((l) => ({ code: l.sku, quantity: l.cantidad, netUnitValue: l.neto_unitario, taxId: `[${IVA_ID}]` })),
      salesId,
    };
    const vista = {
      emisor: EMISOR,
      cliente: { razon_social: b.cliente!.razon_social, rut: b.cliente!.rut, giro: EMISOR.giro, direccion: b.despacho.direccion, comuna: b.despacho.comuna },
      referencias: [],
      tipo: 'Guía de despacho electrónica · traslado interno',
      sii: true,
      descuenta_stock: true,
      stock_texto: `Sale de ${b.origen.nombre} en Bsale; entra a ${b.destino.nombre} al recepcionarla`,
      lineas: b.lineas.map((l) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario, neto: l.neto })),
      totales: b.totales,
      fecha_emision: b.fecha_emision,
      despacho: { ...b.despacho },
      notas: [
        `Traslado #${b.traslado.id} del inventario: ${b.origen.nombre} (sucursal ${b.origen.bsale_office_id} de Bsale) → ${b.destino.nombre} (sucursal ${b.destino.bsale_office_id}).`,
        'Bsale descuenta el stock del origen al emitir; el destino sube cuando la guía se recepciona en Bsale (Stock → recepción del despacho interno). La próxima sincronización lo refleja acá.',
        'Los valores unitarios son el costo neto del catálogo: no es una venta.',
      ],
    };
    if (!real) return { simulacion: true, emision_apagada: body?.simular !== true, solicitud, totales: b.totales, vista };

    this.logger.log(`Emitiendo guía de traslado interno del traslado #${b.traslado.id} (${b.origen.nombre} → ${b.destino.nombre}) por ${usuario.email}`);
    return this.despachos.emitirReal({
      usuario, clave, salesId, tipo: 'guia_traslado', ruta: '/shippings.json', solicitud, vista,
      licitacionId: null, origenDocId: null,
      lineas: b.lineas.map((l) => ({ sku: l.sku, cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      registrar: async (doc: any, _pdf: any, respuesta: any) => {
        await this.inventario.marcarGuiaBsale(b.traslado.id, {
          shippingId: Number(respuesta?.id) || null,
          docId: Number(doc?.id) || null,
          numero: doc?.number != null ? String(doc.number) : null,
          url: doc?.urlPdf || doc?.urlPublicView || null,
          usuario: usuario.email || null,
        });
        return null;
      },
      verificar: async () => [],
    });
  }
}
