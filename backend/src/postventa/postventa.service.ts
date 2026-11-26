import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosDeUsuario } from '../auth/permisos';
import { variantesRutFicha } from '../bsale/bsale-giros';
import { vendedorDeCartera } from '../stock-clientes/destinatarios-pedido';
import { PedidosFlujoService } from '../stock-clientes/pedidos-flujo.service';
import {
  ACCIONES,
  CATEGORIAS,
  DETALLE_MAX,
  ESTADOS,
  Estado,
  LIMITE_PORTAL_24H,
  MIGRACION_POSTVENTA,
  NuevaSolicitud,
  TipoGestion,
  UsuarioPv,
  correoValido,
  cortoAccion,
  documentoCalzaConAccion,
  esAbierta,
  esAccion,
  formatearRut,
  mensajeAvisoCliente,
  mensajeAvisoNueva,
  nombreAccion,
  nombreCategoria,
  nombreEstado,
  normalizarRut,
  puedeTransicionar,
  puedeVer,
  sinTabla,
  solicitudParaCliente,
  superaLimite,
  tipoAfectadoDe,
  validarNueva,
  veTodas,
  vendedorAlCrear,
  vendedorPropuesto,
} from './postventa.reglas';

/* ============================================================================
   Postventa — 2026-11-26
   ----------------------------------------------------------------------------
   Pedido de Ariel: registrar los reclamos de los clientes por categoría,
   gestionarlos (nota de crédito, otra factura, guía de despacho) y que el
   cliente pueda enviarlos y seguirlos desde su portal.

   Una solicitud nace «ingresada» (en la plataforma o en el portal), alguien
   la toma («en gestión»), se le agregan comentarios y acciones, y se cierra
   «resuelta» o «rechazada» con su motivo. Las tres acciones NO emiten nada
   acá: el documento se emite donde siempre (Trazabilidad, Facturación, la
   cotización, Venta directa) y en la solicitud queda la gestión, con el
   documento asociado (elegido de la cotización o escrito a mano).

   Quién ve qué: administradores y quienes tienen «Ver todas las cotizaciones»
   ven todo; el resto, las solicitudes donde es responsable o que creó.

   El cliente ve en su portal solo las solicitudes que envió desde ahí, con
   los cambios de estado, los documentos emitidos y los comentarios marcados
   «visible para el cliente». El RUT sale siempre del token del portal.

   Tablas: postventa_solicitudes y postventa_gestiones (migración
   20261126_postventa.sql). Reglas puras en postventa.reglas.ts.
============================================================================ */

const T_SOL = 'postventa_solicitudes';
const T_GES = 'postventa_gestiones';
// Facturas, guías y notas para asociar; las órdenes de compra, para emitir la guía de una OC.
const TIPOS_DOC_COTIZACION = ['factura', 'factura_boleta', 'guia_despacho', 'nota_credito', 'orden_compra'];
const COLS_LIC = 'id, id_licitacion, nombre, rut_entidad, nombre_entidad, estado, vendedor_correo, vendedor_nombre, creado_por, tipo_cliente, total_con_iva, created_at';
const COLS_DOC = 'id, licitacion_id, tipo, numero, monto, fecha_factura, fecha_oc, created_at, bsale_url';

export type UsuarioCtx = UsuarioPv & { nombre: string };

type PortalPayload = { rut: string; razon_social?: string; usuario_id?: number; usuario_email?: string; usuario_nombre?: string };

@Injectable()
export class PostventaService {
  private readonly logger = new Logger(PostventaService.name);

