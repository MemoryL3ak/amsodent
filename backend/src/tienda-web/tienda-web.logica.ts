import { timingSafeEqual } from 'crypto';

/* Lógica pura de la integración con la tienda web (2026-11-26): validar lo
   que manda la tienda y traducirlo al cuerpo de la venta directa de
   BsaleLibreService. Sin base de datos ni Bsale, para poder probarla sola. */

export type PedidoTienda = {
  pedido: string;
  tipo: 'boleta' | 'factura';
  medio_pago: 'webpay' | 'transferencia';
  referencia_pago: string;
  cliente: { rut: string; razon_social: string; giro: string; direccion: string; comuna: string; ciudad: string; email: string };
  despacho: { destinatario: string; direccion: string; comuna: string; ciudad: string } | null;
  lineas: { sku: string; producto: string; cantidad: number; neto_unitario: number }[];
  despacho_neto: number;
  total_tienda: number;
  simular: boolean;
};

const txt = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
// Solo enteros: un 1,5 no se redondea en silencio (cantidades y pesos chilenos no llevan decimales).
const entero = (v: any) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

// N° de pedido de la tienda: AMS-2026-0031 (se admite cualquier código corto y seguro).
export const PEDIDO_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/* Valida la entrada. Devuelve el pedido normalizado o la lista de errores
   (en español, tal cual se muestran en el panel de la tienda). */
export function validarPedido(body: any): { ok: true; pedido: PedidoTienda } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  const pedido = txt(body?.pedido, 40).toUpperCase();
  if (!PEDIDO_RE.test(pedido)) errores.push('El número de pedido no es válido.');
  const tipo = body?.tipo === 'factura' ? 'factura' : body?.tipo === 'boleta' ? 'boleta' : null;
  if (!tipo) errores.push('El tipo de documento debe ser «boleta» o «factura».');
  const medio = body?.medio_pago === 'webpay' ? 'webpay' : body?.medio_pago === 'transferencia' ? 'transferencia' : null;
  if (!medio) errores.push('El medio de pago debe ser «webpay» o «transferencia».');
  const c = body?.cliente || {};
  const cliente = {
    rut: txt(c.rut, 12), razon_social: txt(c.razon_social, 120), giro: txt(c.giro, 80), direccion: txt(c.direccion, 120),
    comuna: txt(c.comuna, 60), ciudad: txt(c.ciudad || c.comuna, 60), email: txt(c.email, 120),
  };
  if (tipo === 'factura') {
    const faltan = [!cliente.rut && 'RUT', !cliente.razon_social && 'razón social', !cliente.giro && 'giro', !cliente.direccion && 'dirección', !cliente.comuna && 'comuna'].filter(Boolean);
    if (faltan.length) errores.push(`La factura necesita ${faltan.join(', ')} del cliente.`);
  }
  const d = body?.despacho;
  const despacho = d && typeof d === 'object'
    ? { destinatario: txt(d.destinatario, 120), direccion: txt(d.direccion, 120), comuna: txt(d.comuna, 60), ciudad: txt(d.ciudad || d.comuna, 60) }
    : null;
  const crudas: any[] = Array.isArray(body?.lineas) ? body.lineas : [];
  if (!crudas.length) errores.push('El pedido no trae productos.');
  if (crudas.length > 150) errores.push('Máximo 150 productos por pedido.');
  const lineas = crudas.map((l, i) => {
    const linea = { sku: txt(l?.sku, 64), producto: txt(l?.producto, 160), cantidad: entero(l?.cantidad), neto_unitario: entero(l?.neto_unitario) };
    if (!linea.sku) errores.push(`Producto ${i + 1} (${linea.producto || 'sin nombre'}): falta el SKU.`);
    if (!(linea.cantidad > 0)) errores.push(`Producto ${i + 1}: la cantidad debe ser un entero mayor que 0.`);
    if (!(linea.neto_unitario > 0)) errores.push(`Producto ${i + 1}: el precio neto unitario debe ser mayor que 0.`);
    return linea;
  });
  const despachoNeto = body?.despacho_neto == null ? 0 : entero(body.despacho_neto);
  if (!(despachoNeto >= 0)) errores.push('El neto del despacho no es válido.');
  const totalTienda = entero(body?.total_tienda);
  if (!(totalTienda > 0)) errores.push('Falta el total cobrado por la tienda.');
  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    pedido: {
      pedido, tipo: tipo!, medio_pago: medio!, referencia_pago: txt(body?.referencia_pago, 60) || pedido,
      cliente, despacho, lineas, despacho_neto: despachoNeto, total_tienda: totalTienda, simular: body?.simular === true,
    },
  };
}

/* Forma de pago de Bsale para el medio de la tienda: primero el id fijado por
   variable de entorno; si no, por nombre. Devuelve null si no hay calce
   (el pedido queda con error y no se emite con una forma de pago inventada). */
export function formaDePago(formas: { id: number; nombre: string }[], medio: 'webpay' | 'transferencia', idFijado?: string | null) {
  const id = Number(idFijado);
  if (id > 0) return formas.find((f) => f.id === id) || null;
  const patrones = medio === 'webpay' ? [/webpay/i, /transbank|tbk/i, /tarjeta/i] : [/transferencia/i];
  for (const p of patrones) {
    const f = formas.find((x) => p.test(x.nombre));
    if (f) return f;
  }
  return null;
}

/* Cuerpo de la venta directa (BsaleLibreService.emitir). La guía de despacho
   (que rebaja el stock) necesita un cliente con RUT y una dirección; sin eso,
   el documento mismo descuenta el stock (dispatch). El despacho va como
   GLOSA: no es un producto y no mueve stock. */
export function cuerpoVentaDirecta(p: PedidoTienda, formaPagoId: number, fecha: string) {
  const conGuia = !!p.cliente.rut && !!p.despacho && !!p.despacho.direccion && !!p.despacho.comuna;
  return {
    tipo: p.tipo,
    venta_directa: true,
    simular: p.simular,
    fecha_emision: fecha,
    cliente: { ...p.cliente },
    lineas: [
      ...p.lineas.map((l) => ({ sku: l.sku, producto: l.producto, cantidad: l.cantidad, neto_unitario: l.neto_unitario })),
      ...(p.despacho_neto > 0 ? [{ glosa: 'Despacho', cantidad: 1, neto_unitario: p.despacho_neto }] : []),
    ],
    forma_pago_id: formaPagoId,
    dias_vencimiento: 0,
    comprobante: p.referencia_pago,
    con_guia: conGuia,
    ...(conGuia ? { despacho: { ...p.despacho } } : {}),
    observacion: `Pedido web ${p.pedido}`,
  };
}

// Comparación en tiempo constante de la clave de integración.
export function claveValida(recibida: string, esperada: string): boolean {
  const a = Buffer.from(String(recibida || ''));
  const b = Buffer.from(String(esperada || ''));
  if (!b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
