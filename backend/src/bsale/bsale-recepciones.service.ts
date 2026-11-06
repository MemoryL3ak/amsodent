import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { InventarioService, Sucursal } from '../inventario/inventario.service';
import { BsaleFacturacionService } from './bsale-facturacion.service';
import { BsaleDespachosService } from './bsale-despachos.service';

/* ============================================================================
   Recepción de stock (la de Bsale) — 2026-11-06
   ----------------------------------------------------------------------------
   Pedido de Ariel: "módulo recepción de Bsale" (antes: «crear módulo
   Recepción, el cual sirve para cargar stock. El stock se carga según Guía,
   Factura, Despacho interno o sin documentos asociados»).

   Es la «Recepción de stock» de Bsale hecha desde la plataforma: se elige la
   sucursal, con qué documento llegó la mercadería (guía, factura, despacho
   interno o sin documento) y las líneas (producto, cantidad, costo neto
   unitario). Bsale es la verdad del stock, así que la recepción se crea ALLÁ
   (POST /v1/stocks/receptions.json) y, cuando Bsale la acepta, las unidades
   se suman al inventario de la sucursal (movimiento «entrada» del libro, con
   el costo): la próxima sincronización no encuentra diferencias.

   Dos pasos, como el resto de las escrituras en Bsale: SIMULAR (vista previa:
   lo que se enviaría y cómo queda el stock; no escribe nada) y REGISTRAR. Lo
   que se registra es exactamente lo simulado (huella).

   Requisitos para registrar: la sucursal debe estar asociada a una de Bsale
   (bsale_office_id) y cada producto debe existir en Bsale (por su variante
   enlazada o, si no, buscándolo por SKU).

   Si Bsale rechaza la recepción no se toca el inventario. Si Bsale la acepta
   pero algún movimiento local falla, la recepción queda registrada con el
   aviso: la sincronización de stock trae la diferencia.

   NUNCA se ha registrado una recepción real desde acá: la primera debe
   supervisarse en Bsale (Inventario → Recepciones).
   Tablas: recepciones_stock y recepcion_stock_lineas (migración
   20261106_recepciones_stock). Para recibir un traslado ENTRE sucursales
   propias sigue estando Inventario → Traslados.
============================================================================ */

const MIGRACION = 'Falta aplicar la migración 20261106_recepciones_stock.sql en Supabase.';
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINEAS = 200;

/* Tipos de documento: lo que se guarda → cómo lo llama Bsale en la recepción.
   `document` es texto libre en Bsale; las recepciones hechas en su pantalla
   sin documento quedan como «Sin Documento» (visto en la cuenta, 2026-11-06). */
export const TIPOS_DOCUMENTO: { clave: string; nombre: string; bsale: string; conNumero: boolean }[] = [
  { clave: 'guia', nombre: 'Guía de despacho', bsale: 'Guía', conNumero: true },
  { clave: 'factura', nombre: 'Factura', bsale: 'Factura', conNumero: true },
  { clave: 'despacho_interno', nombre: 'Despacho interno', bsale: 'Despacho Interno', conNumero: true },
  { clave: 'sin_documento', nombre: 'Sin documento', bsale: 'Sin Documento', conNumero: false },
];

const texto = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numero = (v: any) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const redondo = (n: number) => Math.round(n * 100) / 100;

type LineaLista = {
  producto_id: number;
  sku: string;
  nombre: string;
  cantidad: number;
  costo_unitario: number;
  costo_catalogo: number;
  stock_total: number;
  stock_sucursal: number;
  variante_id: number | null;
};

@Injectable()
export class BsaleRecepcionesService {
  private readonly logger = new Logger(BsaleRecepcionesService.name);

  constructor(
    private supabase: SupabaseService,
    private inventario: InventarioService,
    private facturacion: BsaleFacturacionService,
    private despachos: BsaleDespachosService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    return /(schema cache|does not exist|not find|PGRST205|42P01)/i.test(`${error?.code} ${error?.message}`);
  }

