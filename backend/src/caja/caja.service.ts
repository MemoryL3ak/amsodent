import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { cajaUsuario } from '../auth/permisos';

/* ============================================================================
   Apertura y cierre de caja (2026-11-05)
   ----------------------------------------------------------------------------
   Pedido de Ariel: "Módulo apertura y cierre de caja (asociar solamente lo que
   corresponde al usuario ventas@amsodentmedical.cl)".

   La caja es la de la sala de ventas. Un TURNO se abre declarando el fondo en
   efectivo y se cierra con el arqueo: se cuenta el efectivo y el sistema dice
   cuánto debía haber. Mientras está abierto, al turno se le asocian SOLO las
   ventas directas (boletas y facturas de «Venta directa») que emitió el
   usuario de la tienda — CAJA_USUARIO, por defecto ventas@amsodentmedical.cl —
   desde la apertura. Las ventas de los demás usuarios nunca entran a la caja.

     efectivo esperado = fondo inicial
                       + ventas del turno cobradas en efectivo
                       + ingresos de efectivo registrados a mano
                       − egresos de efectivo registrados a mano
                         (retiros, gastos menores, devoluciones en efectivo)

   Las ventas con tarjeta, transferencia u otro medio se informan por medio de
   pago (para cuadrar los vouchers) pero no mueven el efectivo; las ventas a
   crédito tampoco. Las notas de crédito que emitió el usuario de la tienda en
   el turno se listan como referencia: si se devolvió efectivo, se registra a
   mano como egreso (el sistema no sabe por dónde salió el dinero).

   De dónde sale cada dato:
   · Qué se vendió y quién: bsale_emisiones (clave AMS-V-%, tipo boleta o
     factura, estado emitida, usuario = el de la tienda, created_at dentro
     del turno).
   · Con qué se pagó: el comprobante de pago que la venta directa deja al
     emitir (licitacion_documentos tipo comprobante_pago, deriva_de_id = la
     boleta/factura), campo forma_pago. Sin comprobante la venta fue a crédito.
   Al cerrar se guarda la foto del turno (totales por medio y arqueo): el
   historial no cambia aunque después se anule una venta.

   Solo puede haber un turno abierto. Lo abren y cierran el usuario de la
   tienda, los administradores y los perfiles con el módulo «caja».
   Tablas: caja_sesiones y caja_movimientos (migración 20261105_caja).
============================================================================ */

const MIGRACION = 'Falta aplicar la migración 20261105_caja.sql en Supabase.';
const MAX_MONTO = 1_000_000_000;

export const MEDIOS: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transbank: 'Transbank',
  getnet: 'Getnet',
  webpay: 'Webpay',
  mercadopago: 'Mercado Pago',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  credito: 'Crédito (no entra a caja)',
  otro: 'Otro medio',
};
const nombreMedio = (m: string) => MEDIOS[m] || m.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export type VentaCaja = {
  id: number;
  tipo: 'boleta' | 'factura';
  numero: string | null;
  hora: string; // ISO
  cliente: string;
  total: number; // bruto
  medio: string;
  medio_nombre: string;
  comprobante: string | null;
  anulada: boolean;
  url_pdf: string | null;
};

const entero = (v: any) => Math.round(Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')) || 0);
const texto = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const medioDe = (v: any) => {
  const m = String(v ?? '').trim().toLowerCase();
  if (!m) return 'otro';
  if (/saldo/.test(m)) return 'otro';
  return m.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'otro';
};

/* Resumen del turno a partir de sus ventas y movimientos (función pura). */
export function resumirTurno(fondo: number, ventas: VentaCaja[], movimientos: { tipo: string; monto: number }[]) {
  const validas = ventas.filter((v) => !v.anulada);
  const porMedio = new Map<string, { medio: string; nombre: string; ventas: number; total: number }>();
  for (const v of validas) {
    const p = porMedio.get(v.medio) || { medio: v.medio, nombre: v.medio_nombre, ventas: 0, total: 0 };
    porMedio.set(v.medio, { ...p, ventas: p.ventas + 1, total: p.total + v.total });
  }
  const ingresos = movimientos.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + (Number(m.monto) || 0), 0);
  const egresos = movimientos.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + (Number(m.monto) || 0), 0);
  const ventasEfectivo = porMedio.get('efectivo')?.total || 0;
  const cobrado = validas.filter((v) => v.medio !== 'credito').reduce((a, v) => a + v.total, 0);
  return {
    ventas: validas.length,
    anuladas: ventas.length - validas.length,
    total_ventas: validas.reduce((a, v) => a + v.total, 0),
    total_cobrado: cobrado,
    ventas_efectivo: ventasEfectivo,
    otros_medios: cobrado - ventasEfectivo,
    credito: porMedio.get('credito')?.total || 0,
    ingresos,
    egresos,
    efectivo_esperado: Math.round(fondo + ventasEfectivo + ingresos - egresos),
    por_medio: [...porMedio.values()].sort((a, b) => (a.medio === 'efectivo' ? -1 : b.medio === 'efectivo' ? 1 : b.total - a.total)),
  };
}

