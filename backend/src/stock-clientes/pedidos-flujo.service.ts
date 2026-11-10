import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MailingsService } from '../mailings/mailings.service';
import { OfertasPortalService } from './ofertas-portal.service';
import { PortalModulosService } from './portal-modulos.service';
import { destinatariosCampanaPedido } from './destinatarios-pedido';
import {
  ESTADOS_COTIZABLES,
  ESTADOS_OBSERVABLES,
  ESTADOS_TOMABLES,
  ESTADOS_VALIDABLES,
  FlujoEstado,
  LIMPIEZA_MODIFICACION,
  TODOS,
  columnaFaltante,
  esCerrado,
  estadoAlReabrir,
  etapaAnterior,
  etiquetaEstado,
} from './pedidos-flujo-etapas';

export { etiquetaEstado } from './pedidos-flujo-etapas';
export type { FlujoEstado } from './pedidos-flujo-etapas';

/* ── Flujo de aprobación y pago de los pedidos del portal (2026-09-16) ────
   Un pedido recorre estas etapas, cada una con responsable y hora:

     pendiente_aprobacion → aprobado_cliente → en_revision → cotizacion_enviada
                          → validado_plataforma → pagado

   · pendiente_aprobacion  el asistente armó el pedido y espera al
                           administrador de la cuenta del cliente.
   · aprobado_cliente      lo aprobó ese administrador. Amsodent se entera y
                           al cliente se le promete respuesta en 24-48 hrs.
   · en_revision           (2026-11-09) alguien de Amsodent tomó el pedido.
   · cotizacion_enviada    (2026-11-09) se vinculó una cotización; el cliente
                           la revisa y la da por buena o pide cambios.
   · observado             (2026-11-09) parada lateral: Amsodent necesita una
                           respuesta del cliente antes de seguir.
   · validado_plataforma   Amsodent confirmó existencias producto por producto
                           y emitió el link de pago.
   · pagado                Webpay confirmó el pago: 48-72 hrs para despachar.
   · rechazado             (2026-11-09) Amsodent lo rechazó con motivo.

   La REVERSA es válida en cualquier etapa mientras el pedido no esté pagado
   (cambió un producto, no había stock, el cliente se arrepintió). Una vez
   pagado el pedido se cierra: los productos nuevos van en un pedido nuevo.
   Las etapas, su orden y qué limpia cada reversa viven en
   pedidos-flujo-etapas.ts, que se prueba solo. */

export const MENSAJE_APROBADO_CLIENTE =
  'Se revisará tu solicitud, en un plazo de 24-48 hrs.';
export const MENSAJE_PAGADO =
  'Tienen un plazo de 48 a 72 hrs para despachar el pedido.';

const TABLA = 'stock_solicitudes_cotizacion';
const TABLA_EVENTOS = 'stock_solicitud_eventos';
// IVA que se agrega sobre los precios netos al calcular el monto a pagar.
const IVA_PEDIDO = 0.19;

@Injectable()
export class PedidosFlujoService {
  private readonly logger = new Logger(PedidosFlujoService.name);

  constructor(
    private supabase: SupabaseService,
    private mailings: MailingsService,
    private ofertas: OfertasPortalService,
    // Módulos del portal por cliente (2026-10-05). Opcional para las pruebas.
    @Optional() private modulosPortal?: PortalModulosService,
  ) {}

  private get client() {
    return this.supabase.getClient();
  }

  /* La migración 20260916 puede no estar aplicada todavía: en ese caso el
     flujo no existe y lo decimos claro en vez de fallar con un error de
     Postgres que nadie entiende. */
  private traducirError(error: any): never {
    const msg = String(error?.message || error);
    // (2026-11-09) Las etapas nuevas las rechaza la restricción de la columna
    // hasta que corra su migración; y sus columnas no existen.
    if (
      /stock_solicitudes_flujo_chk/.test(msg) ||
      (/revision_|cotizacion_enviada|observacion_|rechaz(o|ado)_/.test(msg) && /column|does not exist|schema cache/i.test(msg))
    ) {
      throw new BadRequestException(
        'Falta aplicar la migración 20261109_pedidos_estados_intermedios.sql en Supabase (etapas nuevas del pedido).',
      );
    }
    if (/flujo_estado|stock_solicitud_eventos|disponibilidad|pago_estado/.test(msg) && /column|does not exist|schema cache/i.test(msg)) {
      throw new BadRequestException(
        'Falta aplicar la migración 20260916_pedidos_flujo_aprobacion.sql en Supabase.',
      );
    }
    throw new BadRequestException(msg);
  }

