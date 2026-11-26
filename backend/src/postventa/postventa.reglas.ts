/* ── Postventa: reglas puras (2026-11-26) ────────────────────────────────────
   Pedido de Ariel: «Generar módulo de postventa. En este módulo se deben
   registrar los reclamos generados de los clientes a los vendedores según la
   categoría correspondiente […]. Gestionar la solicitud de postventa. Las
   acciones posibles son: Emisión de NC, Emisión de otra factura, emisión de
   guía de despacho. Agregar módulo de solicitud de postventa en portal de
   cliente.»

   Acá va lo que no necesita base de datos, para poder probarlo: categorías y
   estados, qué transición se permite, quién ve qué, cómo se limpia lo que
   llega de la pantalla y qué parte de la bitácora puede ver el cliente. */

export const MIGRACION_POSTVENTA =
  'Falta aplicar la migración 20261126_postventa.sql en Supabase (módulo de Postventa).';

/* Las 8 categorías del pedido, en su orden. La clave es lo que se guarda. */
export const CATEGORIAS = [
  { clave: 'producto_mal_estado', nombre: 'Productos en mal estado' },
  { clave: 'fecha_vencimiento', nombre: 'Fecha de vencimiento' },
  { clave: 'producto_no_corresponde', nombre: 'Producto no corresponde' },
  { clave: 'faltan_cantidades', nombre: 'Faltan cantidades' },
  { clave: 'sobran_cantidades', nombre: 'Sobran cantidades' },
  { clave: 'cambio_peticion_cliente', nombre: 'Cambio a petición del cliente' },
  { clave: 'apelacion_multa', nombre: 'Gestión de apelación de multa' },
  { clave: 'otros', nombre: 'Otros' },
] as const;

export const ESTADOS = [
  { clave: 'ingresada', nombre: 'Ingresada' },
  { clave: 'en_gestion', nombre: 'En gestión' },
  { clave: 'resuelta', nombre: 'Resuelta' },
  { clave: 'rechazada', nombre: 'Rechazada' },
] as const;

/* Las tres acciones del pedido. `documentos` = tipos de `licitacion_documentos`
   que calzan con la acción (la factura puede estar guardada como
   «factura_boleta»). */
export const ACCIONES = [
  { clave: 'nota_credito', nombre: 'Emisión de nota de crédito', corto: 'Nota de crédito', documentos: ['nota_credito'] },
  { clave: 'factura', nombre: 'Emisión de otra factura', corto: 'Factura', documentos: ['factura', 'factura_boleta'] },
  { clave: 'guia_despacho', nombre: 'Emisión de guía de despacho', corto: 'Guía de despacho', documentos: ['guia_despacho'] },
] as const;

/* Documento afectado por el reclamo: una factura (o boleta) o una guía. */
export const TIPOS_DOCUMENTO_AFECTADO = ['factura', 'guia_despacho'] as const;

export type Categoria = (typeof CATEGORIAS)[number]['clave'];
export type Estado = (typeof ESTADOS)[number]['clave'];
export type Accion = (typeof ACCIONES)[number]['clave'];
export type TipoGestion = 'comentario' | 'cambio_estado' | Accion;
export type Origen = 'plataforma' | 'portal';

export const DESCRIPCION_MIN = 5;
export const DESCRIPCION_MAX = 2000;
export const DETALLE_MAX = 1500;
export const PRODUCTOS_MAX = 50;
/* Tope de solicitudes que un mismo usuario del portal puede crear en 24 horas. */
export const LIMITE_PORTAL_24H = 10;

const RE_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export const esCategoria = (v: any): v is Categoria => CATEGORIAS.some((c) => c.clave === v);
export const esEstado = (v: any): v is Estado => ESTADOS.some((e) => e.clave === v);
export const esAccion = (v: any): v is Accion => ACCIONES.some((a) => a.clave === v);
export const nombreCategoria = (v: any) => CATEGORIAS.find((c) => c.clave === v)?.nombre || String(v || '');
export const nombreEstado = (v: any) => ESTADOS.find((e) => e.clave === v)?.nombre || String(v || '');
export const nombreAccion = (v: any) => ACCIONES.find((a) => a.clave === v)?.nombre || String(v || '');
export const cortoAccion = (v: any) => ACCIONES.find((a) => a.clave === v)?.corto || String(v || '');

