import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LicitacionesService } from './licitaciones.service';

/* ── Dinero de las notas de crédito (2026-10-08) ──────────────────────────
   Pedido de Ariel: "pensar en el flujo de anulación de una factura: se le
   devuelve dinero al cliente, entonces esa factura debe después quedar impaga
   y además se debe dar trazabilidad a la devolución. Si se devolverá el dinero
   o se dejará como saldo a favor se determina al emitir la NC, y toda la
   trazabilidad queda en Trazabilidad → Facturas".

   · La nota de crédito guarda la decisión en `dinero`: devolver | saldo_favor |
     rebajar_deuda | sin_movimiento (migración 20261008_documentos_devolucion).
   · La devolución es un documento `devolucion` colgado de la factura
     (deriva_de_id) que apunta a la nota de crédito (origen_doc_id). Guarda el
     monto NETO, como los comprobantes de pago: es un pago con signo contrario.
   · El saldo a favor se aplica a otra factura del mismo cliente como un
     `comprobante_pago` con forma_pago «Saldo a favor» y origen_doc_id = la NC.
   · Lo demás se deriva, nunca se guarda: lo que la NC dejó en manos del
     cliente = su monto, hasta lo pagado que no salió por otras notas; de eso,
     pendiente de devolver = base − devuelto − aplicado. La pestaña Facturas
     hace la misma cuenta en el navegador (DineroNotaCredito.jsx): si se cambia
     una fórmula, cambiar las dos. */

export const DINERO_NC = ['devolver', 'saldo_favor', 'rebajar_deuda', 'sin_movimiento'] as const;
export type DineroNc = (typeof DINERO_NC)[number];
export const MEDIOS_DEVOLUCION = ['Transferencia', 'Efectivo', 'Reverso de tarjeta / Webpay', 'Cheque'];
const PAGOS = ['comprobante_pago', 'webpay', 'efectivo'];
const FACTURAS = ['factura', 'factura_boleta'];
const COLS = 'id, licitacion_id, tipo, numero, monto, deriva_de_id, origen_doc_id, fecha_oc, fecha_factura, forma_pago, banco_pago, pagada, fecha_pago, descripcion, created_at';
const bruto = (neto: any) => Math.round((Number(neto) || 0) * 1.19);
const suma = (l: any[]) => l.reduce((a, d) => a + (Number(d?.monto) || 0), 0);
const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const normRut = (r: any) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
const hoyIso = () => new Date().toISOString().slice(0, 10);
const esFecha = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const etiquetaDoc = (f: any) => (f?.tipo === 'factura' ? 'factura' : /boleta/i.test(String(f?.descripcion || '')) ? 'boleta' : 'factura/boleta');

@Injectable()
export class DevolucionesService {
  private readonly logger = new Logger(DevolucionesService.name);
  // La columna `dinero` aún no existe (migración 20261008 pendiente): se lee sin ella.
  private sinDinero = false;

  constructor(
    private supabase: SupabaseService,
    private licitaciones: LicitacionesService,
  ) {}

  private async leer(aplicar: (q: any) => any): Promise<any[]> {
    const db = this.supabase.getClient();
    if (!this.sinDinero) {
      const r = await aplicar(db.from('licitacion_documentos').select(`${COLS}, dinero`));
      if (!r.error) return r.data || [];
      if (!/dinero/i.test(String(r.error.message))) throw new BadRequestException(r.error.message);
      this.sinDinero = true;
    }
    const r = await aplicar(db.from('licitacion_documentos').select(COLS));
    if (r.error) throw new BadRequestException(r.error.message);
    return (r.data || []).map((d: any) => ({ ...d, dinero: null }));
  }