@Injectable()
export class CajaService {
  private readonly logger = new Logger(CajaService.name);

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private sinTabla(error: any): boolean {
    return /(does not exist|schema cache|PGRST205|42P01)/i.test(`${error?.code} ${error?.message}`);
  }

  private fallo(error: any): never {
    if (this.sinTabla(error)) throw new BadRequestException(MIGRACION);
    throw new BadRequestException(String(error?.message || 'No se pudo guardar.'));
  }

  private async abierta(): Promise<any | null> {
    const { data, error } = await this.db.from('caja_sesiones').select('*').eq('estado', 'abierta').order('id', { ascending: false }).limit(1);
    if (error) this.fallo(error);
    return ((data || []) as any[])[0] || null;
  }

  private async movimientosDe(sesionId: number): Promise<any[]> {
    const { data, error } = await this.db
      .from('caja_movimientos')
      .select('id, sesion_id, tipo, monto, motivo, usuario_email, created_at')
      .eq('sesion_id', sesionId)
      .order('id', { ascending: true })
      .range(0, 999);
    if (error) this.fallo(error);
    return ((data || []) as any[]).map((m) => ({ ...m, monto: Number(m.monto) || 0 }));
  }

  /* Ventas directas del usuario de la tienda emitidas entre dos instantes, con su medio de pago. */
  async ventasDelTurno(desde: string, hasta: string | null): Promise<{ ventas: VentaCaja[]; notas_credito: { numero: string | null; total: number; hora: string }[] }> {
    const usuario = cajaUsuario();
    const emisiones: any[] = [];
    for (let i = 0; i < 5000; i += 1000) {
      let q = this.db
        .from('bsale_emisiones')
        .select('id, clave, tipo, estado, numero, total, url_pdf, licitacion_id, documento_id, usuario, created_at')
        .ilike('usuario', usuario)
        .eq('estado', 'emitida')
        .in('tipo', ['boleta', 'factura', 'nota_credito'])
        .gte('created_at', desde);
      if (hasta) q = q.lte('created_at', hasta);
      const { data, error } = await q.order('id', { ascending: true }).range(i, i + 999);
      if (error) throw new BadRequestException(error.message);
      emisiones.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    // Solo las de «Venta directa» (AMS-V-…); su guía (…-G, tipo guia) ya quedó fuera por el tipo.
    const ventasEm = emisiones.filter((e) => (e.tipo === 'boleta' || e.tipo === 'factura') && String(e.clave || '').startsWith('AMS-V-'));
    const ncs = emisiones.filter((e) => e.tipo === 'nota_credito');

    const docIds = [...new Set(ventasEm.map((e) => Number(e.documento_id)).filter((n) => n > 0))];
    const docs = new Map<number, any>();
    const pagos = new Map<number, any[]>();
    const notas = new Map<number, number>();
    for (let i = 0; i < docIds.length; i += 200) {
      const lote = docIds.slice(i, i + 200);
      const [propios, hijos] = await Promise.all([
        this.db.from('licitacion_documentos').select('id, licitacion_id, pagada, forma_pago').in('id', lote),
        this.db.from('licitacion_documentos').select('id, tipo, numero, monto, forma_pago, deriva_de_id, descripcion').in('deriva_de_id', lote).in('tipo', ['comprobante_pago', 'nota_credito']),
      ]);
      for (const d of (propios.data || []) as any[]) docs.set(Number(d.id), d);
      for (const h of (hijos.data || []) as any[]) {
        const k = Number(h.deriva_de_id);
        if (h.tipo === 'comprobante_pago') pagos.set(k, [...(pagos.get(k) || []), h]);
        // Las NC que solo corrigen texto no anulan nada.
        else if (!/^Corrige texto/.test(String(h.descripcion || ''))) notas.set(k, (notas.get(k) || 0) + (Number(h.monto) || 0));
      }
    }
    const licIds = [...new Set(ventasEm.map((e) => Number(e.licitacion_id) || Number(docs.get(Number(e.documento_id))?.licitacion_id)).filter((n) => n > 0))];
    const clientes = new Map<number, string>();
    for (let i = 0; i < licIds.length; i += 300) {
      const { data } = await this.db.from('licitaciones').select('id, nombre_entidad').in('id', licIds.slice(i, i + 300));
      for (const l of (data || []) as any[]) clientes.set(Number(l.id), String(l.nombre_entidad || ''));
    }

    const ventas: VentaCaja[] = ventasEm.map((e) => {
      const doc = docs.get(Number(e.documento_id)) || null;
      const ps = pagos.get(Number(e.documento_id)) || [];
      // Con comprobante: su medio. Sin comprobante pero marcada pagada: el del documento. Si no, fue a crédito.
      const medio = ps.length ? medioDe(ps[0].forma_pago) : doc?.pagada ? medioDe(doc.forma_pago) : 'credito';
      const total = Math.round(Number(e.total) || 0);
      const licId = Number(e.licitacion_id) || Number(doc?.licitacion_id) || 0;
      return {
        id: Number(e.id),
        tipo: e.tipo === 'factura' ? 'factura' : 'boleta',
        numero: e.numero != null ? String(e.numero) : null,
        hora: e.created_at,
        cliente: clientes.get(licId) || '',
        total,
        medio,
        medio_nombre: nombreMedio(medio),
        comprobante: ps.length ? String(ps[0].numero || '') || null : null,
        // La NC (guardada en bruto) que cubre el documento lo deja sin efecto.
        anulada: total > 0 && (notas.get(Number(e.documento_id)) || 0) >= total - 2,
        url_pdf: e.url_pdf || null,
      };
    });
    return {
      ventas,
      notas_credito: ncs.map((n) => ({ numero: n.numero != null ? String(n.numero) : null, total: Math.round(Number(n.total) || 0), hora: n.created_at })),
    };
  }

  private async detalle(sesion: any) {
    const [movimientos, { ventas, notas_credito }] = await Promise.all([
      this.movimientosDe(Number(sesion.id)),
      this.ventasDelTurno(sesion.abierta_at, sesion.cerrada_at || null),
    ]);
    const fondo = Number(sesion.monto_inicial) || 0;
    return {
      sesion: this.vista(sesion),
      resumen: resumirTurno(fondo, ventas, movimientos),
      ventas: [...ventas].reverse(), // las más nuevas primero
      notas_credito,
      movimientos: [...movimientos].reverse(),
    };
  }

  private vista(s: any) {
    return {
      id: Number(s.id),
      estado: s.estado,
      abierta_at: s.abierta_at,
      abierta_por: s.abierta_por || '',
      monto_inicial: Number(s.monto_inicial) || 0,
      observacion_apertura: s.observacion_apertura || '',
      cerrada_at: s.cerrada_at || null,
      cerrada_por: s.cerrada_por || '',
      efectivo_esperado: s.efectivo_esperado == null ? null : Number(s.efectivo_esperado),
      efectivo_contado: s.efectivo_contado == null ? null : Number(s.efectivo_contado),
      diferencia: s.diferencia == null ? null : Number(s.diferencia),
      observacion_cierre: s.observacion_cierre || '',
      resumen_cierre: s.resumen || null,
    };
  }

  /* Estado de la caja: el turno abierto con su detalle en vivo, o null. */
  async estado() {
    const usuario = cajaUsuario();
    const { error } = await this.db.from('caja_sesiones').select('id').limit(1);
    if (error) {
      if (this.sinTabla(error)) return { listo: false, mensaje: MIGRACION, usuario_caja: usuario, medios: MEDIOS, turno: null };
      throw new BadRequestException(error.message);
    }
    const sesion = await this.abierta();
    return { listo: true, usuario_caja: usuario, medios: MEDIOS, turno: sesion ? await this.detalle(sesion) : null };
  }

  async abrir(body: any, email: string) {
    if (await this.abierta()) throw new ConflictException('Ya hay una caja abierta: ciérrala antes de abrir otra.');
    const monto = entero(body?.monto_inicial);
    if (monto < 0 || monto > MAX_MONTO) throw new BadRequestException('Indica el fondo inicial de la caja (0 o más).');
    const { data, error } = await this.db
      .from('caja_sesiones')
      .insert({ estado: 'abierta', abierta_por: email, monto_inicial: monto, observacion_apertura: texto(body?.observacion, 300) || null, usuario_caja: cajaUsuario() })
      .select('*')
      .single();
    if (error) {
      // El índice único de «una sola abierta» corta dos aperturas simultáneas.
      if (/duplicate|unique/i.test(String(error.message))) throw new ConflictException('Ya hay una caja abierta.');
      this.fallo(error);
    }
    this.logger.log(`Caja abierta por ${email} con fondo $${monto.toLocaleString('es-CL')}`);
    return this.detalle(data);
  }

  /* Entrada o salida de efectivo a mano (retiro, gasto menor, devolución en efectivo, sencillo…). */
  async movimiento(body: any, email: string) {
    const sesion = await this.abierta();
    if (!sesion) throw new BadRequestException('No hay una caja abierta.');
    const tipo = String(body?.tipo || '');
    if (tipo !== 'ingreso' && tipo !== 'egreso') throw new BadRequestException('Indica si es un ingreso o un egreso de efectivo.');
    const monto = entero(body?.monto);
    if (!(monto > 0) || monto > MAX_MONTO) throw new BadRequestException('Indica el monto (mayor que 0).');
    const motivo = texto(body?.motivo, 200);
    if (!motivo) throw new BadRequestException('Escribe el motivo del movimiento.');
    const { error } = await this.db.from('caja_movimientos').insert({ sesion_id: sesion.id, tipo, monto, motivo, usuario_email: email });
    if (error) this.fallo(error);
    return this.detalle(sesion);
  }

  async eliminarMovimiento(id: number) {
    const sesion = await this.abierta();
    if (!sesion) throw new BadRequestException('No hay una caja abierta.');
    const { data, error } = await this.db.from('caja_movimientos').delete().eq('id', id).eq('sesion_id', sesion.id).select('id');
    if (error) this.fallo(error);
    if (!(data || []).length) throw new NotFoundException('Ese movimiento no es del turno abierto.');
    return this.detalle(sesion);
  }

  /* Cierre con arqueo: se cuenta el efectivo y queda la diferencia contra lo esperado. */
  async cerrar(body: any, email: string) {
    const sesion = await this.abierta();
    if (!sesion) throw new BadRequestException('No hay una caja abierta.');
    const crudo = body?.efectivo_contado;
    if (crudo === undefined || crudo === null || String(crudo).trim() === '') throw new BadRequestException('Indica cuánto efectivo se contó en la caja.');
    const contado = entero(crudo);
    if (contado < 0 || contado > MAX_MONTO) throw new BadRequestException('El efectivo contado no es válido.');
    const cierre = new Date().toISOString();
    const [movimientos, { ventas, notas_credito }] = await Promise.all([this.movimientosDe(Number(sesion.id)), this.ventasDelTurno(sesion.abierta_at, cierre)]);
    const resumen = resumirTurno(Number(sesion.monto_inicial) || 0, ventas, movimientos);
    const diferencia = contado - resumen.efectivo_esperado;
    if (diferencia !== 0 && !texto(body?.observacion, 400)) {
      throw new BadRequestException(`El efectivo contado no calza con lo esperado (${diferencia > 0 ? 'sobran' : 'faltan'} $${Math.abs(diferencia).toLocaleString('es-CL')}): explica la diferencia en la observación.`);
    }
    const { data, error } = await this.db
      .from('caja_sesiones')
      .update({
        estado: 'cerrada',
        cerrada_at: cierre,
        cerrada_por: email,
        efectivo_esperado: resumen.efectivo_esperado,
        efectivo_contado: contado,
        diferencia,
        observacion_cierre: texto(body?.observacion, 400) || null,
        // La foto del turno: el historial no cambia aunque después se anule una venta.
        resumen: { ...resumen, notas_credito: notas_credito.length, total_notas_credito: notas_credito.reduce((a, n) => a + n.total, 0) },
      })
      .eq('id', sesion.id)
      .eq('estado', 'abierta')
      .select('*')
      .maybeSingle();
    if (error) this.fallo(error);
    if (!data) throw new ConflictException('La caja ya fue cerrada por otra persona.');
    this.logger.log(`Caja ${sesion.id} cerrada por ${email}: esperado $${resumen.efectivo_esperado}, contado $${contado}, diferencia $${diferencia}`);
    return { ok: true, sesion: this.vista(data), resumen };
  }

  /* Turnos cerrados, del más nuevo al más antiguo. */
  async historial(limite = 200) {
    const { data, error } = await this.db
      .from('caja_sesiones')
      .select('*')
      .eq('estado', 'cerrada')
      .order('id', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limite) || 200, 500)));
    if (error) {
      if (this.sinTabla(error)) return { listo: false, turnos: [] };
      throw new BadRequestException(error.message);
    }
    return { listo: true, turnos: ((data || []) as any[]).map((s) => this.vista(s)) };
  }

  /* Detalle de un turno (ventas y movimientos), para revisar o exportar. */
  async turno(id: number) {
    const { data, error } = await this.db.from('caja_sesiones').select('*').eq('id', id).maybeSingle();
    if (error) this.fallo(error);
    if (!data) throw new NotFoundException('Ese turno de caja no existe.');
    return this.detalle(data);
  }
}
