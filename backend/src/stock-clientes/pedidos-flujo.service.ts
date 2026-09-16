import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';

/* ── Flujo de aprobación y pago de los pedidos del portal (2026-09-16) ────
   Un pedido recorre estas etapas, cada una con responsable y hora:

     pendiente_aprobacion → aprobado_cliente → validado_plataforma → pagado

   · pendiente_aprobacion  el asistente armó el pedido y espera al
                           administrador de la cuenta del cliente.
   · aprobado_cliente      lo aprobó ese administrador. Amsodent se entera y
                           al cliente se le promete respuesta en 24-48 hrs.
   · validado_plataforma   Amsodent confirmó existencias producto por producto
                           y emitió el link de pago.
   · pagado                Webpay confirmó el pago: 48-72 hrs para despachar.

   La REVERSA es válida en cualquier etapa mientras el pedido no esté pagado
   (cambió un producto, no había stock, el cliente se arrepintió). Una vez
   pagado el pedido se cierra: los productos nuevos van en un pedido nuevo. */

export type FlujoEstado =
  | 'pendiente_aprobacion'
  | 'aprobado_cliente'
  | 'validado_plataforma'
  | 'pagado'
  | 'rechazado'
  | 'cancelado';

// Orden de las etapas, para saber qué significa "un paso atrás".
const ORDEN: FlujoEstado[] = ['pendiente_aprobacion', 'aprobado_cliente', 'validado_plataforma', 'pagado'];

export const MENSAJE_APROBADO_CLIENTE =
  'Se revisará tu solicitud, en un plazo de 24-48 hrs.';
export const MENSAJE_PAGADO =
  'Tienen un plazo de 48 a 72 hrs para despachar el pedido.';

const TABLA = 'stock_solicitudes_cotizacion';
const TABLA_EVENTOS = 'stock_solicitud_eventos';