  /* UPDATE que tolera columnas de migraciones sin aplicar: si Supabase dice
     que una columna no existe, se quita del parche y se reintenta, para que
     lo esencial (la etapa, los productos) se guarde igual. La etapa misma no
     se negocia: sin ella el flujo no existe. */
  private async actualizarTolerante(id: number, parche: Record<string, any>) {
    const pendiente: Record<string, any> = { ...parche };
    for (let intento = 0; intento < 8; intento++) {
      const { data, error } = await this.client.from(TABLA).update(pendiente).eq('id', Number(id)).select().single();
      if (!error) return data;
      const col = columnaFaltante(error.message);
      if (!col || !(col in pendiente) || col === 'flujo_estado') this.traducirError(error);
      this.logger.warn(`Columna «${col}» sin migrar en ${TABLA}: el pedido ${id} se guarda sin ella.`);
      delete pendiente[col];
    }
    throw new BadRequestException('No se pudo guardar el pedido.');
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

  /* ── Historial de actividad de una cuenta del portal (2026-09-24) ────────
     Hasta ahora la traza existía solo por pedido: para saber qué había pasado
     en la cuenta había que abrir uno por uno. Esto junta, en orden, los
     eventos de TODOS los pedidos del RUT y los completa con lo que se anota
     en `portal_actividades` (ingresos, documentos subidos, avisos de
     despacho), que no cuelga de ningún pedido.

     Lo leen los dos lados: el cliente en su portal y Amsodent en la bandeja
     de pedidos, con la misma forma, para que ambos vean lo mismo. */
  async historialDeCuenta(rut: string, limite = 120) {
    const tope = Math.max(1, Math.min(300, Number(limite) || 120));

    // Pedidos de la cuenta: sus ids son el puente hacia los eventos.
    const { data: pedidos } = await this.client
      .from(TABLA)
      .select('id, created_at, items, flujo_estado, origen_seccion')
      .eq('rut', rut)
      .order('id', { ascending: false })
      .limit(tope);
    const ids = (pedidos || []).map((p: any) => Number(p.id));
    const porId = new Map<number, any>((pedidos || []).map((p: any) => [Number(p.id), p]));

    const filas: Array<{
      fecha: string;
      tipo: string;
      titulo: string;
      detalle: string | null;
      actor: string | null;
      origen: 'cliente' | 'plataforma' | 'sistema';
      solicitud_id: number | null;
    }> = [];

    if (ids.length) {
      const { data: eventos } = await this.client
        .from(TABLA_EVENTOS)
        .select('solicitud_id, tipo, estado_desde, estado_hasta, actor_tipo, actor_email, detalle, created_at')
        .in('solicitud_id', ids)
        .order('created_at', { ascending: false })
        .limit(tope * 4);
      for (const e of eventos || []) {
        const pedido = porId.get(Number((e as any).solicitud_id));
        const cuantos = Array.isArray(pedido?.items) ? pedido.items.length : 0;
        filas.push({
          fecha: (e as any).created_at,
          tipo: String((e as any).tipo || 'evento'),
          titulo: `Pedido N° ${(e as any).solicitud_id}${cuantos ? ` · ${cuantos} producto${cuantos === 1 ? '' : 's'}` : ''}`,
          detalle: (e as any).detalle || null,
          actor: (e as any).actor_email || null,
          origen: ((e as any).actor_tipo || 'sistema') as any,
          solicitud_id: Number((e as any).solicitud_id),
        });
      }
    }

    // Actividades que no cuelgan de un pedido. Si la tabla aún no está
    // migrada, el historial se arma igual con los eventos.
    const { data: sueltas } = await this.client
      .from('portal_actividades')
      .select('tipo, descripcion, actor_email, actor_nombre, origen, solicitud_id, created_at')
      .eq('cliente_rut', rut)
      .order('created_at', { ascending: false })
      .limit(tope);
    for (const a of sueltas || []) {
      filas.push({
        fecha: (a as any).created_at,
        tipo: String((a as any).tipo || 'actividad'),
        titulo: String((a as any).descripcion || '').slice(0, 200),
        detalle: null,
        actor: (a as any).actor_nombre || (a as any).actor_email || null,
        origen: (a as any).origen === 'amsodent' ? 'plataforma' : 'cliente',
        solicitud_id: (a as any).solicitud_id ?? null,
      });
    }

    filas.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return filas.slice(0, tope);
  }

  /* ── Actividad por pedido (2026-10-02) ──────────────────────────────────
     La pestaña Actividad del portal era una sola lista con todo mezclado: para
     seguir un pedido había que ir saltando entre líneas de otros. Esto arma
     UNA LÍNEA DE TIEMPO POR PEDIDO, en el orden en que pasaron las cosas, con
     el detalle de cada paso.

     Los pasos salen de cuatro fuentes, porque no todo quedó como evento:
       · el propio pedido      → cuándo se envió y cuándo se generó su cotización;
       · sus eventos           → aprobación, validaciones, modificaciones, pagos;
       · avisos del portal     → cotización aprobada, despacho en camino;
       · documentos de la cotización → guías de despacho y facturas.
     Lo que no pertenece a ningún pedido va aparte, en `otras`. */
  async actividadPorPedido(rut: string, limite = 40) {
    const tope = Math.max(1, Math.min(100, Number(limite) || 40));
    const $ = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
    const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

    const { data: pedidos, error } = await this.client
      .from(TABLA)
      .select('*')
      .eq('rut', rut)
      .order('id', { ascending: false })
      .limit(tope);
    if (error) this.traducirError(error);
    const lista: any[] = pedidos || [];
    const ids = lista.map((p) => Number(p.id));
    const licIds = [...new Set(lista.map((p) => Number(p.licitacion_id)).filter((x) => Number.isFinite(x) && x > 0))];

    // Cada consulta es independiente y tolerante: si una tabla falta o falla,
    // la línea de tiempo sale igual con lo demás.
    const leer = async (q: any): Promise<any[]> => {
      try {
        const { data, error: e } = await q;
        return e ? [] : data || [];
      } catch {
        return [];
      }
    };
    const [eventos, avisos, cotizaciones, documentos] = await Promise.all([
      ids.length
        ? leer(this.client.from(TABLA_EVENTOS).select('*').in('solicitud_id', ids).order('created_at', { ascending: true }))
        : [],
      leer(this.client.from('portal_actividades').select('*').eq('cliente_rut', rut).order('created_at', { ascending: true }).limit(400)),
      licIds.length
        ? leer(this.client.from('licitaciones').select('id, id_licitacion, estado, total_con_iva, created_at').in('id', licIds))
        : [],
      licIds.length
        ? leer(
            this.client
              .from('licitacion_documentos')
              .select('id, licitacion_id, tipo, numero, fecha_oc, fecha_factura, created_at, empresa_despacho, n_seguimiento')
              .in('licitacion_id', licIds)
              .in('tipo', ['guia_despacho', 'info_despacho', 'factura', 'factura_boleta']),
          )
        : [],
    ]);
    const cotPorId = new Map<number, any>(cotizaciones.map((l: any) => [Number(l.id), l] as [number, any]));

    type Paso = {
      fecha: string;
      tipo: string;
      titulo: string;
      detalle: string | null;
      actor: string | null;
      lado: 'cliente' | 'amsodent' | 'sistema';
      cambios?: Array<{ accion: string; nombre: string; sku: string | null; cantidad: number; cantidad_anterior: number | null }>;
    };
    const ORIGEN: Record<string, string> = {
      ofertas: 'las Ofertas especiales',
      showroom: 'el Showroom',
      explorador: 'el Explorador de precios',
      stock: 'Gestión de Stock',
    };
    const nombreDe = (correo: any) => String(correo || '').split('@')[0] || null;
    const lado = (t: any): Paso['lado'] => (t === 'plataforma' ? 'amsodent' : t === 'cliente' ? 'cliente' : 'sistema');

    // Cómo se cuenta cada evento. El texto guardado en el evento está escrito
    // para la bandeja de Amsodent ("El cliente…"); acá se redacta neutro,
    // porque esto lo lee el propio cliente.
    const deEvento = (e: any): Paso => {
      const d = e?.datos || {};
      const base = { fecha: e.created_at, tipo: String(e.tipo || 'evento'), actor: nombreDe(e.actor_email), lado: lado(e.actor_tipo) };
      switch (e.tipo) {
        case 'aprobado_cliente':
          return { ...base, titulo: 'Pedido aprobado', detalle: 'El administrador de la cuenta aprobó el pedido y pasó a revisión de Amsodent.' };
        case 'cotizacion_validada_cliente':
          return { ...base, titulo: 'Cotización validada', detalle: 'Se revisó la cotización y se dio por buena.' };
        case 'modificacion_pedida': {
          const cambios = (Array.isArray(d.detalle) ? d.detalle : [])
            .filter((x: any) => x?.accion && x.accion !== 'mantiene')
            .map((x: any) => ({
              accion: String(x.accion),
              nombre: String(x.nombre || ''),
              sku: x.sku || null,
              cantidad: Number(x.cantidad) || 0,
              cantidad_anterior: x.cantidad_anterior == null ? null : Number(x.cantidad_anterior),
            }));
          return {
            ...base,
            titulo: 'Pedido modificado',
            detalle: cambios.length ? 'Se cambiaron productos del pedido; Amsodent vuelve a revisarlo.' : 'Se pidió una modificación del pedido.',
            cambios,
          };
        }
        case 'validado':
          return {
            ...base,
            titulo: 'Existencias confirmadas',
            detalle:
              [d.items ? plural(Number(d.items), 'producto confirmado', 'productos confirmados') : '', d.monto ? `total a pagar ${$(d.monto)}` : '']
                .filter(Boolean)
                .join(' · ') || 'Amsodent confirmó las existencias y dejó el pedido listo para pagar.',
          };
        case 'pago_iniciado':
          return { ...base, titulo: 'Pago iniciado', detalle: [d.monto ? $(d.monto) : '', d.buy_order ? `orden ${d.buy_order}` : ''].filter(Boolean).join(' · ') || null };
        case 'pago_rechazado':
          return { ...base, titulo: 'Pago no completado', detalle: 'El pago no se autorizó. Se puede volver a intentar.' };
        case 'pagado':
          return { ...base, titulo: 'Pago recibido', detalle: [d.monto ? $(d.monto) : '', String(e.detalle || '').replace(/\.$/, '')].filter(Boolean).join(' · ') || null };
        case 'reversa':
          return { ...base, titulo: 'Pedido devuelto a la etapa anterior', detalle: e.detalle || null };
        case 'sos':
          return { ...base, titulo: /retirado/i.test(String(e.detalle || '')) ? 'Despacho urgente retirado' : 'Despacho urgente solicitado (SOS)', detalle: e.detalle || null };
        // (2026-11-09) Etapas intermedias de la validación.
        case 'revision_iniciada':
          return { ...base, titulo: 'Amsodent tomó el pedido', detalle: base.actor ? `${base.actor} está revisando el pedido.` : 'El pedido está en revisión.' };
        case 'cotizacion_enviada':
          return { ...base, titulo: 'Cotización enviada', detalle: d.licitacion_id ? `Cotización #${d.licitacion_id} lista para revisar en Mis cotizaciones.` : 'La cotización quedó disponible en Mis cotizaciones.' };
        case 'observado':
          return { ...base, titulo: 'Observación de Amsodent', detalle: e.detalle || 'Amsodent necesita una respuesta para seguir con el pedido.' };
        case 'observacion_respondida':
          return { ...base, titulo: 'Observación respondida', detalle: e.detalle || 'Se aceptó seguir con el pedido.' };
        case 'rechazado':
          return { ...base, titulo: 'Pedido rechazado por Amsodent', detalle: e.detalle || null };
        case 'cancelado':
          return { ...base, titulo: 'Pedido cancelado', detalle: e.detalle || null };
        case 'reabierto':
          return { ...base, titulo: 'Pedido reabierto', detalle: e.detalle || null };
        default:
          return { ...base, titulo: 'Actualización del pedido', detalle: e.detalle || null };
      }
    };
    const deAviso = (a: any): Paso => ({
      fecha: a.created_at,
      tipo: String(a.tipo || 'aviso'),
      titulo:
        a.tipo === 'cotizacion_aprobada' ? 'Cotización aprobada por Amsodent'
        : a.tipo === 'despacho_en_curso' ? 'Despacho en camino'
        : String(a.descripcion || 'Aviso').slice(0, 120),
      detalle: ['cotizacion_aprobada', 'despacho_en_curso'].includes(a.tipo) ? String(a.descripcion || '') || null : null,
      actor: a.actor_nombre || nombreDe(a.actor_email),
      lado: a.origen === 'amsodent' ? 'amsodent' : 'cliente',
    });

    const avisosUsados = new Set<any>();
    const salida = lista.map((p) => {
      const items: any[] = Array.isArray(p.items) ? p.items : [];
      const cot = p.licitacion_id ? cotPorId.get(Number(p.licitacion_id)) : null;
      const pasos: Paso[] = [];

      pasos.push({
        fecha: p.created_at,
        tipo: 'enviado',
        titulo: 'Pedido enviado',
        detalle: `${plural(items.length, 'producto', 'productos')}${ORIGEN[p.origen_seccion] ? ` desde ${ORIGEN[p.origen_seccion]}` : ''}.`,
        actor: nombreDe(p.creado_por_email),
        lado: 'cliente',
      });
      if (cot) {
        pasos.push({
          fecha: p.respondida_at || cot.created_at || p.created_at,
          tipo: 'cotizacion',
          titulo: 'Cotización generada',
          detalle: [`N° ${cot.id_licitacion || cot.id}`, Number(cot.total_con_iva) > 0 ? `total ${$(cot.total_con_iva)} con IVA` : ''].filter(Boolean).join(' · '),
          actor: null,
          lado: 'amsodent',
        });
      }
      for (const e of eventos) if (Number(e.solicitud_id) === Number(p.id)) pasos.push(deEvento(e));
      for (const a of avisos) {
        const esDeEste = Number(a.solicitud_id) === Number(p.id) || (a.licitacion_id && Number(a.licitacion_id) === Number(p.licitacion_id));
        if (!esDeEste) continue;
        avisosUsados.add(a);
        pasos.push(deAviso(a));
      }
      for (const d of documentos) {
        if (Number(d.licitacion_id) !== Number(p.licitacion_id)) continue;
        const esDespacho = d.tipo === 'guia_despacho' || d.tipo === 'info_despacho';
        pasos.push({
          fecha: (esDespacho ? d.fecha_oc : d.fecha_factura || d.fecha_oc) || d.created_at,
          tipo: esDespacho ? 'despacho' : 'factura',
          titulo: esDespacho ? `Despacho${d.numero ? ` · guía N° ${d.numero}` : ''}` : `${d.tipo === 'factura_boleta' ? 'Factura / boleta' : 'Factura'}${d.numero ? ` N° ${d.numero}` : ''} emitida`,
          detalle: esDespacho
            ? [d.empresa_despacho, d.n_seguimiento ? `seguimiento ${d.n_seguimiento}` : ''].filter(Boolean).join(' · ') || null
            : null,
          actor: null,
          lado: 'amsodent',
        });
      }
      // En el orden en que pasaron. Las fechas sin hora (documentos) van al
      // final de su día para no adelantarse a lo que sí tiene hora.
      const clave = (f: any) => { const t = String(f || ''); return t.length <= 10 ? `${t}T23:59:59` : t; };
      pasos.sort((a, b) => clave(a.fecha).localeCompare(clave(b.fecha)));

      return {
        id: Number(p.id),
        creado: p.created_at,
        etapa: this.estadoDe(p),
        origen: p.origen_seccion || null,
        monto: Number(p.monto_total) || Number(cot?.total_con_iva) || items.reduce((acc, i) => acc + (Number(i?.precio_referencia) || 0) * (Number(i?.cantidad) || 0), 0) || null,
        cotizacion: cot ? { id: cot.id, codigo: cot.id_licitacion || String(cot.id), estado: cot.estado || null } : null,
        productos: items.map((i) => ({
          nombre: String(i?.nombre || ''),
          sku: i?.sku || null,
          cantidad: Number(i?.cantidad) || 0,
          unidad: i?.unidad || null,
          oferta: i?.oferta ? `Oferta −${Number(i.oferta.descuento_pct)}%` : null,
        })),
        pasos,
      };
    });

    const otras = avisos.filter((a: any) => !avisosUsados.has(a)).map(deAviso).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return { pedidos: salida, otras };
  }

  /** Anota una actividad del portal que no cuelga de un pedido. Best-effort:
      nunca hace fallar la acción que la origina. */
  async anotarActividad(args: {
    rut: string;
    tipo: string;
    descripcion: string;
    actorEmail?: string | null;
    actorNombre?: string | null;
    origen?: 'portal' | 'amsodent';
    solicitudId?: number | null;
    licitacionId?: number | null;
    metadata?: Record<string, any> | null;
  }) {
    try {
      await this.client.from('portal_actividades').insert({
        cliente_rut: args.rut,
        tipo: args.tipo,
        descripcion: args.descripcion.slice(0, 400),
        actor_email: args.actorEmail ?? null,
        actor_nombre: args.actorNombre ?? null,
        origen: args.origen ?? 'portal',
        solicitud_id: args.solicitudId ?? null,
        licitacion_id: args.licitacionId ?? null,
        metadata: args.metadata ?? null,
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo anotar la actividad del portal (${args.tipo}): ${e?.message || e}`);
    }
  }

  /** Avisos del portal que el cliente todavía no ha visto (la campana). */
  async avisosSinLeer(rut: string) {
    const { data, error } = await this.client
      .from('portal_actividades')
      .select('id, tipo, descripcion, solicitud_id, created_at')
      .eq('cliente_rut', rut)
      .is('leido_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return [];
    return data || [];
  }

  async marcarAvisosLeidos(rut: string) {
    try {
      await this.client
        .from('portal_actividades')
        .update({ leido_at: new Date().toISOString() })
        .eq('cliente_rut', rut)
        .is('leido_at', null);
    } catch { /* tabla sin migrar */ }
    return { ok: true };
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
    const data = await this.actualizarTolerante(id, { ...extra, flujo_estado: hasta, updated_at: new Date().toISOString() });
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

  /* ── El cliente revisa la cotización que recibió (2026-09-24) ────────────
     Hasta ahora, cuando Amsodent validaba el pedido y mandaba el link de pago,
     el cliente solo podía pagar: no tenía forma de decir "está bien" sin pagar
     todavía, ni de pedir cambios sin llamar por teléfono. */

  /** Da por buena la cotización recibida. No cobra ni mueve la etapa: deja
      constancia de que el cliente la revisó y la acepta. */
  async validarComoCliente(id: number, actorEmail: string, rut: string) {
    const pedido = await this.obtener(id);
    if (String(pedido.rut) !== String(rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    /* (2026-09-24, corregido) Lo que habilita validar es TENER la cotizacion,
       no la etapa del pago. El cliente la recibe en cuanto se le vincula una
       (la ve con su numero y su PDF en el portal), y eso pasa mientras el
       pedido sigue "en revision de Amsodent": exigir `validado_plataforma`
       dejaba el boton invisible justo cuando tenia sentido apretarlo. */
    if (!pedido.licitacion_id) {
      throw new BadRequestException('Todavia no hay una cotizacion que validar para este pedido.');
    }
    const etapa = this.estadoDe(pedido);
    if (['pagado', 'cancelado', 'rechazado'].includes(etapa)) {
      throw new BadRequestException('Este pedido ya esta cerrado.');
    }
    if (pedido.validado_cliente_at) {
      return { ok: true, pedido, mensaje: 'Esta cotización ya estaba validada.' };
    }

    const ahora = new Date().toISOString();
    const { data, error } = await this.client
      .from(TABLA)
      .update({ validado_cliente_at: ahora, validado_cliente_por: actorEmail, updated_at: ahora })
      .eq('id', Number(id))
      .select()
      .single();
    // La migracion 20260924 puede no estar aplicada todavia: sin esas columnas
    // no hay donde dejar constancia, y decirlo es mejor que mostrar el error
    // crudo de Postgres o fingir que se guardo.
    if (error && /validado_cliente/.test(error.message)) {
      throw new BadRequestException(
        'Falta aplicar la migracion 20260924_lote_portal_showroom.sql en Supabase para poder validar la cotizacion.',
      );
    }
    if (error) this.traducirError(error);

    await this.registrarEvento({
      solicitudId: Number(id),
      tipo: 'cotizacion_validada_cliente',
      actorTipo: 'cliente',
      actorEmail,
      detalle: 'El cliente revisó la cotización y la dio por buena.',
    });
    // (2026-11-09) Antes nadie de Amsodent se enteraba de la conformidad: el
    // pedido quedaba esperando que alguien lo mirara de nuevo.
    await this.notificarEquipo(
      data,
      'pedido_portal_conforme',
      `${data.razon_social || data.rut} dio por buena la cotización del pedido N° ${data.id}: falta confirmar existencias y emitir el pago.`,
    );
    return { ok: true, pedido: data, mensaje: 'Gracias, registramos tu conformidad con la cotización.' };
  }

  /** El cliente pide cambios sobre la cotización recibida. Llega la lista
      completa desde su carrito — los productos que mantiene MÁS los nuevos —
      así que reemplaza a los `items` y guarda la lista anterior para poder
      comparar. Vuelve a "aprobado_cliente" porque Amsodent tiene que
      revalidar existencias y precios antes de volver a cobrar. */
  async pedirModificacion(
    id: number,
    body: {
      items?: Array<{ nombre?: string; sku?: string; cantidad?: number | string; unidad?: string; precio_referencia?: number | string; observacion?: string; oferta_id?: number | string; tienda?: string; url?: string }>;
      nota?: string;
    },
    actorEmail: string,
    rut: string,
  ) {
    const pedido = await this.obtener(id);
    if (String(pedido.rut) !== String(rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    const actual = this.estadoDe(pedido);
    if (actual === 'pagado') {
      throw new BadRequestException('Este pedido ya está pagado: para agregar productos hay que hacer uno nuevo.');
    }
    if (actual === 'cancelado' || actual === 'rechazado') {
      throw new BadRequestException('Este pedido está cerrado.');
    }

    const limpios = (Array.isArray(body?.items) ? body.items : [])
      .map((it) => ({
        nombre: String(it?.nombre || '').trim().slice(0, 200),
        sku: String(it?.sku || '').trim().slice(0, 80) || undefined,
        unidad: String(it?.unidad || '').trim().slice(0, 50) || null,
        cantidad: Number(it?.cantidad) || 0,
        ...(Number(it?.precio_referencia) > 0 ? { precio_referencia: Number(it.precio_referencia) } : {}),
        ...(String(it?.observacion || '').trim() ? { observacion: String(it.observacion).trim().slice(0, 300) } : {}),
        // De qué tienda salió y su enlace: sin esto, tras una modificación la
        // bandeja ya no sabía si la línea era de Amsodent o de otra tienda.
        ...(String(it?.tienda || '').trim() ? { tienda: String(it.tienda).trim().slice(0, 80) } : {}),
        ...(String(it?.url || '').trim() ? { url: String(it.url).trim().slice(0, 500) } : {}),
        // Línea de una oferta especial: se revalida abajo, igual que al crear el pedido.
        ...(Number(it?.oferta_id) > 0 && String(it?.sku || '').trim() ? { oferta_id: Number(it.oferta_id) } : {}),
      }))
      .filter((it) => it.nombre && it.cantidad > 0);
    // El precio de las líneas de oferta lo pone el servidor (si la oferta ya
    // no rige, vuelven al precio normal).
    // Sin Ofertas habilitada para el cliente, ninguna línea lleva precio de oferta.
    const ofertasOk = this.modulosPortal ? await this.modulosPortal.habilitado(String(pedido?.rut || ''), 'ofertas') : true;
    const nuevos: any[] = await this.ofertas.depurarSkusDeInventario(
      await this.ofertas.aplicarAItems((ofertasOk ? limpios : (limpios as any[]).map(({ oferta_id: _o, ...resto }: any) => resto)) as any[]),
    );
    if (!nuevos.length) {
      throw new BadRequestException('La modificación llegó sin productos.');
    }

    const anteriores: any[] = Array.isArray(pedido.items) ? pedido.items : [];
    const clave = (it: any) => `${String(it?.sku || '').trim().toLowerCase()}|${String(it?.nombre || '').trim().toLowerCase()}`;
    const antesPorClave = new Map(anteriores.map((it) => [clave(it), it]));
    const ahoraPorClave = new Map(nuevos.map((it) => [clave(it), it]));

    // Qué pasó con cada producto, para que la bandeja no tenga que deducirlo.
    const detalle = [
      ...nuevos.map((it) => {
        const antes = antesPorClave.get(clave(it));
        return {
          nombre: it.nombre,
          sku: it.sku ?? null,
          cantidad: it.cantidad,
          cantidad_anterior: antes ? Number(antes.cantidad) || 0 : null,
          accion: !antes ? 'agrega' : Number(antes.cantidad) !== it.cantidad ? 'cambia' : 'mantiene',
        };
      }),
      ...anteriores
        .filter((it) => !ahoraPorClave.has(clave(it)))
        .map((it) => ({
          nombre: String(it?.nombre || ''),
          sku: it?.sku ?? null,
          cantidad: 0,
          cantidad_anterior: Number(it?.cantidad) || 0,
          accion: 'quita',
        })),
    ];

    const ahora = new Date().toISOString();
    const parche: Record<string, any> = {
      items: nuevos,
      modificacion_pedida_at: ahora,
      modificacion_pedida_por: actorEmail,
      modificacion_detalle: detalle,
      // Amsodent tiene que volver a confirmar existencias y precio, así que la
      // disponibilidad y el monto anteriores dejan de valer.
      disponibilidad: null,
      monto_total: null,
      pago_link: null,
      validado_cliente_at: null,
      validado_cliente_por: null,
      // (2026-11-09) Reenviar la lista ES la aprobación del cliente sobre los
      // productos nuevos: queda fechada igual que al aprobar, y la validación
      // anterior se limpia como en una reversa (el paso ya no vale).
      aprobado_cliente_at: ahora,
      aprobado_cliente_por: actorEmail,
      // (2026-11-09) Lo que Amsodent había avanzado (tomar el pedido, enviar
      // la cotización, observar, validar) deja de valer: el pedido vuelve a
      // «aprobado_cliente» como recién aprobado. La cotización vinculada se
      // conserva, porque se corrige, no se rehace.
      ...LIMPIEZA_MODIFICACION,
      pago_estado: null,
      pago_monto: null,
      updated_at: ahora,
    };
    if (String(body?.nota || '').trim()) {
      const previa = pedido.nota ? `${pedido.nota} · ` : '';
      parche.nota = `${previa}Modificación pedida por el cliente: ${String(body.nota).trim().slice(0, 500)}`;
    }

    // Migraciones sin aplicar (20260924, 20261109): se guarda igual lo
    // esencial (los productos nuevos y la etapa) en vez de dejar al cliente
    // sin poder modificar.
    const data = await this.actualizarTolerante(id, { ...parche, flujo_estado: 'aprobado_cliente' });

    const cuenta = (a: string) => detalle.filter((d) => d.accion === a).length;
    await this.registrarEvento({
      solicitudId: Number(id),
      tipo: 'modificacion_pedida',
      estadoDesde: actual,
      estadoHasta: 'aprobado_cliente',
      actorTipo: 'cliente',
      actorEmail,
      detalle: `El cliente modificó el pedido: ${cuenta('agrega')} agregado(s), ${cuenta('cambia')} con otra cantidad, ${cuenta('quita')} quitado(s).`,
      datos: { detalle },
    });
    await this.notificarPlataforma(data);
    return {
      ok: true,
      pedido: data,
      mensaje: 'Recibimos tus cambios. Vamos a revisar existencias y te enviamos la cotización corregida.',
    };
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
    // (2026-11-09) Los precios unitarios llegan NETOS (como en la cotización) y
    // el link de pago cobra con IVA: el respaldo también lo agrega, para que un
    // cliente nunca pague sin IVA si el navegador no mandó el total.
    const montoNeto = disponibilidad.reduce(
      (acc, d) => acc + d.cantidad_disponible * d.precio_unitario,
      0,
    );
    const montoCalculado = Math.round(montoNeto * (1 + IVA_PEDIDO));
    const monto = Math.round(Number(body?.monto_total) || montoCalculado);
    if (monto <= 0) {
      throw new BadRequestException(
        'El monto del pedido debe ser mayor a cero para poder emitir el link de pago.',
      );
    }

    const previo = await this.obtener(id);
    const ahora = new Date().toISOString();
    const extra: Record<string, any> = {
      validado_at: ahora,
      validado_por: actorEmail,
      disponibilidad,
      monto_total: monto,
      pago_monto: monto,
      pago_estado: 'pendiente',
      pago_medio: String(body?.medio_pago || 'webpay'),
      pago_link: linkDePago(Number(id)),
    };
    // (2026-11-09) Validar ES revisar: si nadie había tomado el pedido, queda
    // tomado por quien valida, para que la línea de tiempo no tenga huecos.
    if (!previo.revision_iniciada_at) Object.assign(extra, { revision_iniciada_at: ahora, revision_por: actorEmail });
    // Una observación abierta se da por resuelta: se habló por otro canal.
    if (this.estadoDe(previo) === 'observado' && !previo.observacion_respondida_at) {
      Object.assign(extra, {
        observacion_respondida_at: ahora,
        observacion_respondida_por: actorEmail,
        observacion_respuesta: 'Resuelta por Amsodent al validar el pedido.',
      });
    }

    const data = await this.mover(
      id,
      // Desde cualquier etapa de Amsodent; también revalidar (cambió una cantidad).
      ESTADOS_VALIDABLES,
      'validado_plataforma',
      extra,
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
    if (esCerrado(actual)) {
      throw new BadRequestException('El pedido está cerrado: no se puede revertir.');
    }
    // (2026-11-09) A dónde vuelve y qué se borra lo decide pedidos-flujo-etapas:
    // al retroceder se limpia lo que produjo la etapa que se deshace, para que
    // no queden datos de una validación o una observación que ya no valen.
    const paso = etapaAnterior(pedido);
    if (!paso) {
      throw new BadRequestException('El pedido ya está en la primera etapa.');
    }
    const destino = paso.destino;
    const data = await this.actualizarTolerante(id, { ...paso.limpieza, flujo_estado: destino, updated_at: new Date().toISOString() });

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
  // `soloRuts`: los clientes de la cartera de quien consulta (null = todos).
  async kpis(desde?: string, hasta?: string, soloRuts: string[] | null = null) {
    const COLS_BASE = 'id, created_at, aprobado_cliente_at, validado_at, pago_at, flujo_estado, sos, monto_total';
    const leer = (cols: string) => {
      let q = this.client.from(TABLA).select(cols);
      if (soloRuts) q = q.in('rut', soloRuts.length ? soloRuts.slice(0, 400) : ['—']);
      if (desde) q = q.gte('created_at', desde);
      if (hasta) q = q.lte('created_at', `${hasta}T23:59:59`);
      return q;
    };
    // (2026-11-09) Cuándo se tomó el pedido. Si la migración no corrió, los
    // KPI salen igual sin ese tramo.
    let { data, error } = await leer(`${COLS_BASE}, revision_iniciada_at`);
    if (error && columnaFaltante(error.message)) ({ data, error } = await leer(COLS_BASE));
    if (error) this.traducirError(error);
    const filas: any[] = (data as any[]) || [];

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
      por_estado: TODOS.reduce((acc: Record<string, number>, e) => {
        acc[e] = filas.filter((f: any) => (f.flujo_estado || 'pendiente_aprobacion') === e).length;
        return acc;
      }, {}),
      sos: filas.filter((f: any) => f.sos).length,
      monto_pagado: filas
        .filter((f: any) => f.flujo_estado === 'pagado')
        .reduce((acc: number, f: any) => acc + (Number(f.monto_total) || 0), 0),
      // Horas promedio de cada tramo. Son los tiempos de respuesta que pidió
      // el punto 18: cuánto demora el cliente en aprobar, cuánto demoramos
      // nosotros en tomar el pedido y en validar, y cuánto tarda el pago.
      horas_a_aprobacion: prom(filas.map((f: any) => horas(f.created_at, f.aprobado_cliente_at))),
      horas_a_revision: prom(filas.map((f: any) => horas(f.aprobado_cliente_at, f.revision_iniciada_at))),
      horas_a_validacion: prom(filas.map((f: any) => horas(f.aprobado_cliente_at, f.validado_at))),
      horas_a_pago: prom(filas.map((f: any) => horas(f.validado_at, f.pago_at))),
      horas_total: prom(filas.map((f: any) => horas(f.created_at, f.pago_at))),
    };
  }

  /* ── Etapas intermedias de la validación (2026-11-09) ────────────────────
     Entre «el cliente aprobó» y «validado y por pagar» ahora hay paradas con
     responsable y hora: tomar el pedido, enviar la cotización, observar algo
     al cliente; y la salida «rechazado». Qué etapas permiten cada acción está
     en pedidos-flujo-etapas.ts. */

  /** Alguien de Amsodent toma el pedido para revisarlo, o lo reasigna. */
  async tomarRevision(id: number, actorEmail: string) {
    const pedido = await this.obtener(id);
    const actual = this.estadoDe(pedido);
    const quienLoTenia = String(pedido.revision_por || '').toLowerCase();
    if (actual === 'en_revision' && quienLoTenia === String(actorEmail).toLowerCase()) {
      return { ok: true, pedido, mensaje: 'Este pedido ya lo tienes tú.' };
    }
    const reasigna = actual === 'en_revision' && !!quienLoTenia;
    const ahora = new Date().toISOString();
    const data = await this.mover(
      id,
      ESTADOS_TOMABLES,
      'en_revision',
      { revision_iniciada_at: reasigna ? pedido.revision_iniciada_at || ahora : ahora, revision_por: actorEmail },
      {
        tipo: 'revision_iniciada',
        actorTipo: 'plataforma',
        actorEmail,
        detalle: reasigna
          ? `Revisión reasignada de ${nombreCorto(quienLoTenia)} a ${nombreCorto(actorEmail)}.`
          : `${nombreCorto(actorEmail)} tomó el pedido para revisarlo.`,
      },
    );
    if (!reasigna) {
      // El cliente ve en su campana que alguien ya está en su pedido.
      await this.avisarCliente(data, {
        tipo: 'pedido_en_revision',
        descripcion: `Amsodent comenzó a revisar tu pedido N° ${data.id}.`,
        actorEmail,
      });
    }
    return { ok: true, pedido: data };
  }

  /** Se vinculó una cotización al pedido: el cliente la recibe en su portal.
      Lo llama el controlador después de vincular y es best-effort: nunca
      debe hacer fallar el guardado de la cotización. */
  async marcarCotizacionEnviada(id: number, licitacionId: number, actorEmail: string) {
    try {
      const pedido = await this.obtener(id);
      const actual = this.estadoDe(pedido);
      const ahora = new Date().toISOString();
      if (!ESTADOS_COTIZABLES.includes(actual)) {
        // En otra etapa (espera al cliente, observado, ya validado, cerrado) la
        // cotización queda en la bitácora pero la etapa no se mueve.
        await this.registrarEvento({
          solicitudId: Number(id), tipo: 'cotizacion_enviada', estadoDesde: actual, estadoHasta: actual,
          actorTipo: 'plataforma', actorEmail, detalle: `Cotización #${licitacionId} vinculada al pedido.`,
          datos: { licitacion_id: licitacionId },
        });
        return pedido;
      }
      const extra: Record<string, any> = { cotizacion_enviada_at: ahora, cotizacion_enviada_por: actorEmail };
      // Crear la cotización ES revisar el pedido: si nadie lo había tomado,
      // queda tomado por quien la creó.
      if (!pedido.revision_iniciada_at) Object.assign(extra, { revision_iniciada_at: ahora, revision_por: actorEmail });
      const data = await this.mover(id, ESTADOS_COTIZABLES, 'cotizacion_enviada', extra, {
        tipo: 'cotizacion_enviada',
        actorTipo: 'plataforma',
        actorEmail,
        detalle: `Cotización #${licitacionId} enviada al cliente.`,
        datos: { licitacion_id: licitacionId },
      });
      await this.avisarCliente(data, {
        tipo: 'pedido_cotizacion_enviada',
        descripcion: `Te enviamos la cotización de tu pedido N° ${data.id}. Revísala en Mis cotizaciones.`,
        actorEmail,
        licitacionId,
      });
      return data;
    } catch (e: any) {
      this.logger.warn(`No se pudo marcar la cotización enviada del pedido ${id}: ${e?.message || e}`);
      return null;
    }
  }