  /* La cuenta de una factura a partir de los documentos de su cotización (y
     los saldos a favor de sus NC aplicados en otras). Los pagos sin factura
     asignada cuentan solo si la cotización tiene una sola factura, igual que
     marcarPagadaSiCubierta y Seguimiento de Pagos. */
  private cuentaDe(f: any, docs: any[], usos: any[]) {
    const facturasLic = docs.filter((d) => FACTURAS.includes(d.tipo));
    const ids = new Set(facturasLic.map((x) => Number(x.id)));
    const unica = facturasLic.length === 1;
    const deFactura = (d: any) => Number(d.deriva_de_id) === Number(f.id) || (unica && (d.deriva_de_id == null || !ids.has(Number(d.deriva_de_id))));
    const pagos = docs.filter((d) => PAGOS.includes(d.tipo) && deFactura(d));
    const devoluciones = docs.filter((d) => d.tipo === 'devolucion' && deFactura(d));
    const ncs = docs.filter((d) => d.tipo === 'nota_credito' && Number(d.deriva_de_id) === Number(f.id));
    const nds = docs.filter((d) => d.tipo === 'nota_debito' && Number(d.deriva_de_id) === Number(f.id));
    const brutoFactura = bruto(f.monto);
    const ncBruto = suma(ncs);
    const ndBruto = suma(nds);
    const pagadoBruto = bruto(suma(pagos));
    const devueltoBruto = bruto(suma(devoluciones));
    return {
      factura: f, pagos, devoluciones, ncs, nds, usos, unica,
      bruto: brutoFactura, nc_bruto: ncBruto, nd_bruto: ndBruto,
      pagado_bruto: pagadoBruto, devuelto_bruto: devueltoBruto, usado_bruto: bruto(suma(usos)),
      anulada: brutoFactura > 0 && ncBruto >= brutoFactura - 2,
      saldo_bruto: Math.max(0, brutoFactura - ncBruto + ndBruto - pagadoBruto + devueltoBruto),
    };
  }

  async cuentaFactura(facturaId: number) {
    const [f] = await this.leer((q) => q.eq('id', Number(facturaId) || 0));
    if (!f || !FACTURAS.includes(f.tipo)) throw new NotFoundException('La factura no existe en el sistema.');
    const docs = await this.leer((q) => q.eq('licitacion_id', Number(f.licitacion_id)));
    const ncIds = docs.filter((d) => d.tipo === 'nota_credito' && Number(d.deriva_de_id) === Number(f.id)).map((d) => Number(d.id));
    const usos = ncIds.length ? await this.leer((q) => q.in('origen_doc_id', ncIds).in('tipo', PAGOS)) : [];
    return this.cuentaDe(f, docs, usos);
  }

  /* Lo que la nota de crédito dejó en manos del cliente, y qué se hizo con eso. */
  async cuentaNotaCredito(ncId: number) {
    const [nc] = await this.leer((q) => q.eq('id', Number(ncId) || 0));
    if (!nc || nc.tipo !== 'nota_credito') throw new NotFoundException('La nota de crédito no está registrada en el sistema.');
    if (!nc.deriva_de_id) throw new BadRequestException('La nota de crédito no está colgada de una factura.');
    const c = await this.cuentaFactura(Number(nc.deriva_de_id));
    const propias = (l: any[]) => l.filter((d) => Number(d.origen_doc_id) === Number(nc.id));
    const ajenas = (l: any[]) => l.filter((d) => Number(d.origen_doc_id) !== Number(nc.id));
    const devuelto = bruto(suma(propias(c.devoluciones)));
    const usado = bruto(suma(propias(c.usos)));
    const salidasAjenas = bruto(suma(ajenas(c.devoluciones))) + bruto(suma(ajenas(c.usos)));
    const base = Math.max(0, Math.min(Number(nc.monto) || 0, c.pagado_bruto - salidasAjenas));
    const disponible = Math.max(0, base - devuelto - usado);
    const dinero = (DINERO_NC as readonly string[]).includes(String(nc.dinero || '')) ? (nc.dinero as DineroNc) : null;
    return {
      nc, factura: c.factura, dinero,
      base_bruto: base, devuelto_bruto: devuelto, usado_bruto: usado, disponible_bruto: disponible,
      pendiente_devolver: dinero === 'devolver' ? disponible : 0,
      saldo_favor: dinero === 'saldo_favor' ? disponible : 0,
      devoluciones: propias(c.devoluciones), usos: propias(c.usos), cuenta: c,
    };
  }

