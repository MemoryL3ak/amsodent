import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { variantesRutFicha } from '../bsale/bsale-giros';

/* ── Facturas en el portal del cliente (2026-11-09) ──────────────────────────
   Pedido de Ariel: «una sección de facturas: todas las facturas que se emiten
   asociadas a las cotizaciones, con la condición de pago declarada e info
   relevante».

   El servidor entrega las facturas (y boletas) de las cotizaciones del RUT con
   los documentos que hacen su cuenta: notas de crédito y débito, multas, pagos
   y devoluciones, más las órdenes de compra y guías que las respaldan. El
   vencimiento, el saldo y el estado los calcula el portal con
   src/lib/cuentasFacturas.js, la misma lógica de Seguimiento de Pagos: el
   cliente ve las mismas cifras que el equipo.

   Solo se exponen columnas que el cliente puede ver (nada de archivos internos
   ni notas del equipo). El PDF se entrega por URL firmada, validando que la
   factura sea de una cotización de su RUT. Va con el módulo `facturas`. */

const normRut = (v: any) => String(v ?? '').toLowerCase().replace(/[^0-9k]/g, '');

const TIPOS_FACTURA = ['factura', 'factura_boleta'];
// Lo que entra en la cuenta de una factura (ver calcularCuentas) y lo que la respalda.
const TIPOS_CUENTA = [
  ...TIPOS_FACTURA,
  'orden_compra',
  'guia_despacho',
  'nota_credito',
  'nota_debito',
  'multa',
  'comprobante_pago',
  'webpay',
  'efectivo',
  'devolucion',
];
// Documentos cuyo PDF puede descargar el cliente desde la sección.
const TIPOS_CON_PDF = [...TIPOS_FACTURA, 'nota_credito', 'nota_debito'];

const fecha = (v: any) => (v ? String(v).slice(0, 10) : null);
const num = (v: any) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