  /** Amsodent necesita algo del cliente antes de seguir (un producto sin
      stock, un reemplazo, un dato que falta). El pedido queda «observado»
      hasta que el cliente acepte seguir o lo modifique. */
  async observar(id: number, texto: string, actorEmail: string) {
    const limpio = String(texto || '').trim().slice(0, 1000);
    if (!limpio) throw new BadRequestException('Escribe qué necesitas que el cliente responda: él lo va a leer.');
    const pedido = await this.obtener(id);
    const ahora = new Date().toISOString();
    const extra: Record<string, any> = {
      observacion_at: ahora,
      observacion_por: actorEmail,
      observacion_texto: limpio,
      observacion_respondida_at: null,
      observacion_respondida_por: null,
      observacion_respuesta: null,
    };
    if (!pedido.revision_iniciada_at) Object.assign(extra, { revision_iniciada_at: ahora, revision_por: actorEmail });
    const data = await this.mover(id, ESTADOS_OBSERVABLES, 'observado', extra, {
      tipo: 'observado',
      actorTipo: 'plataforma',
      actorEmail,
      detalle: limpio.slice(0, 300),
    });
    await this.avisarCliente(data, {
      tipo: 'pedido_observado',
      descripcion: `Amsodent tiene una observación sobre tu pedido N° ${data.id} y necesita tu respuesta.`,
      actorEmail,
      hilo: `Tenemos una observación sobre tu pedido:\n\n${limpio}\n\nPuedes continuar con el pedido tal como está o modificarlo desde el portal.`,
      correo: {
        asunto: `Tu pedido N° ${data.id} tiene una observación de Amsodent`,
        html: `
          <p>Hola${data.contacto_nombre ? ` ${esc(data.contacto_nombre)}` : ''},</p>
          <p>Revisamos tu pedido N° ${data.id} y necesitamos tu respuesta:</p>
          <blockquote style="border-left:3px solid #f59e0b;margin:0;padding:6px 12px;color:#334155;white-space:pre-wrap">${esc(limpio)}</blockquote>
          <p>Ingresa al portal, en <strong>Mis cotizaciones</strong>, para continuar con el pedido tal como está o modificarlo.</p>
          <p>Amsodent Medical Spa</p>`,
      },
    });
    return { ok: true, pedido: data };
  }