  /* Facturas vigentes del mismo cliente con saldo, para aplicarles el saldo a
     favor. El RUT se compara normalizado: en las cotizaciones viene con o sin
     puntos. */
  async candidatasSaldoFavor(ncId: number) {
    const c = await this.cuentaNotaCredito(ncId);
    const db = this.supabase.getClient();
    const { data: licOrigen } = await db.from('licitaciones').select('id, rut_entidad, nombre_entidad').eq('id', Number(c.factura.licitacion_id)).maybeSingle();
    const rut = normRut((licOrigen as any)?.rut_entidad);
    const resumen = {
      nc: { id: Number(c.nc.id), numero: c.nc.numero, monto: Number(c.nc.monto) || 0, dinero: c.dinero, fecha: c.nc.fecha_oc },
      factura: { id: Number(c.factura.id), numero: c.factura.numero, tipo: etiquetaDoc(c.factura), licitacion_id: Number(c.factura.licitacion_id) },
      cliente: { rut: (licOrigen as any)?.rut_entidad || null, nombre: (licOrigen as any)?.nombre_entidad || null },
      base_bruto: c.base_bruto, devuelto_bruto: c.devuelto_bruto, usado_bruto: c.usado_bruto, disponible_bruto: c.disponible_bruto,
      pendiente_devolver: c.pendiente_devolver, saldo_favor: c.saldo_favor,
      devoluciones: c.devoluciones, usos: c.usos, medios: MEDIOS_DEVOLUCION,
    };
    if (!rut || rut.length < 2) return { ...resumen, candidatas: [] };
    const cuerpo = rut.slice(0, -1);
    const dv = rut.slice(-1);
    const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const variantes = [...new Set([`${conPuntos}-${dv}`, `${cuerpo}-${dv}`, rut, String((licOrigen as any)?.rut_entidad || '')])].filter(Boolean);
    const { data: lics } = await db.from('licitaciones').select('id, id_licitacion, nombre_entidad, estado').in('rut_entidad', variantes);
    const ids = (lics || []).map((l: any) => Number(l.id));
    if (!ids.length) return { ...resumen, candidatas: [] };
    const docs = await this.leer((q) => q.in('licitacion_id', ids));
    const porLic = new Map<number, any[]>();
    for (const d of docs) {
      const k = Number(d.licitacion_id);
      if (!porLic.has(k)) porLic.set(k, []);
      (porLic.get(k) as any[]).push(d);
    }
    const candidatas: any[] = [];
    for (const f of docs) {
      if (!FACTURAS.includes(f.tipo) || Number(f.id) === Number(c.factura.id)) continue;
      const cf = this.cuentaDe(f, porLic.get(Number(f.licitacion_id)) || [], []);
      if (cf.anulada || cf.saldo_bruto <= 2) continue;
      const lic = (lics || []).find((l: any) => Number(l.id) === Number(f.licitacion_id));
      candidatas.push({
        id: Number(f.id), numero: f.numero, tipo: etiquetaDoc(f), fecha: f.fecha_factura || f.fecha_oc || null,
        licitacion_id: Number(f.licitacion_id), codigo: (lic as any)?.id_licitacion || null, cliente: (lic as any)?.nombre_entidad || null,
        bruto: cf.bruto, saldo_bruto: cf.saldo_bruto,
      });
    }
    candidatas.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id);
    return { ...resumen, candidatas };
  }

  /* Registra la devolución del dinero al cliente. Se puede devolver hasta lo
     que la nota de crédito dejó en sus manos (aunque la NC se haya marcado
     «saldo a favor»: si al final se le devuelve, se registra igual). */
  async registrarDevolucion(usuario: { id: string; email: string }, body: any) {
    const ncId = Number(body?.nc_id) || 0;
    const c = await this.cuentaNotaCredito(ncId);
    const monto = Math.round(Number(body?.monto));
    if (!(monto > 0)) throw new BadRequestException('Indica el monto devuelto (con IVA).');
    if (c.disponible_bruto <= 0) throw new BadRequestException('Esta nota de crédito no tiene dinero pendiente: el cliente no había pagado, o ya se devolvió o se aplicó.');
    if (monto > c.disponible_bruto + 2) {
      throw new BadRequestException(`Se puede devolver hasta ${clp(c.disponible_bruto)}: lo pagado que cubre la nota de crédito y no se ha devuelto ni aplicado.`);
    }
    const medio = MEDIOS_DEVOLUCION.find((m) => m.toLowerCase() === String(body?.medio || '').trim().toLowerCase()) || null;
    if (!medio) throw new BadRequestException('Elige cómo se devolvió el dinero.');
    const fecha = esFecha(body?.fecha) ? String(body.fecha) : hoyIso();
    const comprobante = String(body?.comprobante || '').trim().slice(0, 80);
    const banco = String(body?.banco || '').trim().slice(0, 80);
    const obs = String(body?.observacion || '').trim().slice(0, 300);
    const a = body?.archivo && typeof body.archivo === 'object' ? body.archivo : null;
    const etiqueta = etiquetaDoc(c.factura);
    const doc = await this.licitaciones.createDocumento({
      licitacion_id: Number(c.factura.licitacion_id), tipo: 'devolucion', numero: comprobante || null,
      // NETO, como los comprobantes de pago: Seguimiento de Pagos lo resta de lo pagado.
      monto: Math.round(monto / 1.19), fecha_oc: fecha,
      deriva_de_id: Number(c.factura.id), origen_doc_id: Number(c.nc.id), forma_pago: medio, banco_pago: banco || null,
      descripcion: `Devolución de ${clp(monto)} al cliente por la nota de crédito N° ${c.nc.numero} (${etiqueta} N° ${c.factura.numero}) · ${medio}${banco ? ` ${banco}` : ''}${comprobante ? ` · comprobante ${comprobante}` : ''}${obs ? ` · ${obs}` : ''} · registrada por ${usuario.email}`,
      ...(a?.storage_path
        ? { bucket: a.bucket || 'factura', storage_path: String(a.storage_path), file_name: a.file_name || null, mime_type: a.mime_type || null, size_bytes: Number(a.size_bytes) || null }
        : {}),
    });
    const pagada = await this.recalcularPagada(Number(c.factura.id));
    const despues = await this.cuentaNotaCredito(ncId);
    if (despues.disponible_bruto <= 2) await this.cerrarAvisos(ncId);
    this.logger.log(`Devolución de ${clp(monto)} (${medio}) por la NC ${c.nc.numero} de la ${etiqueta} ${c.factura.numero}, por ${usuario.email}`);
    return {
      documento_id: Number((doc as any)?.id) || null, factura_pagada: pagada,
      pendiente_devolver: despues.pendiente_devolver, disponible_bruto: despues.disponible_bruto,
    };
  }

  /* Aplica el saldo a favor a otra factura del mismo cliente como un pago. */
  async usarSaldoFavor(usuario: { id: string; email: string }, body: any) {
    const ncId = Number(body?.nc_id) || 0;
    const c = await this.cuentaNotaCredito(ncId);
    const destinoId = Number(body?.factura_id) || 0;
    if (!(destinoId > 0) || destinoId === Number(c.factura.id)) throw new BadRequestException('Elige la factura a la que se aplica el saldo a favor.');
    if (c.disponible_bruto <= 0) throw new BadRequestException('Esta nota de crédito no tiene saldo disponible: el cliente no había pagado, o ya se devolvió o se aplicó.');
    const d = await this.cuentaFactura(destinoId);
    if (d.anulada) throw new BadRequestException(`La ${etiquetaDoc(d.factura)} N° ${d.factura.numero} está anulada.`);
    const db = this.supabase.getClient();
    const { data: lics } = await db.from('licitaciones').select('id, rut_entidad, nombre_entidad').in('id', [Number(c.factura.licitacion_id), Number(d.factura.licitacion_id)]);
    const rutDe = (licId: number) => normRut((lics || []).find((l: any) => Number(l.id) === licId)?.rut_entidad);
    const rutOrigen = rutDe(Number(c.factura.licitacion_id));
    const rutDestino = rutDe(Number(d.factura.licitacion_id));
    if (rutOrigen && rutDestino && rutOrigen !== rutDestino) {
      throw new BadRequestException(`La ${etiquetaDoc(d.factura)} N° ${d.factura.numero} es de otro cliente: el saldo a favor solo se aplica al mismo RUT.`);
    }
    const monto = Math.round(Number(body?.monto));
    const tope = Math.min(c.disponible_bruto, d.saldo_bruto);
    if (!(monto > 0)) throw new BadRequestException('Indica el monto a aplicar (con IVA).');
    if (monto > tope + 2) {
      throw new BadRequestException(`Se puede aplicar hasta ${clp(tope)}: saldo a favor disponible ${clp(c.disponible_bruto)} y saldo de la factura ${clp(d.saldo_bruto)}.`);
    }
    const fecha = esFecha(body?.fecha) ? String(body.fecha) : hoyIso();
    const doc: any = await this.licitaciones.createDocumento({
      licitacion_id: Number(d.factura.licitacion_id), tipo: 'comprobante_pago', numero: `Saldo a favor NC ${c.nc.numero}`,
      monto: Math.round(monto / 1.19), fecha_oc: fecha, deriva_de_id: destinoId, origen_doc_id: Number(c.nc.id), forma_pago: 'Saldo a favor',
      descripcion: `Saldo a favor de la nota de crédito N° ${c.nc.numero} (${etiquetaDoc(c.factura)} N° ${c.factura.numero}) aplicado a la ${etiquetaDoc(d.factura)} N° ${d.factura.numero}: ${clp(monto)} · por ${usuario.email}`,
    });
    const despues = await this.cuentaNotaCredito(ncId);
    if (despues.disponible_bruto <= 2) await this.cerrarAvisos(ncId);
    this.logger.log(`Saldo a favor de la NC ${c.nc.numero}: ${clp(monto)} aplicados a la ${etiquetaDoc(d.factura)} ${d.factura.numero}, por ${usuario.email}`);
    return {
      documento_id: Number(doc?.id) || null, factura_pagada: !!doc?.factura_pagada,
      saldo_favor: despues.saldo_favor, disponible_bruto: despues.disponible_bruto,
      destino: { id: destinoId, numero: d.factura.numero, licitacion_id: Number(d.factura.licitacion_id) },
    };
  }

  /* Pagada = lo pagado menos lo devuelto cubre lo que vale la factura hoy
     (total − NC + ND) y además queda algo pagado: una anulada con todo el
     dinero devuelto vuelve a «no pagada» (pedido de Ariel: "esa factura debe
     después quedar impaga"). */
  async recalcularPagada(facturaId: number): Promise<boolean> {
    const c = await this.cuentaFactura(facturaId);
    const neto = suma(c.pagos) - suma(c.devoluciones);
    const base = (Number(c.factura.monto) || 0) - c.nc_bruto / 1.19 + c.nd_bruto / 1.19;
    const pagada = neto > 0 && neto >= base - 5;
    if (!!c.factura.pagada !== pagada) {
      const { error } = await this.supabase.getClient()
        .from('licitacion_documentos')
        .update(pagada ? { pagada: true, fecha_pago: c.factura.fecha_pago || hoyIso() } : { pagada: false, fecha_pago: null })
        .eq('id', Number(facturaId));
      if (error) this.logger.warn(`No se pudo actualizar «pagada» de la factura ${facturaId}: ${error.message}`);
    }
    return pagada;
  }

  /* Aviso en la campana (admin y contabilidad) cuando una nota de crédito
     deja dinero por devolver. Idempotente por nota y persona. Nunca lanza. */
  async avisarDevolucionPendiente(p: { ncId: number; facturaId: number; licitacionId: number | null; monto: number; cliente: string; numeroNc: string; numeroFactura: string; etiqueta: string }) {
    try {
      if (!(p.monto > 0) || !p.ncId) return 0;
      const db = this.supabase.getClient();
      const { data: perfiles } = await db.from('profiles').select('email, rol').in('rol', ['admin', 'administrador', 'contabilidad']);
      const emails = [...new Set((perfiles || []).map((x: any) => String(x.email || '').trim().toLowerCase()).filter(Boolean))];
      if (!emails.length) return 0;
      const { data: previas } = await db.from('notificaciones').select('id, user_email').eq('tipo', 'devolucion_pendiente').filter('metadata->>nc_id', 'eq', String(p.ncId));
      const ya = new Set((previas || []).map((n: any) => String(n.user_email || '').toLowerCase()));
      const filas = emails.filter((e) => !ya.has(e)).map((user_email) => ({
        user_email,
        tipo: 'devolucion_pendiente',
        mensaje: `Devolución pendiente de ${clp(p.monto)} a ${p.cliente || 'el cliente'}: la nota de crédito N° ${p.numeroNc} anuló la ${p.etiqueta} N° ${p.numeroFactura}, que ya estaba pagada. Regístrala en Trazabilidad → Facturas cuando se haga.`,
        link: '/trazabilidad?pestana=facturas&filtro=devolucion_pendiente',
        metadata: { licitacion_id: p.licitacionId, documento_id: p.facturaId, nc_id: p.ncId, monto: p.monto },
      }));
      if (!filas.length) return 0;
      const { error } = await db.from('notificaciones').insert(filas);
      if (error) throw new Error(error.message);
      return filas.length;
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar la devolución pendiente de la NC ${p.ncId}: ${e?.message || e}`);
      return 0;
    }
  }

  private async cerrarAvisos(ncId: number) {
    try {
      await this.supabase.getClient()
        .from('notificaciones')
        .update({ leida_at: new Date().toISOString() })
        .eq('tipo', 'devolucion_pendiente')
        .is('leida_at', null)
        .filter('metadata->>nc_id', 'eq', String(ncId));
    } catch { /* el aviso queda; no frena el registro */ }
  }
}