@Injectable()
export class FacturasPortalService {
  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  /* Cotizaciones del cliente (por todas las formas de escribir su RUT), con
     lo que la cuenta de sus facturas necesita. */
  private async cotizacionesDe(rut: string): Promise<any[]> {
    const variantes = variantesRutFicha(rut);
    if (!variantes.length) return [];
    const filas: any[] = [];
    for (let desde = 0; desde < 10000; desde += 1000) {
      const { data, error } = await this.db
        .from('licitaciones')
        .select('id, id_licitacion, rut_entidad, nombre_entidad, estado, condicion_venta, tipo_cliente, total_con_iva, total_sin_iva, ciclo_cerrado, monto_forzado')
        .in('rut_entidad', variantes)
        .order('id', { ascending: false })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      filas.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return filas.filter((l) => normRut(l.rut_entidad) === rut);
  }

  async listar(rutIn: string) {
    const rut = normRut(rutIn);
    const lics = await this.cotizacionesDe(rut);
    if (!lics.length) return { cotizaciones: [], documentos: [], pedidos: {} };

    const ids = lics.map((l) => Number(l.id));
    const docs: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      for (let desde = 0; desde < 20000; desde += 1000) {
        const { data, error } = await this.db
          .from('licitacion_documentos')
          .select('*')
          .in('licitacion_id', ids.slice(i, i + 200))
          .in('tipo', TIPOS_CUENTA)
          .order('id', { ascending: true })
          .range(desde, desde + 999);
        if (error) throw new BadRequestException(error.message);
        docs.push(...(data || []));
        if ((data || []).length < 1000) break;
      }
    }

    // Solo las cotizaciones que tienen al menos una factura emitida.
    const conFactura = new Set(docs.filter((d) => TIPOS_FACTURA.includes(d.tipo)).map((d) => Number(d.licitacion_id)));
    if (!conFactura.size) return { cotizaciones: [], documentos: [], pedidos: {} };

    // ¿Boleta o factura? «factura_boleta» no lo dice; si se emitió desde la
    // plataforma, el registro de Bsale sí. Sin él queda «Factura o boleta».
    const clase: Record<number, 'boleta' | 'factura'> = {};
    const idsFacturas = docs.filter((d) => d.tipo === 'factura_boleta').map((d) => Number(d.id));
    for (let i = 0; i < idsFacturas.length; i += 300) {
      try {
        const { data } = await this.db
          .from('bsale_emisiones')
          .select('documento_id, tipo')
          .in('documento_id', idsFacturas.slice(i, i + 300))
          .eq('estado', 'emitida');
        for (const e of (data || []) as any[]) if (e.tipo === 'boleta' || e.tipo === 'factura') clase[Number(e.documento_id)] = e.tipo;
      } catch {
        /* sin registro de emisiones */
      }
    }

    // Pedido del portal que originó cada cotización, para enlazarlo.
    const pedidos: Record<number, number> = {};
    try {
      const { data } = await this.db
        .from('stock_solicitudes_cotizacion')
        .select('id, licitacion_id')
        .in('licitacion_id', [...conFactura])
        .order('id', { ascending: true });
      for (const p of (data || []) as any[]) pedidos[Number(p.licitacion_id)] = Number(p.id);
    } catch {
      /* sin pedidos del portal */
    }

    return {
      cotizaciones: lics
        .filter((l) => conFactura.has(Number(l.id)))
        .map((l) => ({
          id: Number(l.id),
          id_licitacion: l.id_licitacion || null,
          nombre_entidad: l.nombre_entidad || null,
          estado: l.estado || null,
          condicion_venta: l.condicion_venta || null,
          tipo_cliente: l.tipo_cliente || null,
          total_con_iva: num(l.total_con_iva),
          total_sin_iva: num(l.total_sin_iva),
          ciclo_cerrado: Boolean(l.ciclo_cerrado),
          monto_forzado: num(l.monto_forzado),
        })),
      documentos: docs
        .filter((d) => conFactura.has(Number(d.licitacion_id)))
        .map((d) => ({
          id: Number(d.id),
          licitacion_id: Number(d.licitacion_id),
          tipo: String(d.tipo),
          // Solo facturas: 'factura' | 'boleta' | null (no se sabe).
          clase: d.tipo === 'factura' ? 'factura' : d.tipo === 'factura_boleta' ? clase[Number(d.id)] || null : null,
          numero: d.numero != null ? String(d.numero).slice(0, 60) : null,
          // Montos como se guardan: facturas, OC, guías y pagos NETOS; notas y multas BRUTAS.
          monto: num(d.monto),
          fecha_factura: fecha(d.fecha_factura),
          fecha_oc: fecha(d.fecha_oc),
          created_at: d.created_at || null,
          pagada: Boolean(d.pagada),
          fecha_pago: fecha(d.fecha_pago),
          forma_pago: d.forma_pago || null,
          deriva_de_id: num(d.deriva_de_id),
          guias_ids: Array.isArray(d.guias_ids) ? d.guias_ids.map(Number) : null,
          comision_pago: num(d.comision_pago),
          cuotas_total: num(d.cuotas_total),
          valor_cuota: num(d.valor_cuota),
          empresa_despacho: d.empresa_despacho || null,
          n_seguimiento: d.n_seguimiento || null,
          factoring_empresa: d.factoring_empresa || null,
          // Solo si viene de Bsale: decide si una nota sin factura se reparte.
          bsale_id: num(d.bsale_id),
          tiene_pdf: TIPOS_CON_PDF.includes(String(d.tipo)) && Boolean((d.bucket && d.storage_path) || d.bsale_url),
        })),
      pedidos,
    };
  }

  /* PDF de una factura o nota: URL firmada del archivo guardado o, si no se
     guardó, el PDF público de Bsale. Solo de cotizaciones del RUT. */
  async pdf(rutIn: string, docId: number) {
    const rut = normRut(rutIn);
    const { data: doc, error } = await this.db
      .from('licitacion_documentos')
      .select('id, licitacion_id, tipo, numero, bucket, storage_path, file_name, bsale_url')
      .eq('id', Number(docId))
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!doc || !TIPOS_CON_PDF.includes(String((doc as any).tipo))) throw new NotFoundException('Ese documento no existe.');
    const { data: lic } = await this.db.from('licitaciones').select('id, rut_entidad').eq('id', (doc as any).licitacion_id).maybeSingle();
    if (!lic || normRut((lic as any).rut_entidad) !== rut) throw new ForbiddenException('Ese documento no es de tu cuenta.');

    const d = doc as any;
    if (d.bucket && d.storage_path) {
      const nombre = d.file_name || `${d.tipo === 'nota_credito' ? 'Nota de crédito' : d.tipo === 'nota_debito' ? 'Nota de débito' : 'Factura'} ${d.numero || d.id}.pdf`;
      const { data: firmada, error: e2 } = await this.db.storage.from(d.bucket).createSignedUrl(String(d.storage_path), 600, { download: nombre });
      if (!e2 && firmada?.signedUrl) return { url: firmada.signedUrl };
    }
    if (d.bsale_url) return { url: String(d.bsale_url) };
    throw new NotFoundException('Este documento no tiene su PDF cargado. Pídeselo a tu ejecutivo.');
  }
}