/* Correo en minúsculas si tiene forma de correo; si no, null. Sin comas,
   paréntesis ni comillas: se usa dentro de filtros de PostgREST. */
export function correoValido(v: any): string | null {
  const c = String(v ?? '').trim().toLowerCase();
  return RE_EMAIL.test(c) ? c : null;
}

/* RUT chileno normalizado: solo dígitos y «k», en minúsculas (como lo guarda
   el portal del cliente y como se compara en todo el sistema). */
export function normalizarRut(v: any): string {
  return String(v ?? '').toLowerCase().replace(/[^0-9k]/g, '');
}

/* 12345678k → 12.345.678-K (para mostrar). */
export function formatearRut(v: any): string {
  const n = normalizarRut(v);
  if (n.length < 2) return n;
  const cuerpo = n.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${n.slice(-1).toUpperCase()}`;
}

/* ── Estados ────────────────────────────────────────────────────────────────
   ingresada → en_gestion (alguien la toma) → resuelta | rechazada.
   Se puede cerrar sin haberla tomado (p. ej. un reclamo que no corresponde) y
   una cerrada se puede reabrir: vuelve a «en gestión». */
export const TRANSICIONES: Record<Estado, Estado[]> = {
  ingresada: ['en_gestion', 'resuelta', 'rechazada'],
  en_gestion: ['resuelta', 'rechazada'],
  resuelta: ['en_gestion'],
  rechazada: ['en_gestion'],
};

export function puedeTransicionar(desde: any, hasta: any): boolean {
  return esEstado(desde) && esEstado(hasta) && TRANSICIONES[desde].includes(hasta);
}

export const esAbierta = (estado: any) => estado === 'ingresada' || estado === 'en_gestion';
export const esCierre = (estado: any) => estado === 'resuelta' || estado === 'rechazada';

/* ── Quién ve qué ───────────────────────────────────────────────────────────
   El administrador y quien tiene «Ver todas las cotizaciones» ven todas las
   solicitudes; el resto solo aquellas donde es el responsable o que creó. */
export type UsuarioPv = { email: string; esAdmin: boolean; permisos: string[] };

export function veTodas(u: Pick<UsuarioPv, 'esAdmin' | 'permisos'>): boolean {
  return !!u.esAdmin || (Array.isArray(u.permisos) && u.permisos.includes('cotizaciones_todas'));
}

export function puedeVer(sol: { vendedor_email?: string | null; creada_por?: string | null; origen?: string | null }, u: UsuarioPv): boolean {
  if (veTodas(u)) return true;
  const yo = String(u.email || '').trim().toLowerCase();
  if (!yo) return false;
  const responsable = String(sol?.vendedor_email || '').trim().toLowerCase();
  // «creada_por» de una solicitud del portal es el correo del cliente: no cuenta.
  const creador = sol?.origen === 'portal' ? '' : String(sol?.creada_por || '').trim().toLowerCase();
  return yo === responsable || yo === creador;
}

/* ── Vendedor responsable ───────────────────────────────────────────────────
   Se propone solo: el vendedor de la cotización si hay (su vendedor o, si no
   tiene, quien la creó); si no, el vendedor asignado del cliente. */
export function vendedorPropuesto(a: { vendedorCotizacion?: any; creadorCotizacion?: any; vendedorCartera?: any }): string | null {
  return correoValido(a.vendedorCotizacion) || correoValido(a.creadorCotizacion) || correoValido(a.vendedorCartera);
}

/* El responsable que queda al crear: un administrador puede elegir otro; sin
   propuesta, una solicitud hecha en la plataforma queda a nombre de quien la
   registra y una del portal queda sin responsable (se avisa a administración). */
export function vendedorAlCrear(a: { propuesto: string | null; pedido?: any; esAdmin: boolean; creador?: any; origen: Origen }): string | null {
  const pedido = correoValido(a.pedido);
  if (a.esAdmin && pedido) return pedido;
  if (a.propuesto) return a.propuesto;
  return a.origen === 'plataforma' ? correoValido(a.creador) : null;
}

/* ── Productos afectados ────────────────────────────────────────────────────
   [{ sku, nombre, cantidad }]: se descartan las filas vacías; la cantidad es
   opcional (null si no se indicó o no es un número mayor que cero). */
export type ProductoAfectado = { sku: string | null; nombre: string; cantidad: number | null };

export function limpiarProductos(crudo: any): ProductoAfectado[] {
  if (!Array.isArray(crudo)) return [];
  const salida: ProductoAfectado[] = [];
  for (const p of crudo) {
    if (!p || typeof p !== 'object') continue;
    const sku = String(p.sku ?? '').trim().slice(0, 60);
    const nombre = String(p.nombre ?? p.producto ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!sku && !nombre) continue;
    const n = Number(String(p.cantidad ?? '').replace(',', '.'));
    salida.push({ sku: sku || null, nombre: nombre || sku, cantidad: Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null });
    if (salida.length >= PRODUCTOS_MAX) break;
  }
  return salida;
}

/* ── Validación de una solicitud nueva (común a plataforma y portal) ──────── */
export type NuevaSolicitud = {
  categoria: Categoria;
  descripcion: string;
  productos: ProductoAfectado[];
  licitacion_id: number | null;
  documento_id: number | null;
  documento_tipo: (typeof TIPOS_DOCUMENTO_AFECTADO)[number] | null;
  documento_numero: string | null;
  pedido_id: number | null;
};

const entero = (v: any): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function validarNueva(body: any): { error: string } | { datos: NuevaSolicitud } {
  if (!esCategoria(body?.categoria)) return { error: 'Elige la categoría de la solicitud.' };
  const descripcion = String(body?.descripcion ?? '').trim();
  if (descripcion.length < DESCRIPCION_MIN) return { error: 'Describe lo que pasó (al menos unas palabras).' };
  if (descripcion.length > DESCRIPCION_MAX) return { error: `La descripción no puede pasar de ${DESCRIPCION_MAX} caracteres.` };
  const tipoCrudo = String(body?.documento_tipo ?? '').trim();
  const documento_tipo = (TIPOS_DOCUMENTO_AFECTADO as readonly string[]).includes(tipoCrudo) ? (tipoCrudo as NuevaSolicitud['documento_tipo']) : null;
  const documento_numero = String(body?.documento_numero ?? '').trim().slice(0, 40) || null;
  const documento_id = entero(body?.documento_id);
  if (!documento_id && documento_numero && !documento_tipo) return { error: 'Indica si el documento afectado es una factura o una guía.' };
  return {
    datos: {
      categoria: body.categoria,
      descripcion,
      productos: limpiarProductos(body?.productos),
      licitacion_id: entero(body?.licitacion_id),
      documento_id,
      documento_tipo: documento_id || documento_numero ? documento_tipo : null,
      documento_numero,
      pedido_id: entero(body?.pedido_id),
    },
  };
}

/* Tipo de documento afectado según cómo está guardado en licitacion_documentos. */
export function tipoAfectadoDe(tipoDoc: any): NuevaSolicitud['documento_tipo'] {
  const t = String(tipoDoc || '');
  if (t === 'factura' || t === 'factura_boleta') return 'factura';
  if (t === 'guia_despacho') return 'guia_despacho';
  return null;
}

/* ¿Ese documento de la cotización sirve como resultado de la acción? */
export function documentoCalzaConAccion(accion: any, tipoDoc: any): boolean {
  const a = ACCIONES.find((x) => x.clave === accion);
  return !!a && (a.documentos as readonly string[]).includes(String(tipoDoc || ''));
}

/* ── Lo que ve el cliente en su portal ──────────────────────────────────────
   Los comentarios son internos salvo que se marquen para el cliente; los
   cambios de estado y los documentos emitidos sí se le muestran. */
export function visibleClientePorDefecto(tipo: TipoGestion): boolean {
  return tipo !== 'comentario';
}

export function visibleCliente(tipo: TipoGestion, pedido?: any): boolean {
  return tipo === 'comentario' ? pedido === true : true;
}

export type GestionCliente = { id: number; tipo: string; titulo: string; detalle: string | null; documento_numero: string | null; fecha: string | null };

export function tituloGestion(tipo: any): string {
  if (tipo === 'comentario') return 'Mensaje de Amsodent';
  if (tipo === 'cambio_estado') return 'Cambio de estado';
  return nombreAccion(tipo);
}

/* Solo las gestiones marcadas visibles, y sin el correo de quien las hizo. */
export function gestionesParaCliente(gestiones: any[]): GestionCliente[] {
  return (Array.isArray(gestiones) ? gestiones : [])
    .filter((g) => g && g.visible_cliente === true)
    .map((g) => ({
      id: Number(g.id),
      tipo: String(g.tipo),
      titulo: tituloGestion(g.tipo),
      detalle: g.detalle ? String(g.detalle) : null,
      documento_numero: g.documento_numero ? String(g.documento_numero) : null,
      fecha: g.created_at || null,
    }));
}

/* La solicitud como la ve el cliente: sin responsable ni datos internos. */
export function solicitudParaCliente(sol: any, gestiones: any[]) {
  return {
    id: Number(sol.id),
    created_at: sol.created_at || null,
    updated_at: sol.updated_at || null,
    categoria: String(sol.categoria),
    categoria_nombre: nombreCategoria(sol.categoria),
    descripcion: String(sol.descripcion || ''),
    estado: String(sol.estado),
    estado_nombre: nombreEstado(sol.estado),
    documento_tipo: sol.documento_tipo || null,
    documento_numero: sol.documento_numero || null,
    pedido_id: sol.pedido_id != null ? Number(sol.pedido_id) : null,
    licitacion_id: sol.licitacion_id != null ? Number(sol.licitacion_id) : null,
    productos: Array.isArray(sol.productos) ? sol.productos : [],
    creada_por_nombre: sol.creada_por_nombre || null,
    resolucion: esCierre(sol.estado) ? sol.resolucion || null : null,
    cerrada_at: esCierre(sol.estado) ? sol.cerrada_at || null : null,
    gestiones: gestionesParaCliente(gestiones),
  };
}

/* ¿Ya llegó al tope de solicitudes del día? */
export function superaLimite(creadasEn24h: number, max = LIMITE_PORTAL_24H): boolean {
  return Number(creadasEn24h) >= max;
}

/* ── Textos de los avisos ───────────────────────────────────────────────── */
export function mensajeAvisoNueva(sol: { id: number; categoria: string; cliente_nombre?: string | null; cliente_rut?: string | null; origen?: string | null }): string {
  const cliente = String(sol.cliente_nombre || '').trim() || formatearRut(sol.cliente_rut) || 'un cliente';
  const desde = sol.origen === 'portal' ? ' (enviada desde el portal del cliente)' : '';
  return `Solicitud de postventa N° ${sol.id} de ${cliente}: ${nombreCategoria(sol.categoria)}${desde}.`.slice(0, 300);
}

export function mensajeAvisoCliente(a: { id: number; tipo: TipoGestion; estado?: any; documento_numero?: string | null }): string {
  if (a.tipo === 'cambio_estado') {
    if (a.estado === 'en_gestion') return `Tu solicitud de postventa N° ${a.id} está en gestión.`;
    if (a.estado === 'resuelta') return `Tu solicitud de postventa N° ${a.id} fue resuelta.`;
    if (a.estado === 'rechazada') return `Tu solicitud de postventa N° ${a.id} fue rechazada: revisa el motivo.`;
    return `Tu solicitud de postventa N° ${a.id} cambió de estado.`;
  }
  if (a.tipo === 'comentario') return `Amsodent respondió tu solicitud de postventa N° ${a.id}.`;
  const doc = cortoAccion(a.tipo).toLowerCase();
  return `Emitimos una ${doc}${a.documento_numero ? ` N° ${a.documento_numero}` : ''} por tu solicitud de postventa N° ${a.id}.`;
}

/* ¿El error de Supabase es porque la tabla (o una columna) no existe todavía? */
export function sinTabla(error: any): boolean {
  return /(schema cache|does not exist|not find|PGRST205|PGRST204|42P01|42703)/i.test(`${error?.code} ${error?.message}`);
}
