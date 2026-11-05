import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { variantesRutFicha } from '../bsale/bsale-giros';
import { InventarioPortalService } from './inventario-portal.service';

/* ── Recepción de mercadería en el portal del cliente (2026-11-05) ───────────
   Pedido de Ariel: "Crear módulo «Recepción», el cual sirve para cargar stock.
   El stock se carga según Guía, Factura o Despacho Interno o sin documentos
   asociados".

   Hasta ahora el stock del cliente entraba producto por producto desde
   Inventario («Ingresar stock»). La Recepción es el mismo ingreso, pero
   partiendo de lo que llegó:
     · Guía de despacho, Factura o Despacho interno que Amsodent le emitió al
       cliente: se elige el documento y sus líneas (producto, cantidad y precio
       neto) llegan precargadas; el cliente confirma cuánto recibió.
     · Sin documento asociado: se arma la lista a mano (compras a otros
       proveedores, muestras, ajustes de entrada).
   Cada línea recibida es un LOTE del Inventario (InventarioPortalService.
   ingresar): entra con su costo, sube el stock y recalcula el precio unitario
   promedio. La recepción queda guardada con su documento, sus líneas, quién
   la hizo y cuándo; un documento ya recibido se marca para no cargarlo dos
   veces por descuido (se puede, si llegó en parcialidades).

   De dónde salen las líneas de un documento:
     1. Si Amsodent lo emitió en Bsale desde la plataforma, de lo que se envió
        a Bsale (bsale_emisiones.lineas, o los detalles de la solicitud).
     2. Si no (documento cargado a mano como PDF), de los ítems de su
        cotización.
   «Despacho interno» no es un tipo de documento: es la guía (o información de
   despacho) cuyo transportista es «Despacho interno» (reparto propio).

   Tablas: stock_recepciones_cliente y stock_recepcion_lineas_cliente
   (migración 20261105_portal_recepciones). Requiere el Inventario por lotes
   (20261019). Va con la sección Gestión de Stock (módulo `declaracion`). */