  /** El cliente responde la observación aceptando seguir con el pedido, con
      un comentario opcional. Si prefiere cambiar productos, modifica el
      pedido y eso vuelve a «aprobado_cliente» por su propio camino. */
  async responderObservacion(id: number, respuesta: string, actorEmail: string, rut: string) {
    const pedido = await this.obtener(id);
    if (String(pedido.rut) !== String(rut)) {
      throw new ForbiddenException('Este pedido pertenece a otra cuenta.');
    }
    const texto = String(respuesta || '').trim().slice(0, 1000);
    const ahora = new Date().toISOString();
    const data = await this.mover(
      id,
      ['observado'],
      'en_revision',
      { observacion_respondida_at: ahora, observacion_respondida_por: actorEmail, observacion_respuesta: texto || null },
      {
        tipo: 'observacion_respondida',
        actorTipo: 'cliente',
        actorEmail,
        detalle: texto ? `El cliente aceptó seguir con el pedido: ${texto.slice(0, 250)}` : 'El cliente aceptó seguir con el pedido tal como está.',
      },
    );
    if (texto) {
      // Su comentario también va al hilo, donde el equipo lo lee junto al pedido.
      try {
        await this.client.from('stock_cotizacion_mensajes').insert({
          solicitud_id: Number(id), autor_tipo: 'cliente', autor_nombre: nombreCorto(actorEmail),
          mensaje: texto, leido_cliente: true, leido_equipo: false,
        });
      } catch (e: any) {
        this.logger.warn(`No se pudo dejar la respuesta del cliente en el hilo del pedido ${id}: ${e?.message || e}`);
      }
    }
    await this.notificarEquipo(
      data,
      'pedido_portal_observacion_respondida',
      `${data.razon_social || data.rut} respondió la observación del pedido N° ${data.id}: se puede seguir con la validación.`,
    );
    return { ok: true, pedido: data, mensaje: 'Gracias, seguimos con tu pedido.' };
  }