@Injectable()
export class PedidosFlujoService {
  private readonly logger = new Logger(PedidosFlujoService.name);

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
  ) {}

  private get client() {
    return this.supabase.getClient();
  }

  /* La migración 20260916 puede no estar aplicada todavía: en ese caso el
     flujo no existe y lo decimos claro en vez de fallar con un error de
     Postgres que nadie entiende. */
  private traducirError(error: any): never {
    const msg = String(error?.message || error);
    if (/flujo_estado|stock_solicitud_eventos|disponibilidad|pago_estado/.test(msg) && /column|does not exist|schema cache/i.test(msg)) {
      throw new BadRequestException(
        'Falta aplicar la migración 20260916_pedidos_flujo_aprobacion.sql en Supabase.',
      );
    }
    throw new BadRequestException(msg);
  }

  async obtener(id: number) {
    const { data, error } = await this.client.from(TABLA).select('*').eq('id', Number(id)).maybeSingle();
    if (error) this.traducirError(error);
    if (!data) throw new NotFoundException('El pedido no existe.');
    return data;
  }

  private estadoDe(pedido: any): FlujoEstado {
    return (pedido?.flujo_estado || 'pendiente_aprobacion') as FlujoEstado;
  }

  /* Bitácora: nunca debe tumbar la operación principal, pero sí quedar
     registrada — es la base de los KPI de tiempo de respuesta. */
  async registrarEvento(args: {
    solicitudId: number;
    tipo: string;
    estadoDesde?: string | null;
    estadoHasta?: string | null;
    actorTipo?: 'cliente' | 'plataforma' | 'sistema';
    actorEmail?: string | null;
    detalle?: string | null;
    datos?: Record<string, any> | null;
  }) {
    try {
      await this.client.from(TABLA_EVENTOS).insert({
        solicitud_id: args.solicitudId,
        tipo: args.tipo,
        estado_desde: args.estadoDesde ?? null,
        estado_hasta: args.estadoHasta ?? null,
        actor_tipo: args.actorTipo ?? 'sistema',
        actor_email: args.actorEmail ?? null,
        detalle: args.detalle ?? null,
        datos: args.datos ?? null,
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar el evento del pedido ${args.solicitudId}: ${e?.message || e}`);
    }
  }

  async eventosDe(solicitudId: number) {
    const { data, error } = await this.client
      .from(TABLA_EVENTOS)
      .select('*')
      .eq('solicitud_id', Number(solicitudId))
      .order('created_at', { ascending: true });
    if (error) this.traducirError(error);
    return data || [];
  }

  private async mover(
    id: number,
    desde: FlujoEstado[],
    hasta: FlujoEstado,
    extra: Record<string, any>,
    evento: { tipo: string; actorTipo: 'cliente' | 'plataforma' | 'sistema'; actorEmail?: string | null; detalle?: string | null; datos?: any },
  ) {
    const pedido = await this.obtener(id);
    const actual = this.estadoDe(pedido);
    if (!desde.includes(actual)) {
      throw new BadRequestException(
        `El pedido está en "${etiquetaEstado(actual)}" y esta acción requiere que esté en ${desde.map(etiquetaEstado).join(' o ')}.`,
      );
    }
    const { data, error } = await this.client
      .from(TABLA)
      .update({ ...extra, flujo_estado: hasta, updated_at: new Date().toISOString() })
      .eq('id', Number(id))
      .select()
      .single();
    if (error) this.traducirError(error);
    await this.registrarEvento({
      solicitudId: Number(id),
      tipo: evento.tipo,
      estadoDesde: actual,
      estadoHasta: hasta,
      actorTipo: evento.actorTipo,
      actorEmail: evento.actorEmail,
      detalle: evento.detalle,
      datos: evento.datos,
    });
    return data;
  }

  /* ── Paso 1: el administrador de la cuenta aprueba (punto 9) ─────────── */
  async aprobarComoCliente(id: number, actorEmail: string, rut: string) {
    const pedido = await this.obtener(id);
    if (String(pedido.rut) !== String(rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    const data = await this.mover(
      id,
      ['pendiente_aprobacion'],
      'aprobado_cliente',
      { aprobado_cliente_at: new Date().toISOString(), aprobado_cliente_por: actorEmail },
      { tipo: 'aprobado_cliente', actorTipo: 'cliente', actorEmail, detalle: 'Aprobado por el administrador de la cuenta.' },
    );
    // Punto 10: recién ahora se entera la plataforma.
    await this.notificarPlataforma(data);
    return { ok: true, pedido: data, mensaje: MENSAJE_APROBADO_CLIENTE };
  }

  /* ── Paso 2: Amsodent valida existencias y emite el link de pago ─────── */
  async validarDesdePlataforma(
    id: number,
    body: {
      disponibilidad?: Array<{ nombre: string; cantidad_solicitada?: number; cantidad_disponible?: number; precio_unitario?: number; nota?: string }>;
      monto_total?: number | string;
      medio_pago?: string;
      nota?: string;
    },
    actorEmail: string,
  ) {
    const disponibilidad = (Array.isArray(body?.disponibilidad) ? body.disponibilidad : []).map((d) => ({
      nombre: String(d?.nombre || '').slice(0, 200),
      cantidad_solicitada: Number(d?.cantidad_solicitada) || 0,
      cantidad_disponible: Number(d?.cantidad_disponible) || 0,
      precio_unitario: Number(d?.precio_unitario) || 0,
      nota: String(d?.nota || '').slice(0, 300) || undefined,
    })).filter((d) => d.nombre);

    // Si no vino monto, se calcula con lo que efectivamente hay disponible.
    const montoCalculado = disponibilidad.reduce(
      (acc, d) => acc + d.cantidad_disponible * d.precio_unitario,
      0,
    );
    const monto = Math.round(Number(body?.monto_total) || montoCalculado);
    if (monto <= 0) {
      throw new BadRequestException(
        'El monto del pedido debe ser mayor a cero para poder emitir el link de pago.',
      );
    }

    const data = await this.mover(
      id,
      // Se puede revalidar un pedido ya validado (cambió una cantidad).
      ['aprobado_cliente', 'validado_plataforma'],
      'validado_plataforma',
      {
        validado_at: new Date().toISOString(),
        validado_por: actorEmail,
        disponibilidad,
        monto_total: monto,
        pago_monto: monto,
        pago_estado: 'pendiente',
        pago_medio: String(body?.medio_pago || 'webpay'),
        pago_link: linkDePago(Number(id)),
      },
      {
        tipo: 'validado',
        actorTipo: 'plataforma',
        actorEmail,
        detalle: String(body?.nota || '').slice(0, 300) || 'Existencias confirmadas y link de pago emitido.',
        datos: { monto, items: disponibilidad.length },
      },
    );

    // Punto 12: el cliente se entera por el portal y por correo.
    await this.avisarClienteValidado(data);
    return { ok: true, pedido: data };
  }

  /* ── Paso 3: pago con Webpay (punto 13) ─────────────────────────────── */

  // Inicia el pago: pide el token a Transbank y lo deja guardado para poder
  // confirmarlo después. No mueve la etapa: el pedido sigue "por pagar"
  // hasta que Transbank confirme.
  async iniciarPago(id: number, rut: string, returnUrl: string, webpay: { crear: Function }) {
    const pedido = await this.obtener(id);
    if (String(pedido.rut) !== String(rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    const estado = this.estadoDe(pedido);
    if (estado === 'pagado') throw new BadRequestException('Este pedido ya está pagado.');
    if (estado !== 'validado_plataforma') {
      throw new BadRequestException(
        'El pedido todavía no está validado por Amsodent, así que aún no se puede pagar.',
      );
    }
    const monto = Math.round(Number(pedido.monto_total) || 0);
    if (monto <= 0) throw new BadRequestException('El pedido no tiene un monto válido para pagar.');

    // buy_order único por intento: reintentar un pago no puede reutilizar el
    // mismo identificador en Transbank.
    const buyOrder = `AMS-${pedido.id}-${Date.now().toString(36)}`.slice(0, 26);
    const { url, token } = (await webpay.crear({
      buyOrder,
      sessionId: `rut-${rut}`.slice(0, 61),
      monto,
      returnUrl,
    })) as { url: string; token: string };

    await this.client
      .from(TABLA)
      .update({ pago_token: token, pago_orden: buyOrder, pago_estado: 'pendiente', updated_at: new Date().toISOString() })
      .eq('id', Number(id));
    await this.registrarEvento({
      solicitudId: Number(id), tipo: 'pago_iniciado', estadoDesde: estado, estadoHasta: estado,
      actorTipo: 'cliente', detalle: `Pago iniciado por $${monto.toLocaleString('es-CL')}.`,
      datos: { buy_order: buyOrder, monto },
    });
    return { url, token, monto };
  }

  /* Confirma el pago contra Transbank. La verdad del pago la dice Transbank,
     nunca el navegador: por eso el monto y la aprobación se comparan aquí
     antes de dar el pedido por pagado. */
  async confirmarPago(token: string, webpay: { confirmar: Function }) {
    const t = String(token || '').trim();
    if (!t) throw new BadRequestException('Falta el token de la transacción.');
    const { data: pedido, error } = await this.client
      .from(TABLA)
      .select('*')
      .eq('pago_token', t)
      .maybeSingle();
    if (error) this.traducirError(error);
    if (!pedido) throw new NotFoundException('No encontramos un pedido para esa transacción.');

    // Idempotencia: si ya se confirmó, se responde lo mismo sin volver a
    // llamar a Transbank (el retorno del navegador puede repetirse).
    if (this.estadoDe(pedido) === 'pagado') {
      return { ok: true, aprobada: true, pedido, mensaje: MENSAJE_PAGADO };
    }

    const r = (await webpay.confirmar(t)) as any;
    const montoEsperado = Math.round(Number(pedido.monto_total) || 0);
    const montoPagado = Math.round(Number(r?.monto) || 0);
    const coincide = montoPagado === montoEsperado;

    if (!r?.aprobada || !coincide) {
      await this.client
        .from(TABLA)
        .update({
          pago_estado: 'rechazado',
          pago_detalle: r?.crudo || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', pedido.id);
      await this.registrarEvento({
        solicitudId: Number(pedido.id), tipo: 'pago_rechazado', actorTipo: 'sistema',
        detalle: !coincide
          ? `El monto pagado ($${montoPagado.toLocaleString('es-CL')}) no coincide con el del pedido ($${montoEsperado.toLocaleString('es-CL')}).`
          : `Transbank no autorizó el pago (${r?.estado || 'sin estado'}).`,
        datos: r?.crudo || null,
      });
      return {
        ok: false,
        aprobada: false,
        pedido,
        mensaje: coincide
          ? 'El pago no fue autorizado. Puedes intentarlo nuevamente.'
          : 'El pago no coincide con el monto del pedido; no lo dimos por pagado. Contáctanos.',
      };
    }

    const actualizado = await this.mover(
      Number(pedido.id),
      ['validado_plataforma'],
      'pagado',
      {
        pago_estado: 'pagado',
        pago_medio: 'webpay',
        pago_at: new Date().toISOString(),
        pago_monto: montoPagado,
        pago_detalle: r?.crudo || null,
      },
      {
        tipo: 'pagado', actorTipo: 'cliente',
        detalle: `Pago autorizado por Transbank (${r?.autorizacion || 's/código'}).`,
        datos: { monto: montoPagado, buy_order: r?.buyOrder },
      },
    );
    await this.notificarPagoPlataforma(actualizado);
    return { ok: true, aprobada: true, pedido: actualizado, mensaje: MENSAJE_PAGADO };
  }

  /* Pago con crédito (punto 29): el particular con crédito habilitado puede
     cerrar el pedido sin pasar por Webpay. El cupo se mide contra el crédito
     ya comprometido en otros pedidos, para no pasarse del límite. */
  async pagarConCredito(id: number, rut: string, actorEmail: string) {
    const pedido = await this.obtener(id);
    if (String(pedido.rut) !== String(rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    if (this.estadoDe(pedido) !== 'validado_plataforma') {
      throw new BadRequestException('El pedido todavía no está validado por Amsodent.');
    }
    const monto = Math.round(Number(pedido.monto_total) || 0);
    const credito = await this.creditoDisponible(String(pedido.rut));
    if (!credito.habilitado) {
      throw new BadRequestException('Tu cuenta no tiene crédito habilitado. Puedes pagar con Webpay.');
    }
    if (monto > credito.disponible) {
      throw new BadRequestException(
        `El pedido ($${monto.toLocaleString('es-CL')}) supera tu crédito disponible ($${credito.disponible.toLocaleString('es-CL')}).`,
      );
    }

    const actualizado = await this.mover(
      id,
      ['validado_plataforma'],
      'pagado',
      {
        pago_estado: 'pagado',
        pago_medio: 'credito',
        pago_at: new Date().toISOString(),
        pago_monto: monto,
      },
      {
        tipo: 'pagado', actorTipo: 'cliente', actorEmail,
        detalle: `Pedido cerrado con crédito (cupo disponible antes: $${credito.disponible.toLocaleString('es-CL')}).`,
        datos: { monto, medio: 'credito' },
      },
    );
    await this.notificarPagoPlataforma(actualizado);
    return { ok: true, pedido: actualizado, mensaje: MENSAJE_PAGADO };
  }

  /* Cupo de crédito del cliente: lo que tiene autorizado menos lo que ya
     comprometió en pedidos cerrados con crédito y aún no facturados/pagados.
     Si las columnas no están migradas, se responde "sin crédito". */
  async creditoDisponible(rut: string) {
    const vacio = { habilitado: false, cupo: 0, usado: 0, disponible: 0, dias: null as number | null };
    try {
      const rutLimpio = String(rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
      const { data: clientes, error } = await this.client
        .from('clientes')
        .select('rut, credito_habilitado, credito_monto, credito_dias');
      if (error) throw new Error(error.message);
      const cli = (clientes || []).find(
        (c: any) => String(c?.rut || '').replace(/[^0-9kK]/g, '').toLowerCase() === rutLimpio,
      );
      if (!cli?.credito_habilitado) return vacio;
      const cupo = Math.round(Number(cli.credito_monto) || 0);

      const { data: usados } = await this.client
        .from(TABLA)
        .select('monto_total, pago_medio, flujo_estado')
        .eq('rut', rut)
        .eq('pago_medio', 'credito')
        .eq('flujo_estado', 'pagado');
      const usado = (usados || []).reduce((acc: number, p: any) => acc + (Number(p.monto_total) || 0), 0);
      return {
        habilitado: true,
        cupo,
        usado,
        disponible: Math.max(0, cupo - usado),
        dias: cli.credito_dias ?? null,
      };
    } catch (e: any) {
      this.logger.warn(`No se pudo calcular el crédito de ${rut}: ${e?.message || e}`);
      return vacio;
    }
  }

  private async notificarPagoPlataforma(pedido: any) {
    try {
      const { data: destinatarios } = await this.client
        .from('stock_destinatarios')
        .select('user_email, activo')
        .eq('activo', true);
      const rows = (destinatarios || [])
        .filter((d: any) => d?.user_email)
        .map((d: any) => ({
          user_email: String(d.user_email).toLowerCase(),
          tipo: 'pedido_portal_pagado',
          mensaje: `${pedido.razon_social || pedido.rut} pagó el pedido N° ${pedido.id} ($${Number(pedido.monto_total || 0).toLocaleString('es-CL')}). Plazo de despacho: 48-72 hrs.`,
          link: `/pedidos-portal?pedido=${pedido.id}`,
          metadata: { solicitud_id: pedido.id, pagado: true },
        }));
      if (rows.length) await this.client.from('notificaciones').insert(rows);
    } catch (e: any) {
      this.logger.warn(`No se pudo notificar el pago del pedido ${pedido?.id}: ${e?.message || e}`);
    }
  }

  /* ── Reversa (punto 14): un paso atrás mientras no esté pagado ───────── */
  async revertir(id: number, motivo: string, actor: { tipo: 'cliente' | 'plataforma'; email: string }) {
    const pedido = await this.obtener(id);
    const actual = this.estadoDe(pedido);
    if (actual === 'pagado') {
      throw new BadRequestException(
        'El pedido ya está pagado: no se puede revertir. Si el cliente quiere otros productos, hay que crear un pedido nuevo.',
      );
    }
    const idx = ORDEN.indexOf(actual);
    if (idx <= 0) {
      throw new BadRequestException('El pedido ya está en la primera etapa.');
    }
    const destino = ORDEN[idx - 1];
    const limpieza: Record<string, any> = {};
    // Al retroceder se borra lo que produjo la etapa que se deshace, para que
    // no queden datos de una validación que ya no vale.
    if (actual === 'validado_plataforma') {
      Object.assign(limpieza, {
        validado_at: null, validado_por: null, disponibilidad: null,
        pago_link: null, pago_estado: null, pago_monto: null, monto_total: null,
      });
    }
    if (actual === 'aprobado_cliente') {
      Object.assign(limpieza, { aprobado_cliente_at: null, aprobado_cliente_por: null });
    }

    const { data, error } = await this.client
      .from(TABLA)
      .update({ ...limpieza, flujo_estado: destino, updated_at: new Date().toISOString() })
      .eq('id', Number(id))
      .select()
      .single();
    if (error) this.traducirError(error);

    await this.registrarEvento({
      solicitudId: Number(id),
      tipo: 'reversa',
      estadoDesde: actual,
      estadoHasta: destino,
      actorTipo: actor.tipo,
      actorEmail: actor.email,
      detalle: String(motivo || '').slice(0, 300) || 'Sin motivo indicado.',
    });
    return { ok: true, pedido: data };
  }

  /* ── SOS: despacho comprometido en 24 hrs (punto 17) ─────────────────── */
  async marcarSos(id: number, motivo: string, actor: { tipo: 'cliente' | 'plataforma'; email: string }) {
    const pedido = await this.obtener(id);
    const { data, error } = await this.client
      .from(TABLA)
      .update({
        sos: true,
        sos_motivo: String(motivo || '').slice(0, 300) || null,
        sos_solicitado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(id))
      .select()
      .single();
    if (error) this.traducirError(error);
    await this.registrarEvento({
      solicitudId: Number(id),
      tipo: 'sos',
      estadoDesde: this.estadoDe(pedido),
      estadoHasta: this.estadoDe(pedido),
      actorTipo: actor.tipo,
      actorEmail: actor.email,
      detalle: `SOS: despacho en 24 hrs. ${String(motivo || '').slice(0, 250)}`,
    });
    await this.notificarSos(data);
    return { ok: true, pedido: data };
  }

  async quitarSos(id: number, actor: { tipo: 'cliente' | 'plataforma'; email: string }) {
    const { data, error } = await this.client
      .from(TABLA)
      .update({ sos: false, updated_at: new Date().toISOString() })
      .eq('id', Number(id))
      .select()
      .single();
    if (error) this.traducirError(error);
    await this.registrarEvento({
      solicitudId: Number(id), tipo: 'sos', actorTipo: actor.tipo,
      actorEmail: actor.email, detalle: 'SOS retirado.',
    });
    return { ok: true, pedido: data };
  }

  /* ── KPI de tiempos de respuesta (punto 18) ──────────────────────────── */
  async kpis(desde?: string, hasta?: string) {
    let q = this.client
      .from(TABLA)
      .select('id, created_at, aprobado_cliente_at, validado_at, pago_at, flujo_estado, sos, monto_total');
    if (desde) q = q.gte('created_at', desde);
    if (hasta) q = q.lte('created_at', `${hasta}T23:59:59`);
    const { data, error } = await q;
    if (error) this.traducirError(error);
    const filas = data || [];

    const horas = (a?: string | null, b?: string | null) => {
      if (!a || !b) return null;
      const ms = new Date(b).getTime() - new Date(a).getTime();
      return ms >= 0 ? ms / 3600000 : null;
    };
    const prom = (xs: Array<number | null>) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)) : null;
    };

    return {
      total: filas.length,
      por_estado: ORDEN.concat(['rechazado', 'cancelado'] as any).reduce((acc: Record<string, number>, e) => {
        acc[e] = filas.filter((f: any) => (f.flujo_estado || 'pendiente_aprobacion') === e).length;
        return acc;
      }, {}),
      sos: filas.filter((f: any) => f.sos).length,
      monto_pagado: filas
        .filter((f: any) => f.flujo_estado === 'pagado')
        .reduce((acc: number, f: any) => acc + (Number(f.monto_total) || 0), 0),
      // Horas promedio de cada tramo. Son los tiempos de respuesta que pidió
      // el punto 18: cuánto demora el cliente en aprobar, cuánto demoramos
      // nosotros en validar, y cuánto tarda el pago.
      horas_a_aprobacion: prom(filas.map((f: any) => horas(f.created_at, f.aprobado_cliente_at))),
      horas_a_validacion: prom(filas.map((f: any) => horas(f.aprobado_cliente_at, f.validado_at))),
      horas_a_pago: prom(filas.map((f: any) => horas(f.validado_at, f.pago_at))),
      horas_total: prom(filas.map((f: any) => horas(f.created_at, f.pago_at))),
    };
  }

  /* ── Avisos ─────────────────────────────────────────────────────────── */

  private async notificarPlataforma(pedido: any) {
    try {
      const { data: destinatarios } = await this.client
        .from('stock_destinatarios')
        .select('user_email, recibe_campana, activo')
        .eq('activo', true);
      const rows = (destinatarios || [])
        .filter((d: any) => d?.user_email && d.recibe_campana !== false)
        .map((d: any) => ({
          user_email: String(d.user_email).toLowerCase(),
          tipo: 'pedido_portal_aprobado',
          mensaje: `${pedido.razon_social || pedido.rut} aprobó el pedido N° ${pedido.id}: hay que validar existencias.`,
          link: `/pedidos-portal?pedido=${pedido.id}`,
          metadata: { solicitud_id: pedido.id, rut: pedido.rut },
        }));
      if (rows.length) await this.client.from('notificaciones').insert(rows);
    } catch (e: any) {
      this.logger.warn(`No se pudo notificar la aprobación del pedido ${pedido?.id}: ${e?.message || e}`);
    }
  }

  private async avisarClienteValidado(pedido: any) {
    const disponibilidad: any[] = Array.isArray(pedido?.disponibilidad) ? pedido.disponibilidad : [];
    const faltantes = disponibilidad.filter((d) => Number(d.cantidad_disponible) < Number(d.cantidad_solicitada));
    const detalle = disponibilidad
      .map((d) => `· ${d.nombre}: ${d.cantidad_disponible} de ${d.cantidad_solicitada} disponible(s)`)
      .join('\n');

    // Mensaje en el hilo del pedido: lo ve en el portal sin salir de ahí.
    try {
      await this.client.from('stock_cotizacion_mensajes').insert({
        solicitud_id: Number(pedido.id),
        autor_tipo: 'equipo',
        autor_nombre: 'Amsodent',
        mensaje: [
          'Revisamos tu pedido y confirmamos existencias:',
          detalle,
          faltantes.length
            ? `\nOjo: ${faltantes.length} producto(s) no tienen stock completo; el monto considera lo disponible.`
            : '',
          `\nTotal a pagar: $${Number(pedido.monto_total || 0).toLocaleString('es-CL')}`,
          pedido.pago_link ? `\nPuedes pagar aquí: ${pedido.pago_link}` : '',
        ].filter(Boolean).join('\n'),
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo dejar el mensaje de validación en el pedido ${pedido?.id}: ${e?.message || e}`);
    }

    // Y por correo, al contacto del pedido.
    const para = String(pedido?.contacto_email || '').trim();
    if (!para) return;
    try {
      await this.mailings.enviarUno({
        para,
        asunto: `Tu pedido N° ${pedido.id} está listo para pagar`,
        cuerpoHtml: `
          <p>Hola${pedido.contacto_nombre ? ` ${pedido.contacto_nombre}` : ''},</p>
          <p>Revisamos tu pedido y confirmamos las existencias:</p>
          <pre style="font-family:inherit;white-space:pre-wrap">${detalle}</pre>
          ${faltantes.length ? `<p><strong>${faltantes.length} producto(s)</strong> no tienen stock completo; el monto considera lo disponible.</p>` : ''}
          <p><strong>Total a pagar: $${Number(pedido.monto_total || 0).toLocaleString('es-CL')}</strong></p>
          ${pedido.pago_link ? `<p><a href="${pedido.pago_link}">Pagar ahora</a></p>` : ''}
          <p>Amsodent Medical Spa</p>`,
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo enviar el correo de validación del pedido ${pedido?.id}: ${e?.message || e}`);
    }
  }

  private async notificarSos(pedido: any) {
    try {
      const { data: destinatarios } = await this.client
        .from('stock_destinatarios')
        .select('user_email, activo')
        .eq('activo', true);
      const rows = (destinatarios || [])
        .filter((d: any) => d?.user_email)
        .map((d: any) => ({
          user_email: String(d.user_email).toLowerCase(),
          tipo: 'pedido_portal_sos',
          mensaje: `SOS en el pedido N° ${pedido.id} de ${pedido.razon_social || pedido.rut}: despacho comprometido en 24 hrs.`,
          link: `/pedidos-portal?pedido=${pedido.id}`,
          metadata: { solicitud_id: pedido.id, sos: true },
        }));
      if (rows.length) await this.client.from('notificaciones').insert(rows);
    } catch (e: any) {
      this.logger.warn(`No se pudo notificar el SOS del pedido ${pedido?.id}: ${e?.message || e}`);
    }
  }
}

export function etiquetaEstado(e: string): string {
  return (
    {
      pendiente_aprobacion: 'Pendiente de aprobación',
      aprobado_cliente: 'Aprobado por el cliente',
      validado_plataforma: 'Validado y por pagar',
      pagado: 'Pagado',
      rechazado: 'Rechazado',
      cancelado: 'Cancelado',
    } as Record<string, string>
  )[e] || e;
}

function linkDePago(id: number): string {
  const base = String(process.env.PORTAL_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');
  return `${base}/portal-cliente?pagar=${id}`;
}