  constructor(
    private supabase: SupabaseService,
    private pedidosFlujo: PedidosFlujoService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  /* Error de una consulta a las tablas del módulo: si falta la migración, lo dice. */
  private fallo(error: any): BadRequestException {
    return new BadRequestException(sinTabla(error) ? MIGRACION_POSTVENTA : error?.message || 'No se pudo completar la operación.');
  }

  /* ── Usuario interno: correo, nombre y permisos efectivos ─────────────── */
  async usuario(req: any): Promise<UsuarioCtx> {
    const u = req?.user;
    if (!u?.id) throw new ForbiddenException('Sesión inválida.');
    const { data: perfil } = await this.db.from('profiles').select('email, nombre, rol, permission_profile_id').eq('id', u.id).maybeSingle();
    const rol = String((perfil as any)?.rol || '').trim().toLowerCase();
    let permisosPerfil: any = null;
    if ((perfil as any)?.permission_profile_id) {
      const { data: asignado } = await this.db.from('permission_profiles').select('permisos').eq('id', (perfil as any).permission_profile_id).maybeSingle();
      permisosPerfil = (asignado as any)?.permisos ?? null;
    }
    const email = String(u.email || (perfil as any)?.email || '').trim().toLowerCase();
    return {
      email,
      nombre: String((perfil as any)?.nombre || '').trim() || email,
      esAdmin: esRolAdmin(rol),
      permisos: permisosDeUsuario(rol, permisosPerfil, email),
    };
  }

  /* ── Presentación ─────────────────────────────────────────────────────── */
  private fila(s: any, acciones: any[] = []) {
    return {
      id: Number(s.id),
      created_at: s.created_at || null,
      updated_at: s.updated_at || null,
      origen: String(s.origen || 'plataforma'),
      categoria: String(s.categoria),
      categoria_nombre: nombreCategoria(s.categoria),
      descripcion: String(s.descripcion || ''),
      cliente_rut: String(s.cliente_rut || ''),
      cliente_rut_formateado: formatearRut(s.cliente_rut),
      cliente_nombre: s.cliente_nombre || null,
      licitacion_id: s.licitacion_id != null ? Number(s.licitacion_id) : null,
      documento_tipo: s.documento_tipo || null,
      documento_numero: s.documento_numero || null,
      documento_id: s.documento_id != null ? Number(s.documento_id) : null,
      pedido_id: s.pedido_id != null ? Number(s.pedido_id) : null,
      productos: Array.isArray(s.productos) ? s.productos : [],
      vendedor_email: s.vendedor_email || null,
      creada_por: s.creada_por || null,
      creada_por_nombre: s.creada_por_nombre || null,
      estado: String(s.estado),
      estado_nombre: nombreEstado(s.estado),
      tomada_at: s.tomada_at || null,
      tomada_por: s.tomada_por || null,
      resolucion: s.resolucion || null,
      cerrada_at: s.cerrada_at || null,
      cerrada_por: s.cerrada_por || null,
      acciones: acciones.map((a) => ({ tipo: String(a.tipo), nombre: cortoAccion(a.tipo), documento_numero: a.documento_numero || null })),
    };
  }

  private gestion(g: any) {
    return {
      id: Number(g.id),
      solicitud_id: Number(g.solicitud_id),
      tipo: String(g.tipo),
      tipo_nombre: g.tipo === 'comentario' ? 'Comentario' : g.tipo === 'cambio_estado' ? 'Cambio de estado' : nombreAccion(g.tipo),
      es_accion: esAccion(g.tipo),
      detalle: g.detalle || null,
      estado_nuevo: g.estado_nuevo || null,
      documento_numero: g.documento_numero || null,
      documento_id: g.documento_id != null ? Number(g.documento_id) : null,
      visible_cliente: g.visible_cliente === true,
      usuario_email: g.usuario_email || null,
      usuario_nombre: g.usuario_nombre || null,
      created_at: g.created_at || null,
    };
  }

  /* ── Contexto de la pantalla ──────────────────────────────────────────── */
  async contexto(u: UsuarioCtx) {
    let listo = true;
    for (const tabla of [T_SOL, T_GES]) {
      const { error } = await this.db.from(tabla).select('id').limit(1);
      if (error) {
        if (!sinTabla(error)) throw new BadRequestException(error.message);
        listo = false;
      }
    }
    const todas = veTodas(u);
    let vendedores: { email: string; nombre: string; rol: string }[] = [{ email: u.email, nombre: u.nombre, rol: '' }];
    if (todas) {
      const { data } = await this.db.from('profiles').select('email, nombre, rol, bloqueado').order('nombre', { ascending: true }).limit(500);
      vendedores = ((data || []) as any[])
        .filter((p) => p?.bloqueado !== true && correoValido(p?.email))
        .map((p) => ({ email: correoValido(p.email) as string, nombre: String(p.nombre || '').trim() || String(p.email), rol: String(p.rol || '') }));
    }
    return {
      listo,
      mensaje: listo ? null : MIGRACION_POSTVENTA,
      categorias: CATEGORIAS.map((c) => ({ clave: c.clave, nombre: c.nombre })),
      estados: ESTADOS.map((e) => ({ clave: e.clave, nombre: e.nombre })),
      acciones: ACCIONES.map((a) => ({ clave: a.clave, nombre: a.nombre, corto: a.corto, documentos: [...a.documentos] })),
      es_admin: u.esAdmin,
      ve_todas: todas,
      usuario_email: u.email,
      vendedores,
    };
  }

  /* ── Bandeja ──────────────────────────────────────────────────────────── */
  async listar(u: UsuarioCtx) {
    let q = this.db.from(T_SOL).select('*').order('id', { ascending: false }).limit(500);
    if (!veTodas(u)) {
      const yo = correoValido(u.email);
      if (!yo) return { listo: true, mensaje: null, solicitudes: [] };
      // Responsable, o creada por mí en la plataforma (el «creada_por» del portal es el correo del cliente).
      q = q.or(`vendedor_email.eq."${yo}",and(creada_por.eq."${yo}",origen.eq.plataforma)`);
    }
    const { data, error } = await q;
    if (error) {
      if (sinTabla(error)) return { listo: false, mensaje: MIGRACION_POSTVENTA, solicitudes: [] };
      throw new BadRequestException(error.message);
    }
    const filas = (data || []) as any[];
    const acciones = await this.accionesDe(filas.map((s) => Number(s.id)));
    return { listo: true, mensaje: null, solicitudes: filas.map((s) => this.fila(s, acciones.get(Number(s.id)) || [])) };
  }

  /* Acciones registradas (NC, factura, guía) de varias solicitudes, para la tabla. */
  private async accionesDe(ids: number[]): Promise<Map<number, any[]>> {
    const mapa = new Map<number, any[]>();
    for (let i = 0; i < ids.length; i += 250) {
      const { data, error } = await this.db
        .from(T_GES)
        .select('solicitud_id, tipo, documento_numero')
        .in('solicitud_id', ids.slice(i, i + 250))
        .in('tipo', ACCIONES.map((a) => a.clave))
        .order('id', { ascending: true })
        .limit(2000);
      if (error) break;
      for (const g of (data || []) as any[]) {
        const k = Number(g.solicitud_id);
        mapa.set(k, [...(mapa.get(k) || []), g]);
      }
    }
    return mapa;
  }

  /* La solicitud, si existe y el usuario puede verla. */
  private async cargar(id: number, u: UsuarioCtx): Promise<any> {
    const { data, error } = await this.db.from(T_SOL).select('*').eq('id', Number(id)).maybeSingle();
    if (error) throw this.fallo(error);
    if (!data) throw new NotFoundException('Esa solicitud de postventa no existe.');
    if (!puedeVer(data as any, u)) throw new ForbiddenException('Esa solicitud es de otro vendedor: solo la ven su responsable, quien la registró y administración.');
    return data;
  }

  private async gestionesDe(solicitudId: number): Promise<any[]> {
    const { data, error } = await this.db.from(T_GES).select('*').eq('solicitud_id', solicitudId).order('id', { ascending: true }).limit(500);
    if (error) throw this.fallo(error);
    return (data || []) as any[];
  }

  private async cotizacion(licId: number | null): Promise<any | null> {
    if (!licId) return null;
    const { data, error } = await this.db.from('licitaciones').select(COLS_LIC).eq('id', Number(licId)).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data || null;
  }

  private async documentosDe(licId: number | null): Promise<any[]> {
    if (!licId) return [];
    const { data, error } = await this.db
      .from('licitacion_documentos')
      .select(COLS_DOC)
      .eq('licitacion_id', Number(licId))
      .in('tipo', TIPOS_DOC_COTIZACION)
      .order('id', { ascending: true })
      .limit(300);
    if (error) throw new BadRequestException(error.message);
    return ((data || []) as any[]).map((d) => this.documento(d));
  }

  private documento(d: any) {
    return {
      id: Number(d.id),
      licitacion_id: Number(d.licitacion_id),
      tipo: String(d.tipo),
      numero: d.numero != null ? String(d.numero).slice(0, 60) : null,
      monto: d.monto != null && Number.isFinite(Number(d.monto)) ? Number(d.monto) : null,
      fecha: String(d.fecha_factura || d.fecha_oc || d.created_at || '').slice(0, 10) || null,
      bsale_url: d.bsale_url || null,
    };
  }

  private resumenCotizacion(l: any) {
    return {
      id: Number(l.id),
      id_licitacion: l.id_licitacion || null,
      nombre: l.nombre || null,
      nombre_entidad: l.nombre_entidad || null,
      rut: normalizarRut(l.rut_entidad),
      estado: l.estado || null,
      tipo_cliente: l.tipo_cliente || null,
      total_con_iva: l.total_con_iva != null ? Number(l.total_con_iva) : null,
      created_at: l.created_at || null,
      vendedor: correoValido(l.vendedor_correo) || correoValido(l.creado_por),
      vendedor_nombre: l.vendedor_nombre || null,
    };
  }

  async detalle(id: number, u: UsuarioCtx) {
    const sol = await this.cargar(id, u);
    const [gestiones, lic, documentos] = await Promise.all([
      this.gestionesDe(Number(sol.id)),
      this.cotizacion(sol.licitacion_id),
      this.documentosDe(sol.licitacion_id),
    ]);
    return {
      solicitud: this.fila(sol, gestiones.filter((g) => esAccion(g.tipo))),
      gestiones: gestiones.map((g) => this.gestion(g)),
      cotizacion: lic ? this.resumenCotizacion(lic) : null,
      documentos,
    };
  }

  /* ── Para armar una solicitud nueva ───────────────────────────────────── */

  /* Clientes por nombre o RUT (el RUT se guarda con o sin puntos y guion). */
  async buscarClientes(texto: string) {
    const q = String(texto || '').replace(/[,()"\\%*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (q.length < 2) return [];
    const filtros = [`nombre.ilike."%${q}%"`, `rut.ilike."%${q}%"`];
    const rutN = normalizarRut(q);
    const soloRut = /^[0-9.\-kK\s]+$/.test(q);
    if (soloRut && rutN.length >= 3) {
      // Mismo RUT escrito sin puntos: se prueba como cuerpo de 8 y de 7 dígitos con sus puntos.
      const digitos = rutN.replace(/k/g, '').slice(0, 8);
      const conPuntos = (cuerpo: string, largo: number) => {
        const cortes = largo === 8 ? [2, 5] : [1, 4];
        let s = '';
        for (let i = 0; i < cuerpo.length; i += 1) s += (cortes.includes(i) ? '.' : '') + cuerpo[i];
        return s;
      };
      filtros.push(`rut.ilike."${conPuntos(digitos, 8)}%"`, `rut.ilike."${conPuntos(digitos.slice(0, 7), 7)}%"`, `rut.ilike."${digitos}%"`);
      for (const v of variantesRutFicha(rutN)) filtros.push(`rut.eq."${v}"`);
    }
    const { data, error } = await this.db.from('clientes').select('id, rut, nombre, vendedor_asignado').or(filtros.join(',')).order('nombre', { ascending: true }).limit(40);
    if (error) throw new BadRequestException(error.message);
    const vistos = new Set<string>();
    const salida: any[] = [];
    for (const c of (data || []) as any[]) {
      const rut = normalizarRut(c?.rut);
      if (rut.length < 2 || vistos.has(rut)) continue;
      vistos.add(rut);
      salida.push({ rut, rut_formateado: formatearRut(rut), nombre: String(c.nombre || '').trim() || formatearRut(rut), vendedor_asignado: correoValido(c.vendedor_asignado) });
      if (salida.length >= 20) break;
    }
    return salida;
  }

  /* Cotizaciones de un RUT (las más recientes primero), en todas sus formas de escribirlo. */
  private async cotizacionesDeRut(rutIn: string, limite = 80): Promise<any[]> {
    const rut = normalizarRut(rutIn);
    const variantes = variantesRutFicha(rut);
    if (!variantes.length) return [];
    const { data, error } = await this.db.from('licitaciones').select(COLS_LIC).in('rut_entidad', variantes).order('id', { ascending: false }).limit(limite);
    if (error) throw new BadRequestException(error.message);
    return ((data || []) as any[]).filter((l) => normalizarRut(l.rut_entidad) === rut);
  }

  async cotizacionesDeCliente(rutIn: string) {
    const rut = normalizarRut(rutIn);
    if (rut.length < 2) throw new BadRequestException('Indica el RUT del cliente.');
    const [lics, cartera] = await Promise.all([this.cotizacionesDeRut(rut), vendedorDeCartera(this.db as any, rut).catch(() => null)]);
    return { rut, vendedor_cartera: cartera, cotizaciones: lics.map((l) => this.resumenCotizacion(l)) };
  }

  /* Una cotización con sus documentos y productos, para elegir lo afectado. */
  async cotizacionParaSolicitud(licId: number) {
    const lic = await this.cotizacion(licId);
    if (!lic) throw new NotFoundException('Esa cotización no existe.');
    const [documentos, productos] = await Promise.all([this.documentosDe(Number(lic.id)), this.productosDe(Number(lic.id))]);
    return { cotizacion: this.resumenCotizacion(lic), documentos, productos };
  }

  private async productosDe(licId: number): Promise<{ sku: string | null; nombre: string; cantidad: number | null }[]> {
    const { data, error } = await this.db.from('items_licitacion').select('sku, producto, cantidad, orden').eq('licitacion_id', licId).order('orden', { ascending: true }).limit(300);
    if (error) return [];
    return ((data || []) as any[]).map((i) => ({
      sku: String(i.sku || '').trim() || null,
      nombre: String(i.producto || '').trim() || String(i.sku || ''),
      cantidad: Number.isFinite(Number(i.cantidad)) && Number(i.cantidad) > 0 ? Number(i.cantidad) : null,
    }));
  }

  /* Valida lo referenciado contra el RUT del cliente y completa lo que falta
     (tipo y número del documento, cotización del documento o del pedido). */
  private async referencias(rut: string, d: NuevaSolicitud, portal: boolean) {
    const ajena = (que: string) => (portal ? new ForbiddenException(`${que} no es de tu cuenta.`) : new BadRequestException(`${que} es de otro cliente.`));
    let licId = d.licitacion_id;
    let lic: any = null;
    let docTipo = d.documento_tipo;
    let docNumero = d.documento_numero;
    let docId: number | null = null;
    let pedidoId: number | null = null;

    if (d.documento_id) {
      const { data: doc, error } = await this.db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero').eq('id', d.documento_id).maybeSingle();
      if (error) throw new BadRequestException(error.message);
      const tipo = tipoAfectadoDe((doc as any)?.tipo);
      if (!doc || !tipo) throw new BadRequestException('El documento afectado debe ser una factura, boleta o guía de despacho.');
      if (licId && Number((doc as any).licitacion_id) !== licId) throw new BadRequestException('Ese documento no es de la cotización elegida.');
      licId = Number((doc as any).licitacion_id);
      docId = Number((doc as any).id);
      docTipo = tipo;
      docNumero = (doc as any).numero != null ? String((doc as any).numero).slice(0, 40) : null;
    }
    if (portal && d.pedido_id) {
      const { data: ped } = await this.db.from('stock_solicitudes_cotizacion').select('id, rut, licitacion_id').eq('id', d.pedido_id).maybeSingle();
      if (!ped || normalizarRut((ped as any).rut) !== rut) throw ajena('Ese pedido');
      pedidoId = Number((ped as any).id);
      if (!licId && (ped as any).licitacion_id) {
        // La cotización del pedido solo se enlaza si de verdad es del mismo RUT.
        const delPedido = await this.cotizacion(Number((ped as any).licitacion_id));
        if (delPedido && normalizarRut(delPedido.rut_entidad) === rut) {
          lic = delPedido;
          licId = Number(delPedido.id);
        }
      }
    }
    if (licId && !lic) {
      lic = await this.cotizacion(licId);
      if (!lic) throw new BadRequestException('Esa cotización no existe.');
      if (normalizarRut(lic.rut_entidad) !== rut) throw ajena(docId ? 'Ese documento' : 'Esa cotización');
    }
    return { lic, licitacion_id: lic ? Number(lic.id) : null, documento_id: docId, documento_tipo: docTipo, documento_numero: docNumero, pedido_id: pedidoId };
  }

  /* ── Crear (plataforma) ───────────────────────────────────────────────── */
  async crear(u: UsuarioCtx, body: any) {
    const v = validarNueva(body);
    if ('error' in v) throw new BadRequestException(v.error);
    const rut = normalizarRut(body?.cliente_rut);
    if (rut.length < 7) throw new BadRequestException('Elige el cliente de la solicitud.');
    const ref = await this.referencias(rut, v.datos, false);
    let nombre = String(body?.cliente_nombre || '').replace(/\s+/g, ' ').trim().slice(0, 200) || String(ref.lic?.nombre_entidad || '').trim();
    if (!nombre) {
      const { data } = await this.db.from('clientes').select('nombre').in('rut', variantesRutFicha(rut)).limit(1);
      nombre = String(((data || []) as any[])[0]?.nombre || '').trim();
    }

    const propuesto = vendedorPropuesto({
      vendedorCotizacion: ref.lic?.vendedor_correo,
      creadorCotizacion: ref.lic?.creado_por,
      vendedorCartera: await vendedorDeCartera(this.db as any, rut).catch(() => null),
    });
    const pedido = correoValido(body?.vendedor_email);
    if (u.esAdmin && pedido && pedido !== propuesto) await this.exigirUsuarioInterno(pedido);
    const vendedor = vendedorAlCrear({ propuesto, pedido, esAdmin: u.esAdmin, creador: u.email, origen: 'plataforma' });

    const { data, error } = await this.db
      .from(T_SOL)
      .insert({
        origen: 'plataforma',
        categoria: v.datos.categoria,
        descripcion: v.datos.descripcion,
        cliente_rut: rut,
        cliente_nombre: nombre || null,
        licitacion_id: ref.licitacion_id,
        documento_tipo: ref.documento_tipo,
        documento_numero: ref.documento_numero,
        documento_id: ref.documento_id,
        productos: v.datos.productos,
        vendedor_email: vendedor,
        creada_por: u.email || null,
        creada_por_nombre: u.nombre || null,
      })
      .select('*')
      .single();
    if (error) throw this.fallo(error);
    this.logger.log(`Postventa: solicitud ${data.id} (${data.categoria}) de ${rut} registrada por ${u.email}; responsable ${vendedor || 'sin asignar'}`);
    await this.avisarNueva(data, u.email);
    return { solicitud: this.fila(data) };
  }

  private async exigirUsuarioInterno(email: string) {
    const { data } = await this.db.from('profiles').select('id').ilike('email', email).limit(1);
    if (!((data || []) as any[]).length) throw new BadRequestException(`${email} no es un usuario de la plataforma.`);
  }

  /* Campana del vendedor responsable (si no es quien la registró). Sin
     responsable, a los administradores. Nunca hace fallar la creación. */
  private async avisarNueva(sol: any, creador: string | null) {
    try {
      const quien = String(creador || '').trim().toLowerCase();
      let destinos: string[] = [];
      const responsable = correoValido(sol.vendedor_email);
      if (responsable) {
        if (responsable !== quien) destinos = [responsable];
      } else {
        const { data } = await this.db.from('profiles').select('email, rol').or('rol.ilike.admin,rol.ilike.administrador');
        destinos = [...new Set(((data || []) as any[]).map((p) => correoValido(p?.email)).filter((e): e is string => !!e && e !== quien))];
      }
      if (!destinos.length) return;
      await this.campana(destinos, sol, mensajeAvisoNueva({ id: Number(sol.id), categoria: sol.categoria, cliente_nombre: sol.cliente_nombre, cliente_rut: sol.cliente_rut, origen: sol.origen }));
    } catch (e: any) {
      this.logger.warn(`Postventa ${sol?.id}: aviso de solicitud nueva falló: ${e?.message || e}`);
    }
  }

  private async campana(destinos: string[], sol: any, mensaje: string) {
    const { error } = await this.db.from('notificaciones').insert(
      destinos.map((user_email) => ({
        user_email,
        tipo: 'postventa_solicitud',
        mensaje,
        link: `/postventa?solicitud=${sol.id}`,
        metadata: { solicitud_id: Number(sol.id), categoria: sol.categoria, cliente: sol.cliente_nombre || null, cliente_rut: sol.cliente_rut || null, origen: sol.origen },
      })),
    );
    if (error) this.logger.warn(`Postventa ${sol.id}: sin campana para ${destinos.join(', ')}: ${error.message}`);
  }

  /* ── Bitácora y avisos al cliente ─────────────────────────────────────── */
  private async anotar(sol: any, u: UsuarioCtx, g: { tipo: TipoGestion; detalle?: string | null; estado_nuevo?: Estado | null; documento_numero?: string | null; documento_id?: number | null; visible_cliente: boolean }) {
    const { data, error } = await this.db
      .from(T_GES)
      .insert({
        solicitud_id: Number(sol.id),
        tipo: g.tipo,
        detalle: g.detalle ? String(g.detalle).slice(0, DETALLE_MAX) : null,
        estado_nuevo: g.estado_nuevo ?? null,
        documento_numero: g.documento_numero ?? null,
        documento_id: g.documento_id ?? null,
        visible_cliente: g.visible_cliente,
        usuario_email: u.email || null,
        usuario_nombre: u.nombre || null,
      })
      .select('*')
      .single();
    if (error) throw this.fallo(error);
    return data;
  }

  /* Aviso en la campana del portal: solo si la solicitud vino del portal.
     Va con el RUT normalizado (así lo busca el portal) y origen «amsodent». */
  private async avisarCliente(sol: any, u: UsuarioCtx, a: { tipo: TipoGestion; estado?: Estado | null; documento_numero?: string | null }) {
    if (sol?.origen !== 'portal') return;
    const rut = normalizarRut(sol.cliente_rut);
    if (!rut) return;
    await this.pedidosFlujo.anotarActividad({
      rut,
      tipo: a.tipo === 'cambio_estado' ? 'postventa_estado' : a.tipo === 'comentario' ? 'postventa_respuesta' : 'postventa_documento',
      descripcion: mensajeAvisoCliente({ id: Number(sol.id), tipo: a.tipo, estado: a.estado, documento_numero: a.documento_numero }),
      actorEmail: u.email || null,
      actorNombre: 'Amsodent',
      origen: 'amsodent',
      metadata: { postventa_id: Number(sol.id), estado: a.estado || null },
    });
  }

  /* Cambio de estado: valida la transición, no pisa el cambio de otra persona
     y deja la gestión (visible para el cliente). */
  private async mover(sol: any, hasta: Estado, extra: Record<string, any>, u: UsuarioCtx, detalle: string) {
    if (!puedeTransicionar(sol.estado, hasta)) {
      throw new BadRequestException(`Una solicitud «${nombreEstado(sol.estado)}» no puede pasar a «${nombreEstado(hasta)}».`);
    }
    const { data, error } = await this.db
      .from(T_SOL)
      .update({ ...extra, estado: hasta, updated_at: new Date().toISOString() })
      .eq('id', Number(sol.id))
      .eq('estado', sol.estado)
      .select('*');
    if (error) throw this.fallo(error);
    const nueva = ((data || []) as any[])[0];
    if (!nueva) throw new ConflictException('Otra persona cambió el estado de esta solicitud: actualiza la página.');
    await this.anotar(nueva, u, { tipo: 'cambio_estado', detalle, estado_nuevo: hasta, visible_cliente: true });
    await this.avisarCliente(nueva, u, { tipo: 'cambio_estado', estado: hasta });
    return nueva;
  }

  private async tocar(solId: number) {
    await this.db.from(T_SOL).update({ updated_at: new Date().toISOString() }).eq('id', solId);
  }

  /* ── Gestión ──────────────────────────────────────────────────────────── */
  async tomar(id: number, u: UsuarioCtx) {
    const sol = await this.cargar(id, u);
    if (sol.estado !== 'ingresada') throw new BadRequestException(`Esta solicitud ya está «${nombreEstado(sol.estado)}».`);
    await this.mover(sol, 'en_gestion', this.alTomar(sol, u), u, 'La solicitud pasó a «En gestión».');
    return this.detalle(id, u);
  }

  // Quien toma una solicitud sin responsable queda como su responsable.
  private alTomar(sol: any, u: UsuarioCtx) {
    return { tomada_at: new Date().toISOString(), tomada_por: u.email || null, vendedor_email: correoValido(sol.vendedor_email) || correoValido(u.email) };
  }

  async comentar(id: number, u: UsuarioCtx, body: any) {
    const sol = await this.cargar(id, u);
    const detalle = String(body?.detalle ?? '').trim();
    if (detalle.length < 2) throw new BadRequestException('Escribe el comentario.');
    if (detalle.length > DETALLE_MAX) throw new BadRequestException(`El comentario no puede pasar de ${DETALLE_MAX} caracteres.`);
    const visible = body?.visible_cliente === true && sol.origen === 'portal';
    await this.anotar(sol, u, { tipo: 'comentario', detalle, visible_cliente: visible });
    await this.tocar(Number(sol.id));
    if (visible) await this.avisarCliente(sol, u, { tipo: 'comentario' });
    return this.detalle(id, u);
  }

  /* El documento que resulta de una acción: elegido de la cotización (se
     valida que sea de este cliente y del tipo de la acción) o escrito a mano. */
  private async documentoDeAccion(sol: any, accion: string, body: any): Promise<{ documento_id: number | null; documento_numero: string | null }> {
    const escrito = String(body?.documento_numero ?? '').trim().slice(0, 40) || null;
    const docId = Number(body?.documento_id);
    if (!Number.isInteger(docId) || docId <= 0) return { documento_id: null, documento_numero: escrito };
    const { data: doc, error } = await this.db.from('licitacion_documentos').select('id, licitacion_id, tipo, numero').eq('id', docId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!doc) throw new BadRequestException('Ese documento no existe.');
    if (!documentoCalzaConAccion(accion, (doc as any).tipo)) throw new BadRequestException(`Ese documento no es una ${cortoAccion(accion).toLowerCase()}.`);
    if (!sol.licitacion_id || Number((doc as any).licitacion_id) !== Number(sol.licitacion_id)) {
      // Puede ser de otra cotización del mismo cliente (p. ej. una venta directa nueva).
      const lic = await this.cotizacion(Number((doc as any).licitacion_id));
      if (!lic || normalizarRut(lic.rut_entidad) !== normalizarRut(sol.cliente_rut)) throw new BadRequestException('Ese documento es de otro cliente.');
    }
    return { documento_id: Number((doc as any).id), documento_numero: (doc as any).numero != null ? String((doc as any).numero).slice(0, 40) : escrito };
  }

  /* Registra una de las tres acciones. No emite nada: el documento se emite
     en su pantalla de siempre y acá queda la gestión. Una solicitud recién
     ingresada pasa a «en gestión» al registrar su primera acción. */
  async registrarAccion(id: number, u: UsuarioCtx, body: any) {
    let sol = await this.cargar(id, u);
    const tipo = body?.tipo;
    if (!esAccion(tipo)) throw new BadRequestException('Elige la acción: nota de crédito, factura o guía de despacho.');
    if (!esAbierta(sol.estado)) throw new BadRequestException('La solicitud está cerrada: reábrela para registrar otra acción.');
    const detalle = String(body?.detalle ?? '').trim().slice(0, DETALLE_MAX) || null;
    const doc = await this.documentoDeAccion(sol, tipo, body);
    if (sol.estado === 'ingresada') sol = await this.mover(sol, 'en_gestion', this.alTomar(sol, u), u, 'La solicitud pasó a «En gestión».');
    const emitido = !!(doc.documento_id || doc.documento_numero);
    // Sin documento todavía es una gestión interna; el cliente la ve cuando se asocia el documento.
    await this.anotar(sol, u, { tipo, detalle, documento_id: doc.documento_id, documento_numero: doc.documento_numero, visible_cliente: emitido });
    await this.tocar(Number(sol.id));
    if (emitido) await this.avisarCliente(sol, u, { tipo, documento_numero: doc.documento_numero });
    return this.detalle(id, u);
  }

  /* Asocia (o corrige) el documento emitido de una acción ya registrada. */
  async asociarDocumento(gestionId: number, u: UsuarioCtx, body: any) {
    const { data: g, error } = await this.db.from(T_GES).select('*').eq('id', Number(gestionId)).maybeSingle();
    if (error) throw this.fallo(error);
    if (!g) throw new NotFoundException('Esa gestión no existe.');
    if (!esAccion((g as any).tipo)) throw new BadRequestException('Solo las acciones (nota de crédito, factura, guía) llevan documento.');
    const sol = await this.cargar(Number((g as any).solicitud_id), u);
    const doc = await this.documentoDeAccion(sol, (g as any).tipo, body);
    if (!doc.documento_id && !doc.documento_numero) throw new BadRequestException('Elige el documento emitido o escribe su número.');
    const { error: e2 } = await this.db
      .from(T_GES)
      .update({ documento_id: doc.documento_id, documento_numero: doc.documento_numero, visible_cliente: true })
      .eq('id', Number((g as any).id));
    if (e2) throw this.fallo(e2);
    await this.tocar(Number(sol.id));
    const yaTenia = !!((g as any).documento_id || (g as any).documento_numero);
    if (!yaTenia) await this.avisarCliente(sol, u, { tipo: (g as any).tipo, documento_numero: doc.documento_numero });
    return this.detalle(Number(sol.id), u);
  }

  async cerrar(id: number, u: UsuarioCtx, body: any) {
    const sol = await this.cargar(id, u);
    const estado = body?.estado;
    if (estado !== 'resuelta' && estado !== 'rechazada') throw new BadRequestException('Indica si la solicitud queda resuelta o rechazada.');
    const resolucion = String(body?.resolucion ?? '').trim();
    if (resolucion.length < 3) throw new BadRequestException(estado === 'rechazada' ? 'Escribe el motivo del rechazo.' : 'Escribe cómo se resolvió.');
    if (resolucion.length > DETALLE_MAX) throw new BadRequestException(`El texto no puede pasar de ${DETALLE_MAX} caracteres.`);
    await this.mover(sol, estado, { resolucion, cerrada_at: new Date().toISOString(), cerrada_por: u.email || null }, u, resolucion);
    return this.detalle(id, u);
  }

  async reabrir(id: number, u: UsuarioCtx) {
    const sol = await this.cargar(id, u);
    if (esAbierta(sol.estado)) throw new BadRequestException('La solicitud ya está abierta.');
    await this.mover(sol, 'en_gestion', { resolucion: null, cerrada_at: null, cerrada_por: null }, u, 'La solicitud se reabrió.');
    return this.detalle(id, u);
  }

  /* Cambiar el responsable: solo administración. */
  async cambiarVendedor(id: number, u: UsuarioCtx, body: any) {
    if (!u.esAdmin) throw new ForbiddenException('Solo administración puede cambiar el responsable de una solicitud.');
    const sol = await this.cargar(id, u);
    const nuevo = correoValido(body?.vendedor_email);
    if (!nuevo) throw new BadRequestException('Elige el vendedor responsable.');
    if (nuevo === correoValido(sol.vendedor_email)) return this.detalle(id, u);
    await this.exigirUsuarioInterno(nuevo);
    const { error } = await this.db.from(T_SOL).update({ vendedor_email: nuevo, updated_at: new Date().toISOString() }).eq('id', Number(sol.id));
    if (error) throw this.fallo(error);
    await this.anotar(sol, u, { tipo: 'comentario', detalle: `Responsable: ${sol.vendedor_email || 'sin asignar'} → ${nuevo}.`, visible_cliente: false });
    if (nuevo !== u.email) {
      await this.campana([nuevo], sol, `Te asignaron la solicitud de postventa N° ${sol.id} de ${sol.cliente_nombre || formatearRut(sol.cliente_rut)}: ${nombreCategoria(sol.categoria)}.`.slice(0, 300)).catch(() => {});
    }
    return this.detalle(id, u);
  }

  /* ══ Portal del cliente ═════════════════════════════════════════════════
     El RUT viene SIEMPRE del token (StockPortalGuard), nunca del cuerpo. El
     cliente ve solo lo que envió desde el portal. */

  async portalListar(rutIn: string) {
    const rut = normalizarRut(rutIn);
    const { data, error } = await this.db.from(T_SOL).select('*').eq('cliente_rut', rut).eq('origen', 'portal').order('id', { ascending: false }).limit(200);
    if (error) {
      if (sinTabla(error)) return { listo: false, solicitudes: [], categorias: CATEGORIAS.map((c) => ({ clave: c.clave, nombre: c.nombre })) };
      throw new BadRequestException(error.message);
    }
    const filas = (data || []) as any[];
    const porSolicitud = new Map<number, any[]>();
    const ids = filas.map((s) => Number(s.id));
    for (let i = 0; i < ids.length; i += 250) {
      const { data: gs } = await this.db
        .from(T_GES)
        .select('id, solicitud_id, tipo, detalle, documento_numero, visible_cliente, created_at')
        .in('solicitud_id', ids.slice(i, i + 250))
        .eq('visible_cliente', true)
        .order('id', { ascending: true })
        .limit(3000);
      for (const g of (gs || []) as any[]) {
        const k = Number(g.solicitud_id);
        porSolicitud.set(k, [...(porSolicitud.get(k) || []), g]);
      }
    }
    return {
      listo: true,
      categorias: CATEGORIAS.map((c) => ({ clave: c.clave, nombre: c.nombre })),
      solicitudes: filas.map((s) => solicitudParaCliente(s, porSolicitud.get(Number(s.id)) || [])),
    };
  }

  /* Lo que el cliente puede señalar como afectado: sus facturas, guías y pedidos. */
  async portalOpciones(rutIn: string) {
    const rut = normalizarRut(rutIn);
    const lics = await this.cotizacionesDeRut(rut, 200);
    const codigo = new Map<number, string>(lics.map((l) => [Number(l.id), String(l.id_licitacion || `#${l.id}`)]));
    const documentos: any[] = [];
    const ids = [...codigo.keys()];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await this.db
        .from('licitacion_documentos')
        .select('id, licitacion_id, tipo, numero, fecha_factura, fecha_oc, created_at')
        .in('licitacion_id', ids.slice(i, i + 200))
        .in('tipo', ['factura', 'factura_boleta', 'guia_despacho'])
        .order('id', { ascending: false })
        .limit(400);
      if (error) throw new BadRequestException(error.message);
      for (const d of (data || []) as any[]) {
        documentos.push({
          id: Number(d.id),
          licitacion_id: Number(d.licitacion_id),
          cotizacion: codigo.get(Number(d.licitacion_id)) || null,
          tipo: tipoAfectadoDe(d.tipo),
          numero: d.numero != null ? String(d.numero).slice(0, 60) : null,
          fecha: String(d.fecha_factura || d.fecha_oc || d.created_at || '').slice(0, 10) || null,
        });
      }
    }
    let pedidos: any[] = [];
    try {
      const { data } = await this.db.from('stock_solicitudes_cotizacion').select('id, created_at, licitacion_id').eq('rut', rut).order('id', { ascending: false }).limit(60);
      pedidos = ((data || []) as any[]).map((p) => ({ id: Number(p.id), fecha: String(p.created_at || '').slice(0, 10) || null, licitacion_id: p.licitacion_id != null ? Number(p.licitacion_id) : null }));
    } catch {
      /* sin pedidos del portal */
    }
    return { categorias: CATEGORIAS.map((c) => ({ clave: c.clave, nombre: c.nombre })), documentos: documentos.slice(0, 400), pedidos };
  }

  /* Productos de una cotización del cliente, para marcar los afectados. */
  async portalProductos(rutIn: string, licId: number) {
    const rut = normalizarRut(rutIn);
    const lic = await this.cotizacion(licId);
    if (!lic || normalizarRut(lic.rut_entidad) !== rut) throw new ForbiddenException('Esa cotización no es de tu cuenta.');
    return { productos: await this.productosDe(Number(lic.id)) };
  }

  async portalCrear(payload: PortalPayload, body: any) {
    const rut = normalizarRut(payload?.rut);
    if (rut.length < 2) throw new ForbiddenException('Sesión del portal inválida.');
    const v = validarNueva(body);
    if ('error' in v) throw new BadRequestException(v.error);

    // Tope por usuario: evita que un formulario abierto (o un abuso) llene la bandeja.
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let qLimite = this.db.from(T_SOL).select('id').eq('cliente_rut', rut).eq('origen', 'portal').gte('created_at', desde).limit(LIMITE_PORTAL_24H + 1);
    qLimite = payload.usuario_id ? qLimite.eq('portal_usuario_id', Number(payload.usuario_id)) : qLimite.is('portal_usuario_id', null);
    const { data: recientes, error: eLimite } = await qLimite;
    if (eLimite) throw this.fallo(eLimite);
    if (superaLimite(((recientes || []) as any[]).length)) {
      throw new HttpException(`Ya enviaste ${LIMITE_PORTAL_24H} solicitudes en las últimas 24 horas. Si necesitas ingresar otra, escríbele a tu ejecutivo de Amsodent.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    // En el portal el documento se elige de la lista: no se aceptan números escritos a mano.
    const datos: NuevaSolicitud = { ...v.datos, documento_tipo: null, documento_numero: null };
    const ref = await this.referencias(rut, datos, true);
    const vendedor = vendedorAlCrear({
      propuesto: vendedorPropuesto({
        vendedorCotizacion: ref.lic?.vendedor_correo,
        creadorCotizacion: ref.lic?.creado_por,
        vendedorCartera: await vendedorDeCartera(this.db as any, rut).catch(() => null),
      }),
      esAdmin: false,
      origen: 'portal',
    });
    const razon = String(payload.razon_social || '').trim();
    const quien = String(payload.usuario_nombre || '').trim() || 'Cuenta principal';

    const { data, error } = await this.db
      .from(T_SOL)
      .insert({
        origen: 'portal',
        categoria: datos.categoria,
        descripcion: datos.descripcion,
        cliente_rut: rut,
        cliente_nombre: razon || String(ref.lic?.nombre_entidad || '').trim() || null,
        licitacion_id: ref.licitacion_id,
        documento_tipo: ref.documento_tipo,
        documento_numero: ref.documento_numero,
        documento_id: ref.documento_id,
        pedido_id: ref.pedido_id,
        productos: datos.productos,
        vendedor_email: vendedor,
        creada_por: correoValido(payload.usuario_email),
        creada_por_nombre: quien,
        portal_usuario_id: payload.usuario_id ? Number(payload.usuario_id) : null,
      })
      .select('*')
      .single();
    if (error) throw this.fallo(error);
    this.logger.log(`Postventa: solicitud ${data.id} (${data.categoria}) enviada desde el portal por ${rut} (${quien}); responsable ${vendedor || 'sin asignar'}`);

    await this.pedidosFlujo.anotarActividad({
      rut,
      tipo: 'postventa_solicitud',
      descripcion: `Envió la solicitud de postventa N° ${data.id}: ${nombreCategoria(data.categoria)}.`,
      actorEmail: payload.usuario_email || null,
      actorNombre: payload.usuario_nombre || null,
      origen: 'portal',
      metadata: { postventa_id: Number(data.id), categoria: data.categoria },
    });
    await this.avisarNueva(data, null);
    return { solicitud: solicitudParaCliente(data, []) };
  }
}