  /* Lo que la pantalla necesita para armar una recepción. */
  async contexto() {
    const { error } = await this.db.from('recepciones_stock').select('id').limit(1);
    const listo = !error;
    if (error && !this.sinTabla(error)) throw new BadRequestException(error.message);
    const conSucursales = await this.inventario.sucursalesListo();
    const sucursales = conSucursales ? (await this.inventario.listarSucursales()).filter((s) => s.activa) : [];
    const { data: provs } = await this.db.from('proveedores').select('id, razon_social, rut').order('razon_social', { ascending: true }).range(0, 1999);
    return {
      listo,
      mensaje: listo ? null : MIGRACION,
      tipos: TIPOS_DOCUMENTO.map(({ clave, nombre, conNumero }) => ({ clave, nombre, con_numero: conNumero })),
      sucursales: sucursales.map((s) => ({ id: s.id, nombre: s.nombre, es_principal: s.es_principal, bsale_office_id: s.bsale_office_id })),
      proveedores: ((provs || []) as any[]).map((p) => ({ id: Number(p.id), razon_social: String(p.razon_social || ''), rut: String(p.rut || '') })),
      bsale_configurado: !!this.facturacion.configurado,
      emision_activa: this.facturacion.emisionActiva,
    };
  }

  /* Productos del catálogo por SKU o nombre, para agregar líneas. */
  async buscarProductos(q: string) {
    const t = texto(q, 80);
    if (t.length < 2) return [];
    // Los caracteres que PostgREST usa como separadores pasan a comodín.
    const patron = `*${t.replace(/[,()"\\*%]/g, '_').replace(/\s+/g, '*')}*`;
    const { data, error } = await this.db
      .from('productos')
      .select('id, sku, nombre, marca, costo, stock, bsale_variant_id')
      .or(`sku.ilike.${patron},nombre.ilike.${patron}`)
      .not('sku', 'is', null)
      .order('nombre', { ascending: true })
      .limit(25);
    if (error) throw new BadRequestException(error.message);
    return ((data || []) as any[])
      .filter((p) => String(p.sku || '').trim())
      .map((p) => ({ id: Number(p.id), sku: String(p.sku).trim(), nombre: String(p.nombre || ''), marca: String(p.marca || ''), costo: Number(p.costo) || 0, stock: Number(p.stock) || 0, en_bsale: !!p.bsale_variant_id }));
  }