  /** Amsodent rechaza el pedido: cierra el flujo con motivo y deja el estado
      comercial en «cancelada». El cliente lo lee en el portal y por correo. */
  async rechazar(id: number, motivo: string, actorEmail: string) {
    const texto = String(motivo || '').trim().slice(0, 1000);
    if (!texto) throw new BadRequestException('Indica el motivo del rechazo: el cliente lo va a leer.');
    const pedido = await this.obtener(id);
    const actual = this.estadoDe(pedido);
    if (actual === 'pagado') {
      throw new BadRequestException('El pedido ya está pagado: no se puede rechazar. Si corresponde devolver el dinero, va por fuera del flujo.');
    }
    if (esCerrado(actual)) throw new BadRequestException('Este pedido ya está cerrado.');
    const ahora = new Date().toISOString();
    const data = await this.mover(
      id,
      TODOS.filter((e) => !esCerrado(e)),
      'rechazado',
      { rechazado_at: ahora, rechazado_por: actorEmail, rechazo_motivo: texto, estado: 'cancelada' },
      { tipo: 'rechazado', actorTipo: 'plataforma', actorEmail, detalle: texto.slice(0, 300) },
    );
    await this.avisarCliente(data, {
      tipo: 'pedido_rechazado',
      descripcion: `Amsodent no pudo seguir con tu pedido N° ${data.id}.`,
      actorEmail,
      hilo: `No podremos seguir con este pedido:\n\n${texto}\n\nSi quieres, arma un pedido nuevo desde el portal o escríbenos por aquí.`,
      correo: {
        asunto: `Tu pedido N° ${data.id} no pudo continuar`,
        html: `
          <p>Hola${data.contacto_nombre ? ` ${esc(data.contacto_nombre)}` : ''},</p>
          <p>Lamentamos informarte que no podremos seguir con tu pedido N° ${data.id}:</p>
          <blockquote style="border-left:3px solid #dc2626;margin:0;padding:6px 12px;color:#334155;white-space:pre-wrap">${esc(texto)}</blockquote>
          <p>Si quieres, arma un pedido nuevo desde el portal o respóndenos desde el hilo del pedido.</p>
          <p>Amsodent Medical Spa</p>`,
      },
    });
    return { ok: true, pedido: data };
  }