export type TipoDocumento = 'guia' | 'factura' | 'despacho_interno' | 'sin_documento';
export const TIPOS_DOCUMENTO: { clave: TipoDocumento; nombre: string }[] = [
  { clave: 'guia', nombre: 'Guía de despacho' },
  { clave: 'factura', nombre: 'Factura' },
  { clave: 'despacho_interno', nombre: 'Despacho interno' },
  { clave: 'sin_documento', nombre: 'Sin documento asociado' },
];
const CLAVES = TIPOS_DOCUMENTO.map((t) => t.clave);
const MIGRACION = 'La Recepción aún no está activa: falta aplicar la migración 20261105_portal_recepciones en Supabase.';
const MAX_LINEAS = 300;

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const texto = (v: any, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normSku = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const normRut = (v: any) => String(v ?? '').toLowerCase().replace(/[^0-9k]/g, '');
const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const esDespachoInterno = (doc: any) => /despacho\s*interno/i.test(String(doc?.empresa_despacho || ''));

/* Tipo de recepción de un documento de la cotización (null = no es recepcionable). */
export function tipoDeDocumento(doc: any): TipoDocumento | null {
  const tipo = String(doc?.tipo || '');
  if (tipo === 'factura' || tipo === 'factura_boleta') return 'factura';
  if (tipo === 'guia_despacho' || tipo === 'info_despacho') return esDespachoInterno(doc) ? 'despacho_interno' : 'guia';
  return null;
}

export function etiquetaDocumento(tipo: TipoDocumento, numero: any): string {
  const nombre = TIPOS_DOCUMENTO.find((t) => t.clave === tipo)?.nombre || 'Documento';
  const n = texto(numero, 60);
  return tipo === 'sin_documento' ? nombre : `${nombre}${n ? ` N° ${n}` : ''}`;
}

@Injectable()
export class RecepcionPortalService {
  private readonly logger = new Logger(RecepcionPortalService.name);
  private cacheListo: { ts: number; ok: boolean } | null = null;

  constructor(
    private supabase: SupabaseService,
    private inventario: InventarioPortalService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  /* ¿Están las tablas de Recepción y el Inventario por lotes? (caché: 10 min si sí, 1 min si no). */
  async listo(): Promise<boolean> {
    if (this.cacheListo && Date.now() - this.cacheListo.ts < (this.cacheListo.ok ? 600_000 : 60_000)) return this.cacheListo.ok;
    let ok = await this.inventario.listo();
    if (ok) {
      const { error } = await this.db.from('stock_recepciones_cliente').select('id').limit(1);
      ok = !error;
      if (error && !/(does not exist|schema cache|PGRST205|42P01)/i.test(`${error.code} ${error.message}`)) this.logger.warn(`Recepción: ${error.message}`);
    }
    this.cacheListo = { ts: Date.now(), ok };
    return ok;
  }

  private async exigirListo() {
    if (!(await this.listo())) throw new BadRequestException(MIGRACION);
  }

  /* Cotizaciones del cliente (por todas las formas de escribir su RUT). */
  private async licitacionesDe(rut: string): Promise<any[]> {
    const variantes = variantesRutFicha(rut);
    if (!variantes.length) return [];
    const filas: any[] = [];
    for (let desde = 0; desde < 5000; desde += 1000) {
      const { data, error } = await this.db
        .from('licitaciones')
        .select('id, id_licitacion, rut_entidad, nombre, fecha, estado')
        .in('rut_entidad', variantes)
        .order('id', { ascending: false })
        .range(desde, desde + 999);
      if (error) throw new BadRequestException(error.message);
      filas.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    return filas.filter((l) => normRut(l.rut_entidad) === rut);
  }

  /* Documentos de Amsodent que el cliente puede recepcionar: guías, facturas
     y despachos internos de sus cotizaciones, del más nuevo al más antiguo,
     con la marca de si ya los recibió. */
  async documentos(rutIn: string, tipoIn?: string) {
    await this.exigirListo();
    const rut = normRut(rutIn);
    const filtro = CLAVES.includes(tipoIn as TipoDocumento) && tipoIn !== 'sin_documento' ? (tipoIn as TipoDocumento) : null;
    const lics = await this.licitacionesDe(rut);
    if (!lics.length) return { documentos: [] };
    const porLic = new Map<number, any>(lics.map((l) => [Number(l.id), l]));
    const ids = [...porLic.keys()];
    const docs: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.db
        .from('licitacion_documentos')
        .select('id, licitacion_id, tipo, numero, fecha_oc, fecha_factura, monto, empresa_despacho, n_seguimiento, created_at')
        .in('licitacion_id', ids.slice(i, i + 200))
        .in('tipo', ['guia_despacho', 'info_despacho', 'factura', 'factura_boleta'])
        .order('id', { ascending: false })
        .range(0, 999);
      if (error) throw new BadRequestException(error.message);
      docs.push(...(data || []));
    }
    // Lo que ya se recibió (por documento).
    const { data: previas } = await this.db
      .from('stock_recepciones_cliente')
      .select('id, documento_id, fecha, total_unidades')
      .eq('rut', rut)
      .not('documento_id', 'is', null)
      .order('id', { ascending: true })
      .range(0, 4999);
    const recibido = new Map<number, { recepciones: number; ultima: string; unidades: number }>();
    for (const r of (previas || []) as any[]) {
      const k = Number(r.documento_id);
      const p = recibido.get(k) || { recepciones: 0, ultima: '', unidades: 0 };
      recibido.set(k, { recepciones: p.recepciones + 1, ultima: String(r.fecha || '').slice(0, 10), unidades: r2(p.unidades + (Number(r.total_unidades) || 0)) });
    }
    const lista = docs
      .map((d) => {
        const tipo = tipoDeDocumento(d);
        if (!tipo) return null;
        const lic = porLic.get(Number(d.licitacion_id)) || {};
        return {
          id: Number(d.id),
          tipo,
          numero: tipo === 'despacho_interno' ? texto(d.n_seguimiento || d.numero, 60) : texto(d.numero, 60),
          fecha: String(d.fecha_factura || d.fecha_oc || d.created_at || '').slice(0, 10) || null,
          monto_neto: Number(d.monto) || null,
          licitacion_id: Number(d.licitacion_id),
          cotizacion: lic.id_licitacion || String(lic.id || ''),
          cotizacion_nombre: lic.nombre || null,
          recibido: recibido.get(Number(d.id)) || null,
        };
      })
      .filter((d): d is NonNullable<typeof d> => !!d && (!filtro || d.tipo === filtro))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id)
      .slice(0, 300);
    return { documentos: lista };
  }

  /* El documento, validando que sea de una cotización del cliente. */
  private async documentoDelCliente(rut: string, docId: number) {
    const { data: doc, error } = await this.db
      .from('licitacion_documentos')
      .select('id, licitacion_id, tipo, numero, fecha_oc, fecha_factura, monto, empresa_despacho, n_seguimiento, bsale_id, created_at')
      .eq('id', docId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const tipo = doc ? tipoDeDocumento(doc) : null;
    if (!doc || !tipo) throw new NotFoundException('Ese documento no existe.');
    const { data: lic } = await this.db.from('licitaciones').select('id, id_licitacion, rut_entidad, flete_estimado').eq('id', (doc as any).licitacion_id).maybeSingle();
    if (!lic || normRut((lic as any).rut_entidad) !== rut) throw new ForbiddenException('Ese documento no es de tu cuenta.');
    return { doc: doc as any, tipo, lic: lic as any };
  }

  /* Líneas de un documento, ya calzadas con el inventario del cliente. */
  async lineasDeDocumento(rutIn: string, docId: number, sucursalId: any) {
    await this.exigirListo();
    const rut = normRut(rutIn);
    const { doc, tipo, lic } = await this.documentoDelCliente(rut, docId);

    // Ítems de la cotización: nombres, y respaldo cuando el documento no trae líneas.
    const { data: itemsCot, error: errItems } = await this.db
      .from('items_licitacion')
      .select('id, producto, sku, formato, cantidad, valor_unitario, orden')
      .eq('licitacion_id', doc.licitacion_id)
      .order('orden', { ascending: true })
      .range(0, 999);
    if (errItems) throw new BadRequestException(errItems.message);
    const items = (itemsCot || []) as any[];
    const itemPorSku = new Map(items.filter((i) => normSku(i.sku)).map((i) => [normSku(i.sku), i]));

    // 1. Lo que se envió a Bsale al emitir el documento desde la plataforma.
    let fuente: 'documento' | 'cotizacion' = 'cotizacion';
    let lineas: { sku: string; nombre: string; formato: string; cantidad: number; costo_unitario: number }[] = [];
    const { data: emision } = await this.db
      .from('bsale_emisiones')
      .select('id, lineas, solicitud, estado')
      .eq('documento_id', doc.id)
      .eq('estado', 'emitida')
      .order('id', { ascending: false })
      .limit(1);
    const em = ((emision || []) as any[])[0];
    // Los detalles de la solicitud solo sirven si TODOS traen su código o su
    // glosa: una factura enlazada a la guía (detailId) no dice qué producto es.
    const detalles: any[] = Array.isArray(em?.solicitud?.details) ? em.solicitud.details : [];
    const detallesCompletos = detalles.length > 0 && detalles.every((d: any) => d?.code || d?.comment);
    const crudas: any[] = Array.isArray(em?.lineas) && em.lineas.length
      ? em.lineas.map((l: any) => ({ sku: l.sku, cantidad: l.cantidad, neto: l.neto_unitario, nombre: l.producto }))
      : detallesCompletos
        ? detalles.map((d: any) => ({ sku: d.code, cantidad: d.quantity, neto: d.netUnitValue, nombre: d.comment }))
        : [];
    const utiles = crudas.filter((l) => Number(l.cantidad) > 0 && (normSku(l.sku) || texto(l.nombre)));
    if (utiles.length) {
      fuente = 'documento';
      lineas = utiles.map((l) => {
        const it = itemPorSku.get(normSku(l.sku));
        return {
          sku: normSku(l.sku),
          nombre: texto(it?.producto || l.nombre || l.sku, 200),
          formato: texto(it?.formato, 50),
          cantidad: r2(l.cantidad),
          costo_unitario: Math.round(Number(l.neto) || Number(it?.valor_unitario) || 0),
        };
      });
    } else {
      // 2. Los ítems de la cotización (el flete prorrateado no es costo del producto: se descuenta).
      const unidades = items.reduce((a, i) => a + (Number(i.cantidad) || 0), 0);
      const fletePorUnidad = unidades > 0 ? (Number(lic.flete_estimado) || 0) / unidades : 0;
      lineas = items
        .filter((i) => Number(i.cantidad) > 0 && texto(i.producto))
        .map((i) => ({
          sku: normSku(i.sku),
          nombre: texto(i.producto, 200),
          formato: texto(i.formato, 50),
          cantidad: r2(i.cantidad),
          costo_unitario: Math.max(0, Math.round((Number(i.valor_unitario) || 0) - fletePorUnidad)),
        }));
    }

    // Calce con el inventario del cliente en esa sucursal: por SKU o por nombre.
    const propios = await this.productosDe(rut, sucursalId);
    const porSku = new Map(propios.filter((p) => normSku(p.sku)).map((p) => [normSku(p.sku), p]));
    const porNombre = new Map(propios.map((p) => [norm(p.nombre), p]));
    return {
      documento: {
        id: Number(doc.id),
        tipo,
        numero: tipo === 'despacho_interno' ? texto(doc.n_seguimiento || doc.numero, 60) : texto(doc.numero, 60),
        fecha: String(doc.fecha_factura || doc.fecha_oc || doc.created_at || '').slice(0, 10) || null,
        cotizacion: lic.id_licitacion || String(lic.id),
      },
      fuente,
      lineas: lineas.slice(0, MAX_LINEAS).map((l) => {
        const p = (l.sku && porSku.get(l.sku)) || porNombre.get(norm(l.nombre)) || null;
        return { ...l, producto_id: p ? Number(p.id) : null, producto_nombre: p?.nombre || null, stock_actual: p ? Number(p.stock_actual) || 0 : null };
      }),
    };
  }

  private async productosDe(rut: string, sucursalId: any): Promise<any[]> {
    const suc = Number(sucursalId) || null;
    let q = this.db.from('stock_productos_cliente').select('id, nombre, sku, marca, unidad, stock_actual, sucursal_id').eq('rut', rut).eq('activo', true);
    q = suc ? q.eq('sucursal_id', suc) : q;
    const { data, error } = await q.range(0, 4999);
    if (error) throw new BadRequestException(error.message);
    return (data || []) as any[];
  }

  /* ── Registrar una recepción: cada línea entra al Inventario como un lote ── */
  async crear(payload: any, body: any) {
    await this.exigirListo();
    const rut = normRut(payload?.rut);
    if (!rut) throw new ForbiddenException('Sesión inválida.');
    const tipo = String(body?.tipo_documento || '') as TipoDocumento;
    if (!CLAVES.includes(tipo)) throw new BadRequestException('Indica con qué documento llegó la mercadería (o «Sin documento asociado»).');
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.fecha || '')) ? String(body.fecha) : hoyEnChile();
    if (fecha > hoyEnChile()) throw new BadRequestException('La fecha de la recepción no puede ser futura.');
    const lineasIn: any[] = Array.isArray(body?.lineas) ? body.lineas.slice(0, MAX_LINEAS) : [];
    const lineas = lineasIn.filter((l) => Number(String(l?.cantidad ?? '').replace(',', '.')) > 0);
    if (!lineas.length) throw new BadRequestException('La recepción no tiene productos con cantidad recibida.');

    // Documento: de Amsodent (se valida que sea del cliente) o un número libre.
    let documentoId: number | null = null;
    let numero = texto(body?.documento_numero, 60) || null;
    let documentoFecha: string | null = null;
    let licitacionId: number | null = null;
    if (tipo !== 'sin_documento' && Number(body?.documento_id) > 0) {
      const { doc, tipo: tipoReal } = await this.documentoDelCliente(rut, Number(body.documento_id));
      if (tipoReal !== tipo) throw new BadRequestException('El documento elegido no es del tipo indicado.');
      documentoId = Number(doc.id);
      numero = (tipoReal === 'despacho_interno' ? texto(doc.n_seguimiento || doc.numero, 60) : texto(doc.numero, 60)) || numero;
      documentoFecha = String(doc.fecha_factura || doc.fecha_oc || doc.created_at || '').slice(0, 10) || null;
      licitacionId = Number(doc.licitacion_id) || null;
    } else if (tipo !== 'sin_documento' && !numero) {
      throw new BadRequestException('Elige el documento o escribe su número.');
    }

    const usuarioEmail = payload?.usuario_email || 'cuenta principal';
    const usuarioNombre = payload?.usuario_nombre || null;
    const { data: cab, error: errCab } = await this.db
      .from('stock_recepciones_cliente')
      .insert({
        rut, sucursal_id: Number(body?.sucursal_id) || null, tipo_documento: tipo, documento_id: documentoId, documento_numero: numero,
        documento_fecha: documentoFecha, licitacion_id: licitacionId, fecha, nota: texto(body?.nota, 300) || null,
        usuario_email: usuarioEmail, usuario_nombre: usuarioNombre,
      })
      .select('id')
      .single();
    if (errCab) throw new BadRequestException(`No se pudo registrar la recepción: ${errCab.message}`);
    const recepcionId = Number((cab as any).id);
    const etiqueta = etiquetaDocumento(tipo, numero);

    const guardadas: any[] = [];
    const errores: { linea: number; nombre: string; error: string }[] = [];
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i] || {};
      const nombre = texto(l?.nuevo?.nombre || l?.nombre, 200);
      try {
        const r = await this.inventario.ingresar(
          payload,
          {
            ...(Number(l.producto_id) > 0 ? { producto_id: Number(l.producto_id) } : { nuevo: { nombre, sku: texto(l?.nuevo?.sku ?? l?.sku, 80), marca: texto(l?.nuevo?.marca, 100), unidad: texto(l?.nuevo?.unidad ?? l?.formato, 50) } }),
            sucursal_id: body?.sucursal_id,
            cantidad: l.cantidad,
            costo_unitario: l.costo_unitario,
            fecha,
            nota: `Recepción N° ${recepcionId} · ${etiqueta}`.slice(0, 200),
          },
          { permitirExistente: true },
        );
        const cantidad = r2(Number(String(l.cantidad).replace(',', '.')));
        const costo = Math.round(Number(String(l.costo_unitario ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')) || 0);
        guardadas.push({ recepcion_id: recepcionId, producto_id: r.producto.id, nombre: r.producto.nombre, sku: texto(l?.sku ?? l?.nuevo?.sku, 80) || null, cantidad, costo_unitario: costo, producto_creado: !!r.creado });
      } catch (e: any) {
        errores.push({ linea: i + 1, nombre, error: String(e?.message || e).slice(0, 200) });
      }
    }

    if (!guardadas.length) {
      // Ninguna línea entró: la recepción no existe.
      await this.db.from('stock_recepciones_cliente').delete().eq('id', recepcionId);
      throw new BadRequestException(`No se pudo ingresar ningún producto: ${errores.slice(0, 3).map((e) => `${e.nombre || `línea ${e.linea}`}: ${e.error}`).join(' · ')}`);
    }
    const { error: errLineas } = await this.db.from('stock_recepcion_lineas_cliente').insert(guardadas);
    if (errLineas) this.logger.warn(`Recepción ${recepcionId}: el stock entró pero no se guardó el detalle: ${errLineas.message}`);
    const unidades = r2(guardadas.reduce((a, l) => a + l.cantidad, 0));
    const valor = Math.round(guardadas.reduce((a, l) => a + l.cantidad * l.costo_unitario, 0));
    await this.db.from('stock_recepciones_cliente').update({ total_lineas: guardadas.length, total_unidades: unidades, total_valor: valor }).eq('id', recepcionId);

    return { ok: true, id: recepcionId, documento: etiqueta, lineas: guardadas.length, unidades, valor, creados: guardadas.filter((l) => l.producto_creado).length, errores };
  }

  /* ── Historial de recepciones de la sucursal, con su detalle ── */
  async listar(rutIn: string, sucursalId: any) {
    if (!(await this.listo())) return { listo: false, mensaje: MIGRACION, tipos: TIPOS_DOCUMENTO, recepciones: [] };
    const rut = normRut(rutIn);
    const suc = Number(sucursalId) || null;
    let q = this.db
      .from('stock_recepciones_cliente')
      .select('id, sucursal_id, tipo_documento, documento_id, documento_numero, documento_fecha, licitacion_id, fecha, nota, usuario_email, usuario_nombre, total_lineas, total_unidades, total_valor, created_at')
      .eq('rut', rut);
    if (suc) q = q.eq('sucursal_id', suc);
    const { data, error } = await q.order('id', { ascending: false }).limit(300);
    if (error) throw new BadRequestException(error.message);
    const recepciones = (data || []) as any[];
    const ids = recepciones.map((r) => Number(r.id));
    const lineas: any[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data: ls } = await this.db
        .from('stock_recepcion_lineas_cliente')
        .select('id, recepcion_id, producto_id, nombre, sku, cantidad, costo_unitario, producto_creado')
        .in('recepcion_id', ids.slice(i, i + 150))
        .order('id', { ascending: true })
        .range(0, 9999);
      lineas.push(...(ls || []));
    }
    return {
      listo: true,
      tipos: TIPOS_DOCUMENTO,
      recepciones: recepciones.map((r) => ({
        id: Number(r.id),
        tipo_documento: r.tipo_documento,
        documento: etiquetaDocumento(r.tipo_documento, r.documento_numero),
        documento_id: r.documento_id ? Number(r.documento_id) : null,
        documento_fecha: r.documento_fecha || null,
        fecha: String(r.fecha || '').slice(0, 10),
        nota: r.nota || '',
        usuario: r.usuario_nombre || r.usuario_email || '',
        total_lineas: Number(r.total_lineas) || 0,
        total_unidades: Number(r.total_unidades) || 0,
        total_valor: Number(r.total_valor) || 0,
        lineas: lineas
          .filter((l) => Number(l.recepcion_id) === Number(r.id))
          .map((l) => ({ id: Number(l.id), nombre: l.nombre, sku: l.sku || '', cantidad: Number(l.cantidad) || 0, costo_unitario: Number(l.costo_unitario) || 0, producto_creado: !!l.producto_creado })),
      })),
    };
  }
}
