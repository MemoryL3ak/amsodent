import { claveValida, cuerpoVentaDirecta, formaDePago, validarPedido } from './tienda-web.logica';

const base = () => ({
  pedido: 'ams-2026-0031',
  tipo: 'factura',
  medio_pago: 'webpay',
  referencia_pago: '123456',
  cliente: { rut: '76.123.456-0', razon_social: 'Clínica Sonrisa SpA', giro: 'Clínica dental', direccion: 'Av. Siempre Viva 123', comuna: 'San Bernardo', email: 'a@b.cl' },
  despacho: { destinatario: 'Clínica Sonrisa', direccion: 'Av. Siempre Viva 123', comuna: 'San Bernardo' },
  lineas: [{ sku: 'PH00302', producto: 'Clorhexidina', cantidad: 2, neto_unitario: 4202 }],
  despacho_neto: 2605,
  total_tienda: 13100,
});

describe('pedido de la tienda web', () => {
  it('normaliza un pedido válido (N° en mayúsculas, ciudad = comuna si falta)', () => {
    const r = validarPedido(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pedido.pedido).toBe('AMS-2026-0031');
    expect(r.pedido.cliente.ciudad).toBe('San Bernardo');
    expect(r.pedido.despacho?.ciudad).toBe('San Bernardo');
    expect(r.pedido.simular).toBe(false);
  });

  it('rechaza una factura sin los datos tributarios', () => {
    const b: any = base();
    b.cliente = { rut: '', razon_social: '', giro: '', direccion: '', comuna: '' };
    const r = validarPedido(b);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores.join(' ')).toMatch(/RUT, razón social, giro, dirección, comuna/);
  });

  it('acepta una boleta sin RUT (consumidor final)', () => {
    const b: any = { ...base(), tipo: 'boleta', cliente: { razon_social: 'Ana Pérez' } };
    expect(validarPedido(b).ok).toBe(true);
  });

  it('rechaza cantidades y precios no enteros o en cero, y medios de pago desconocidos', () => {
    const b: any = { ...base(), medio_pago: 'efectivo', lineas: [{ sku: 'X1', cantidad: 1.5, neto_unitario: 0 }] };
    const r = validarPedido(b);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toEqual(expect.arrayContaining([
      'El medio de pago debe ser «webpay» o «transferencia».',
      'Producto 1: la cantidad debe ser un entero mayor que 0.',
      'Producto 1: el precio neto unitario debe ser mayor que 0.',
    ]));
  });

  it('rechaza un N° de pedido con caracteres raros', () => {
    expect(validarPedido({ ...base(), pedido: 'AMS 2026/31; drop' }).ok).toBe(false);
  });
});

describe('forma de pago de Bsale', () => {
  const formas = [{ id: 1, nombre: 'Efectivo' }, { id: 4, nombre: 'Transferencia Bancaria' }, { id: 7, nombre: 'Tarjeta de crédito' }, { id: 9, nombre: 'WebPay' }];
  it('calza por nombre', () => {
    expect(formaDePago(formas, 'webpay')?.id).toBe(9);
    expect(formaDePago(formas, 'transferencia')?.id).toBe(4);
  });
  it('sin Webpay cae en tarjeta; sin calce devuelve null', () => {
    expect(formaDePago(formas.filter((f) => f.id !== 9), 'webpay')?.id).toBe(7);
    expect(formaDePago([{ id: 1, nombre: 'Efectivo' }], 'transferencia')).toBeNull();
  });
  it('el id fijado por variable manda (y si no existe, null: nunca una forma inventada)', () => {
    expect(formaDePago(formas, 'webpay', '7')?.id).toBe(7);
    expect(formaDePago(formas, 'webpay', '99')).toBeNull();
  });
});