  /** El estado comercial (pendiente / respondida / cancelada) se cambia a mano
      en la bandeja y antes no tocaba la etapa: quedaban pedidos «cancelados»
      que el flujo seguía mostrando por revisar. Cancelar cierra la etapa;
      sacar de cancelada la reabre en la última que había alcanzado.
      Best-effort: el cambio de estado ya se guardó. */
  async alCambiarEstadoComercial(id: number, estado: string, actorEmail: string) {
    try {
      const pedido = await this.obtener(id);
      const actual = this.estadoDe(pedido);
      if (estado === 'cancelada') {
        if (esCerrado(actual)) return pedido;
        const data = await this.mover(id, [actual], 'cancelado', {}, {
          tipo: 'cancelado', actorTipo: 'plataforma', actorEmail, detalle: 'Pedido cancelado desde la bandeja de Amsodent.',
        });
        await this.avisarCliente(data, { tipo: 'pedido_cancelado', descripcion: `Tu pedido N° ${data.id} fue cancelado.`, actorEmail });
        return data;
      }
      if (actual === 'cancelado') {
        const destino = estadoAlReabrir(pedido);
        return await this.mover(id, ['cancelado'], destino, {}, {
          tipo: 'reabierto', actorTipo: 'plataforma', actorEmail, detalle: `Pedido reabierto en «${etiquetaEstado(destino)}».`,
        });
      }
      return pedido;
    } catch (e: any) {
      this.logger.warn(`No se pudo sincronizar la etapa del pedido ${id} con el estado «${estado}»: ${e?.message || e}`);
      return null;
    }
  }

