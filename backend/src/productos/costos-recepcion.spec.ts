import { alertasDeCosto, costoMayor, mensajeCostoMayor, preciosPedidosEnAlerta, ultimaPorProducto } from './costos-recepcion';

const linea = (extra: any = {}) => ({ id: 1, recepcion_id: 10, producto_id: 100, sku: 'A-1', nombre: 'Resina', cantidad: 5, costo_unitario: 1200, costo_decision: null, documento: 'Factura N° 55', proveedor: 'Dental SA', fecha: '2026-11-17T12:00:00Z', usuario: 'f@x.cl', ...extra });
const productos = (extra: any = {}) => new Map([[100, { id: 100, sku: 'A-1', nombre: 'Resina', marca: '3M', categoria: 'Operatoria', costo: 1000, lista1: 2000, lista2: 1500, lista3: 0, ...extra }]]);

describe('costo de la recepción mayor que el del producto', () => {
  it('solo alerta cuando el costo recibido es superior', () => {
    expect(costoMayor(1200, 1000)).toBe(true);
    expect(costoMayor(1000, 1000)).toBe(false);
    expect(costoMayor(900, 1000)).toBe(false);
    expect(costoMayor(1000.4, 1000)).toBe(false); // diferencias de centavos no cuentan
    expect(costoMayor(0, 0)).toBe(false);
    expect(costoMayor(500, 0)).toBe(true); // el producto no tenía costo
    expect(alertasDeCosto([linea({ costo_unitario: 1000 })], productos())).toEqual([]);
  });

  it('arma la alerta con el alza y el margen de cada lista antes y después', () => {
    const [a] = alertasDeCosto([linea()], productos());
    expect(a).toMatchObject({ linea_id: 1, producto_id: 100, sku: 'A-1', costo_actual: 1000, costo_recepcion: 1200, diferencia: 200, alza_pct: 20, documento: 'Factura N° 55' });
    expect(a.margenes).toEqual([
      { lista: 'lista1', precio: 2000, actual: 50, nuevo: 40 },
      { lista: 'lista2', precio: 1500, actual: 33.3, nuevo: 20 },
      { lista: 'lista3', precio: 1620, actual: 38.3, nuevo: 25.9 }, // lista 3 vacía = lista 2 × 1,08
    ]);
  });

  it('manda la última recepción del producto', () => {
    const lineas = [linea({ id: 1, costo_unitario: 1500 }), linea({ id: 2, recepcion_id: 11, costo_unitario: 900 })];
    expect(ultimaPorProducto(lineas).get(100)?.id).toBe(2);
    expect(alertasDeCosto(lineas, productos())).toEqual([]); // la más nueva llegó más barata
    const alReves = [linea({ id: 3, recepcion_id: 12, costo_unitario: 1300 }), ...lineas];
    expect(alertasDeCosto(alReves, productos())[0]).toMatchObject({ linea_id: 3, costo_recepcion: 1300 });
  });

  it('una alerta ya decidida no vuelve a aparecer', () => {
    expect(alertasDeCosto([linea({ costo_decision: 'momentanea' })], productos())).toEqual([]);
    expect(alertasDeCosto([linea({ costo_decision: 'definitiva' })], productos())).toEqual([]);
    // Tras «definitiva» el costo del producto ya es el recibido: tampoco alerta aunque no quede anotada.
    expect(alertasDeCosto([linea()], productos({ costo: 1200 }))).toEqual([]);
  });

  it('un producto sin costo recibe la alerta sin porcentaje y va al final', () => {
    const mapa = productos();
    mapa.set(200, { id: 200, sku: 'B-2', nombre: 'Guantes', costo: 0, lista1: 0, lista2: 0, lista3: 0 } as any);
    const alertas = alertasDeCosto([linea(), linea({ id: 2, producto_id: 200, sku: 'B-2', costo_unitario: 500 })], mapa);
    expect(alertas.map((a) => a.producto_id)).toEqual([100, 200]);
    expect(alertas[1]).toMatchObject({ alza_pct: null, costo_actual: 0, margenes: [] });
  });

  it('el aviso de la campana no lleva montos', () => {
    const m = mensajeCostoMayor(12, [{ sku: 'A-1' }, { sku: 'B-2' }, { nombre: 'Sin SKU' }, { sku: 'C-3' }, { sku: 'D-4' }]);
    expect(m).toContain('Recepción #12: 5 productos llegaron con un costo mayor');
    expect(m).toContain('A-1, B-2, Sin SKU, C-3 y 1 más');
    expect(m).not.toMatch(/\$\s?\d/);
    expect(mensajeCostoMayor(3, [{ sku: 'A-1' }])).toContain('1 producto llegó');
  });
});

describe('listas 1 y 2 junto al alza definitiva del costo (2026-11-26)', () => {
  const actual = { lista1: 10000, lista2: 12000 };

  it('sin precios pedidos no cambia ninguna lista', () => {
    expect(preciosPedidosEnAlerta({}, actual)).toEqual({});
    expect(preciosPedidosEnAlerta(null, actual)).toEqual({});
    expect(preciosPedidosEnAlerta({ lista1: '', lista2: null }, actual)).toEqual({});
  });

  it('devuelve solo las listas que cambian, redondeadas a pesos', () => {
    expect(preciosPedidosEnAlerta({ lista1: 11500.4, lista2: 12000 }, actual)).toEqual({ lista1: 11500 });
    expect(preciosPedidosEnAlerta({ lista1: '10000', lista2: '13990' }, actual)).toEqual({ lista2: 13990 });
  });

  it('acepta poner precio a una lista que no lo tenía', () => {
    expect(preciosPedidosEnAlerta({ lista1: 5000 }, { lista1: 0, lista2: 0 })).toEqual({ lista1: 5000 });
  });

  it('rechaza lo que no es un precio', () => {
    expect(() => preciosPedidosEnAlerta({ lista1: 0 }, actual)).toThrow(/lista 1/);
    expect(() => preciosPedidosEnAlerta({ lista2: -5 }, actual)).toThrow(/lista 2/);
    expect(() => preciosPedidosEnAlerta({ lista1: 'abc' }, actual)).toThrow(/lista 1/);
    expect(() => preciosPedidosEnAlerta({ lista2: 1e12 }, actual)).toThrow(/demasiado alto/);
  });

  it('la alerta trae los precios vigentes de las listas 1 y 2', () => {
    const lineas: any[] = [{ id: 1, recepcion_id: 9, producto_id: 5, cantidad: 2, costo_unitario: 700, created_at: '2026-11-20T10:00:00Z' }];
    const productos = new Map<number, any>([[5, { id: 5, sku: 'X-1', nombre: 'Prueba', costo: 500, lista1: 1000, lista2: 1200 }]]);
    const [a] = alertasDeCosto(lineas as any, productos as any);
    expect(a.lista1).toBe(1000);
    expect(a.lista2).toBe(1200);
  });
});