describe('cuerpo de la venta directa', () => {
  const pedido = () => {
    const r = validarPedido(base());
    if (!r.ok) throw new Error('pedido inválido');
    return r.pedido;
  };

  it('agrega el despacho como glosa y emite guía si hay RUT y dirección', () => {
    const c: any = cuerpoVentaDirecta(pedido(), 9, '2026-11-26');
    expect(c.venta_directa).toBe(true);
    expect(c.con_guia).toBe(true);
    expect(c.despacho.direccion).toBe('Av. Siempre Viva 123');
    expect(c.lineas).toEqual([
      { sku: 'PH00302', producto: 'Clorhexidina', cantidad: 2, neto_unitario: 4202 },
      { glosa: 'Despacho', cantidad: 1, neto_unitario: 2605 },
    ]);
    expect(c.comprobante).toBe('123456');
    expect(c.forma_pago_id).toBe(9);
  });

  it('sin despacho cobrado no hay glosa; sin RUT no hay guía (la boleta descuenta el stock)', () => {
    const p = { ...pedido(), tipo: 'boleta' as const, despacho_neto: 0, cliente: { ...pedido().cliente, rut: '' } };
    const c: any = cuerpoVentaDirecta(p, 9, '2026-11-26');
    expect(c.lineas.some((l: any) => l.glosa)).toBe(false);
    expect(c.con_guia).toBe(false);
    expect(c.despacho).toBeUndefined();
  });
});

describe('clave de integración', () => {
  it('compara en tiempo constante y rechaza vacías o de otro largo', () => {
    const k = 'x'.repeat(40);
    expect(claveValida(k, k)).toBe(true);
    expect(claveValida('y'.repeat(40), k)).toBe(false);
    expect(claveValida('x', k)).toBe(false);
    expect(claveValida('', '')).toBe(false);
  });
});

/* Contrato con la tienda: este es EXACTAMENTE el cuerpo que arma la tienda
   (amsodent-medical, site/src/modules/invoicing/domain/erpInvoice.test.ts).
   Si alguno de los dos lados cambia el formato, esta prueba lo detecta. */
describe('contrato con la tienda amsodentmedical.cl', () => {
  it('el pedido que manda la tienda pasa la validación y arma la venta directa', () => {
    const r = validarPedido({
      pedido: 'AMS-2026-0031', tipo: 'factura', medio_pago: 'webpay', referencia_pago: '1213',
      cliente: { rut: '76123456-0', razon_social: 'Clínica Sonrisa SpA', giro: 'Clínica dental', direccion: 'Av. Siempre Viva 123', comuna: 'San Bernardo', ciudad: 'San Bernardo', email: 'dte@clinica.cl' },
      despacho: { destinatario: 'Ana Pérez', direccion: 'Av. Siempre Viva 123, of. 4', comuna: 'San Bernardo', ciudad: 'San Bernardo' },
      lineas: [{ sku: 'PH00302', producto: 'Clorhexidina · 125 ml', cantidad: 2, neto_unitario: 3782 }],
      despacho_neto: 2605,
      total_tienda: 12100,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c: any = cuerpoVentaDirecta(r.pedido, 9, '2026-11-26');
    expect(c.lineas).toHaveLength(2);
    expect(c.con_guia).toBe(true);
  });

  it('una boleta por transferencia con retiro en tienda (sin RUT ni despacho)', () => {
    const r = validarPedido({
      pedido: 'AMS-2026-0032', tipo: 'boleta', medio_pago: 'transferencia', referencia_pago: 'AMS-2026-0032',
      cliente: { rut: '', razon_social: 'Ana Pérez', giro: '', direccion: 'Av. Siempre Viva 123', comuna: 'San Bernardo', ciudad: 'San Bernardo', email: 'dte@clinica.cl' },
      despacho: null,
      lineas: [{ sku: 'PH00302', producto: 'Clorhexidina · 125 ml', cantidad: 2, neto_unitario: 3782 }],
      despacho_neto: 0,
      total_tienda: 9000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((cuerpoVentaDirecta(r.pedido, 4, '2026-11-26') as any).con_guia).toBe(false);
  });
});