  /* Valida la recepción y arma lo que se enviaría a Bsale. No escribe. */
  private async preparar(body: any) {
    const problemas: string[] = [];
    const tipo = TIPOS_DOCUMENTO.find((t) => t.clave === String(body?.tipo_documento || '')) || null;
    if (!tipo) throw new BadRequestException('Elige el tipo de documento: guía, factura, despacho interno o sin documento.');
    const documentoNumero = tipo.conNumero ? texto(body?.documento_numero, 40) : '';
    if (tipo.conNumero && !documentoNumero) problemas.push(`Escribe el número de la ${tipo.nombre.toLowerCase()}.`);
    const documentoFecha = RE_FECHA.test(String(body?.documento_fecha || '')) ? String(body.documento_fecha) : null;

    let sucursal: Sucursal | null = null;
    if (await this.inventario.sucursalesListo()) {
      sucursal = Number(body?.sucursal_id) > 0 ? await this.inventario.sucursalPorId(Number(body.sucursal_id)) : await this.inventario.principal();
      if (!sucursal) problemas.push('No hay ninguna sucursal definida en el Inventario.');
      else if (!sucursal.activa) problemas.push(`La sucursal «${sucursal.nombre}» está inactiva.`);
      else if (!sucursal.bsale_office_id) problemas.push(`La sucursal «${sucursal.nombre}» no está asociada a una sucursal de Bsale (Inventario → Sucursales → editar).`);
    } else {
      problemas.push('El Inventario todavía no tiene sucursales (migración 20261102): la recepción necesita saber a qué sucursal de Bsale entra el stock.');
    }
    if (!this.facturacion.configurado) problemas.push('La integración con Bsale no está configurada (falta el token).');

    // Proveedor (opcional): solo para dejar constancia.
    let proveedor: { id: number; razon_social: string } | null = null;
    if (Number(body?.proveedor_id) > 0) {
      const { data } = await this.db.from('proveedores').select('id, razon_social').eq('id', Number(body.proveedor_id)).maybeSingle();
      if (data) proveedor = { id: Number(data.id), razon_social: String(data.razon_social || '') };
    }

    // Líneas: un producto por línea (las repetidas se suman), cantidad > 0 y costo ≥ 0.
    const crudas: any[] = Array.isArray(body?.lineas) ? body.lineas : [];
    if (!crudas.length) throw new BadRequestException('Agrega al menos un producto a la recepción.');
    if (crudas.length > MAX_LINEAS) throw new BadRequestException(`Una recepción admite hasta ${MAX_LINEAS} líneas: sepárala en dos.`);
    const pedidas = new Map<number, { cantidad: number; costo: number | null }>();
    for (const l of crudas) {
      const id = Number(l?.producto_id);
      const cantidad = numero(l?.cantidad);
      if (!(id > 0)) { problemas.push('Hay una línea sin producto.'); continue; }
      if (!(cantidad > 0)) { problemas.push('Hay una línea con cantidad 0 o inválida.'); continue; }
      const costoCrudo = l?.costo_unitario === '' || l?.costo_unitario == null ? null : numero(l.costo_unitario);
      if (costoCrudo != null && !(costoCrudo >= 0)) { problemas.push('Hay una línea con costo inválido.'); continue; }
      const previa = pedidas.get(id);
      pedidas.set(id, { cantidad: redondo((previa?.cantidad || 0) + cantidad), costo: costoCrudo ?? previa?.costo ?? null });
    }
    const ids = [...pedidas.keys()];
    const productos = new Map<number, any>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.db.from('productos').select('id, sku, nombre, costo, stock, bsale_variant_id').in('id', ids.slice(i, i + 200));
      if (error) throw new BadRequestException(error.message);
      for (const p of (data || []) as any[]) productos.set(Number(p.id), p);
    }
    const enSucursal = new Map<number, number>();
    if (sucursal) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await this.db.from('inventario_stock_sucursales').select('producto_id, stock').eq('sucursal_id', sucursal.id).in('producto_id', ids.slice(i, i + 200));
        for (const f of (data || []) as any[]) enSucursal.set(Number(f.producto_id), Number(f.stock) || 0);
      }
    }

    const lineas: LineaLista[] = [];
    for (const [id, pedido] of pedidas) {
      const p = productos.get(id);
      if (!p) { problemas.push(`El producto ${id} ya no existe en el catálogo.`); continue; }
      const sku = String(p.sku || '').trim();
      if (!sku) { problemas.push(`«${p.nombre}» no tiene SKU: no se puede recibir en Bsale.`); continue; }
      let varianteId: number | null = Number(p.bsale_variant_id) > 0 ? Number(p.bsale_variant_id) : null;
      if (!varianteId && this.facturacion.configurado) {
        try {
          const v = await this.despachos.variantePorSku(sku);
          varianteId = v ? Number(v.id) : null;
        } catch (e: any) {
          problemas.push(`No se pudo consultar el SKU ${sku} en Bsale: ${String(e?.message || e).slice(0, 120)}`);
        }
        if (!varianteId) problemas.push(`El SKU ${sku} («${p.nombre}») no está en Bsale: créalo allá o guarda el producto en el catálogo para que se enlace.`);
      }
      const costoCatalogo = Number(p.costo) || 0;
      lineas.push({
        producto_id: id,
        sku,
        nombre: String(p.nombre || ''),
        cantidad: pedido.cantidad,
        costo_unitario: redondo(pedido.costo ?? costoCatalogo),
        costo_catalogo: costoCatalogo,
        stock_total: Number(p.stock) || 0,
        stock_sucursal: sucursal ? enSucursal.get(id) || 0 : Number(p.stock) || 0,
        variante_id: varianteId,
      });
    }

    const nota = texto(body?.nota, 300);
    const totales = {
      lineas: lineas.length,
      unidades: redondo(lineas.reduce((a, l) => a + l.cantidad, 0)),
      costo: Math.round(lineas.reduce((a, l) => a + l.cantidad * l.costo_unitario, 0)),
    };
    // Lo que recibe Bsale. El número va siempre: «Sin documento» lleva «0».
    const solicitud = {
      document: tipo.bsale,
      officeId: sucursal?.bsale_office_id != null ? String(sucursal.bsale_office_id) : null,
      documentNumber: documentoNumero || '0',
      note: [nota, proveedor ? `Proveedor: ${proveedor.razon_social}` : '', documentoFecha ? `Fecha del documento: ${documentoFecha.split('-').reverse().join('-')}` : ''].filter(Boolean).join(' · ').slice(0, 250) || 'Recepción registrada desde la plataforma Amsodent',
      details: lineas.map((l) => ({ quantity: l.cantidad, variantId: l.variante_id, cost: l.costo_unitario })),
    };
    const huella = createHash('sha1').update(JSON.stringify({ solicitud, lineas: lineas.map((l) => [l.producto_id, l.cantidad, l.costo_unitario]) })).digest('hex');
    return { tipo, documentoNumero, documentoFecha, sucursal, proveedor, nota, lineas, totales, solicitud, huella, problemas: [...new Set(problemas)] };
  }

  /* Vista previa: lo que se enviaría a Bsale y cómo queda el stock. No escribe nada. */
  async simular(body: any) {
    const b = await this.preparar(body);
    let repetida: { id: number; fecha: string } | null = null;
    if (b.documentoNumero) {
      const { data } = await this.db.from('recepciones_stock').select('id, created_at').eq('estado', 'registrada').eq('tipo_documento', b.tipo.clave).eq('documento_numero', b.documentoNumero).order('id', { ascending: false }).limit(1);
      const r = ((data || []) as any[])[0];
      if (r) repetida = { id: Number(r.id), fecha: r.created_at };
    }
    return {
      simulacion: true,
      huella: b.huella,
      problemas: b.problemas,
      avisos: [
        ...(repetida ? [`Ya hay una recepción registrada con ${b.tipo.nombre.toLowerCase()} N° ${b.documentoNumero} (recepción #${repetida.id}): revisa que no sea la misma mercadería.`] : []),
        ...(!this.facturacion.emisionActiva ? ['Las escrituras en Bsale están apagadas en este servidor (BSALE_EMISION=off): solo se puede simular.'] : []),
        ...b.lineas.filter((l) => l.costo_unitario <= 0).map((l) => `«${l.nombre}» entra con costo $0.`),
      ],
      documento: { tipo: b.tipo.clave, nombre: b.tipo.nombre, numero: b.documentoNumero || null, fecha: b.documentoFecha },
      sucursal: b.sucursal ? { id: b.sucursal.id, nombre: b.sucursal.nombre, bsale_office_id: b.sucursal.bsale_office_id } : null,
      proveedor: b.proveedor,
      totales: b.totales,
      lineas: b.lineas.map((l) => ({
        producto_id: l.producto_id, sku: l.sku, nombre: l.nombre, cantidad: l.cantidad, costo_unitario: l.costo_unitario, costo_catalogo: l.costo_catalogo,
        subtotal: Math.round(l.cantidad * l.costo_unitario), stock_antes: l.stock_sucursal, stock_despues: redondo(l.stock_sucursal + l.cantidad), en_bsale: !!l.variante_id,
      })),
      solicitud: b.solicitud,
    };
  }

  /* Registra la recepción: primero en Bsale y, si la acepta, en el inventario. */
  async registrar(body: any, email: string) {
    const b = await this.preparar(body);
    if (b.problemas.length) throw new BadRequestException(b.problemas.join(' '));
    if (String(body?.huella || '') !== b.huella) throw new ConflictException('La recepción cambió desde la simulación (o cambió el catálogo): vuelve a simular antes de registrar.');
    if (!this.facturacion.emisionActiva) throw new BadRequestException('Las escrituras en Bsale están apagadas en este servidor (BSALE_EMISION=off): solo se puede simular.');
    const sucursal = b.sucursal as Sucursal;

    // 1. Cabecera y líneas «en proceso»: si algo se corta a medio camino, queda el rastro.
    const { data: cab, error: eCab } = await this.db
      .from('recepciones_stock')
      .insert({
        sucursal_id: sucursal.id, sucursal_nombre: sucursal.nombre, bsale_office_id: sucursal.bsale_office_id, tipo_documento: b.tipo.clave,
        documento_numero: b.documentoNumero || null, documento_fecha: b.documentoFecha, proveedor_id: b.proveedor?.id ?? null, proveedor_nombre: b.proveedor?.razon_social ?? null,
        nota: b.nota || null, total_lineas: b.totales.lineas, total_unidades: b.totales.unidades, total_costo: b.totales.costo, estado: 'en_proceso', usuario_email: email || null,
      })
      .select('*')
      .single();
    if (eCab) throw new BadRequestException(this.sinTabla(eCab) ? MIGRACION : eCab.message);
    const recepcionId = Number(cab.id);
    const { error: eLin } = await this.db.from('recepcion_stock_lineas').insert(
      b.lineas.map((l) => ({ recepcion_id: recepcionId, producto_id: l.producto_id, sku: l.sku, nombre: l.nombre, cantidad: l.cantidad, costo_unitario: l.costo_unitario, bsale_variant_id: l.variante_id })),
    );
    if (eLin) {
      await this.db.from('recepciones_stock').delete().eq('id', recepcionId);
      throw new BadRequestException(this.sinTabla(eLin) ? MIGRACION : eLin.message);
    }

    // 2. Bsale. Un rechazo (4xx) deja la recepción «fallida» y no toca el inventario.
    let respuesta: any;
    try {
      respuesta = await this.facturacion.apiPost('/stocks/receptions.json', b.solicitud);
    } catch (e: any) {
      const motivo = String(e?.message || e).slice(0, 400);
      await this.db.from('recepciones_stock').update({ estado: 'fallida', error: motivo }).eq('id', recepcionId);
      this.logger.warn(`Recepción ${recepcionId}: Bsale no la registró: ${motivo}`);
      throw new BadRequestException(
        e?.incierta
          ? `Bsale no respondió al registrar la recepción (${motivo}). Antes de reintentar revisa en Bsale → Inventario → Recepciones si quedó creada: el inventario del sistema no se tocó.`
          : `Bsale rechazó la recepción: ${motivo}. El inventario no se tocó.`,
      );
    }
    const bsaleId = Number(respuesta?.id) || null;

    // 3. Inventario: una entrada por línea, en la sucursal, con su costo.
    const etiqueta = b.documentoNumero ? `${b.tipo.nombre} N° ${b.documentoNumero}` : b.tipo.nombre;
    const avisos: string[] = [];
    for (const l of b.lineas) {
      try {
        await this.inventario.registrarMovimiento(
          {
            productoId: l.producto_id, tipo: 'entrada', cantidad: l.cantidad, costoUnitario: l.costo_unitario, sucursalId: sucursal.id,
            motivo: `Recepción de stock${b.proveedor ? ` · ${b.proveedor.razon_social}` : ''}`,
            referencia: `Recepción #${recepcionId} · ${etiqueta}${bsaleId ? ` · Bsale ${bsaleId}` : ''}`,
          },
          email,
        );
      } catch (e: any) {
        avisos.push(`«${l.nombre}» (${l.sku}) quedó recibido en Bsale pero no se pudo sumar al inventario del sistema: ${String(e?.message || e).slice(0, 160)}. La sincronización de stock lo corrige.`);
      }
    }
    const { data: final } = await this.db
      .from('recepciones_stock')
      .update({ estado: 'registrada', bsale_reception_id: bsaleId, error: avisos.length ? avisos.join(' ').slice(0, 900) : null })
      .eq('id', recepcionId)
      .select('*')
      .single();
    this.logger.log(`Recepción ${recepcionId} registrada por ${email}: ${etiqueta}, ${b.totales.lineas} línea(s), ${b.totales.unidades} unidades, Bsale ${bsaleId ?? 's/id'}`);
    return { ok: true, recepcion: this.vista(final || cab, b.lineas), bsale_reception_id: bsaleId, avisos };
  }

  private vista(r: any, lineas: any[] = []) {
    return {
      id: Number(r.id),
      estado: r.estado,
      sucursal_id: r.sucursal_id == null ? null : Number(r.sucursal_id),
      sucursal: r.sucursal_nombre || '',
      tipo_documento: r.tipo_documento,
      tipo_nombre: TIPOS_DOCUMENTO.find((t) => t.clave === r.tipo_documento)?.nombre || r.tipo_documento,
      documento_numero: r.documento_numero || null,
      documento_fecha: r.documento_fecha ? String(r.documento_fecha).slice(0, 10) : null,
      proveedor: r.proveedor_nombre || '',
      nota: r.nota || '',
      total_lineas: Number(r.total_lineas) || 0,
      total_unidades: Number(r.total_unidades) || 0,
      total_costo: Number(r.total_costo) || 0,
      bsale_reception_id: r.bsale_reception_id == null ? null : Number(r.bsale_reception_id),
      error: r.error || null,
      usuario_email: r.usuario_email || '',
      created_at: r.created_at,
      lineas: lineas.map((l) => ({
        producto_id: Number(l.producto_id), sku: l.sku || '', nombre: l.nombre || '', cantidad: Number(l.cantidad) || 0, costo_unitario: Number(l.costo_unitario) || 0,
        subtotal: Math.round((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)),
      })),
    };
  }

  /* Recepciones (registradas y fallidas), de la más nueva a la más antigua, con sus líneas. */
  async listar(limite = 300) {
    const { data, error } = await this.db
      .from('recepciones_stock')
      .select('*')
      .neq('estado', 'en_proceso')
      .order('id', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limite) || 300, 1000)));
    if (error) {
      if (this.sinTabla(error)) return { listo: false, mensaje: MIGRACION, recepciones: [] };
      throw new BadRequestException(error.message);
    }
    const filas = (data || []) as any[];
    const ids = filas.map((r) => Number(r.id));
    const porRecepcion = new Map<number, any[]>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data: lin, error: e2 } = await this.db.from('recepcion_stock_lineas').select('recepcion_id, producto_id, sku, nombre, cantidad, costo_unitario').in('recepcion_id', ids.slice(i, i + 150)).order('id', { ascending: true }).range(0, 9999);
      if (e2) throw new BadRequestException(e2.message);
      for (const l of (lin || []) as any[]) porRecepcion.set(Number(l.recepcion_id), [...(porRecepcion.get(Number(l.recepcion_id)) || []), l]);
    }
    return { listo: true, recepciones: filas.map((r) => this.vista(r, porRecepcion.get(Number(r.id)) || [])) };
  }

  async porId(id: number) {
    const { data, error } = await this.db.from('recepciones_stock').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(this.sinTabla(error) ? MIGRACION : error.message);
    if (!data) throw new NotFoundException('Esa recepción no existe.');
    const { data: lin } = await this.db.from('recepcion_stock_lineas').select('producto_id, sku, nombre, cantidad, costo_unitario').eq('recepcion_id', id).order('id', { ascending: true });
    return this.vista(data, (lin || []) as any[]);
  }
}