  /* ── Avisos ─────────────────────────────────────────────────────────── */

  /** Aviso en la campana de la plataforma a quienes atienden los pedidos del
      portal: destinatarios configurados + administradores + dueño de la
      cartera (destinatarios-pedido.ts). Best-effort. */
  private async notificarEquipo(pedido: any, tipo: string, mensaje: string, metadata: Record<string, any> = {}) {
    try {
      const destinatarios = await destinatariosCampanaPedido(this.client, pedido.rut);
      const rows = destinatarios.map((email) => ({
        user_email: email,
        tipo,
        mensaje,
        link: `/pedidos-portal?pedido=${pedido.id}`,
        metadata: { solicitud_id: pedido.id, rut: pedido.rut, razon_social: pedido.razon_social || null, ...metadata },
      }));
      if (rows.length) await this.client.from('notificaciones').insert(rows);
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar «${tipo}» del pedido ${pedido?.id}: ${e?.message || e}`);
    }
  }

  /** Aviso al cliente: campana del portal (portal_actividades) y, si se
      pide, mensaje en el hilo del pedido y correo al contacto. Best-effort. */
  private async avisarCliente(
    pedido: any,
    aviso: { tipo: string; descripcion: string; actorEmail?: string | null; licitacionId?: number | null; hilo?: string; correo?: { asunto: string; html: string } },
  ) {
    await this.anotarActividad({
      rut: String(pedido.rut),
      tipo: aviso.tipo,
      descripcion: aviso.descripcion,
      actorEmail: aviso.actorEmail ?? null,
      actorNombre: nombreCorto(aviso.actorEmail) || 'Amsodent',
      origen: 'amsodent',
      solicitudId: Number(pedido.id),
      licitacionId: aviso.licitacionId ?? pedido.licitacion_id ?? null,
    });
    if (aviso.hilo) {
      try {
        await this.client.from('stock_cotizacion_mensajes').insert({
          solicitud_id: Number(pedido.id), autor_tipo: 'equipo', autor_nombre: 'Amsodent',
          mensaje: aviso.hilo, leido_equipo: true, leido_cliente: false,
        });
      } catch (e: any) {
        this.logger.warn(`No se pudo dejar el mensaje «${aviso.tipo}» en el hilo del pedido ${pedido?.id}: ${e?.message || e}`);
      }
    }
    const para = String(pedido?.contacto_email || '').trim();
    if (aviso.correo && para) {
      try {
        await this.mailings.enviarUno({ para, asunto: aviso.correo.asunto, cuerpoHtml: aviso.correo.html });
      } catch (e: any) {
        this.logger.warn(`No se pudo enviar el correo «${aviso.tipo}» del pedido ${pedido?.id}: ${e?.message || e}`);
      }
    }
  }

  private async notificarPlataforma(pedido: any) {
    // (2026-11-05) Además de los destinatarios configurados, les llega a los
    // administradores y al dueño de la cartera (destinatarios-pedido.ts).
    await this.notificarEquipo(
      pedido,
      'pedido_portal_aprobado',
      `${pedido.razon_social || pedido.rut} aprobó el pedido N° ${pedido.id}: hay que validar existencias.`,
    );
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

/** Nombre corto de un correo (lo de antes de la arroba), para los textos. */
function nombreCorto(correo: any): string {
  return String(correo || '').split('@')[0] || '';
}

/** Escapa texto que va dentro de un correo HTML. */
function esc(texto: any): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linkDePago(id: number): string {
  const base = String(process.env.PORTAL_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');
  return `${base}/portal-cliente?pagar=${id}`;
}
