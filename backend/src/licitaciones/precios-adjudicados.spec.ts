import { NOSOTROS, adjudicacionDeLinea, desenlaceInterno, esParticular, sinRepetidas } from './precios-adjudicados';

/* Precios adjudicados en Mercado Público por producto (2026-11-12). Los casos
   salen de fichas reales (muestra del 2026-11-12). */

const cot = (extra: any = {}) => ({
  id: 5909,
  id_licitacion: '2735-1290-COT26',
  nombre_entidad: 'Hospital de Talca',
  estado: 'Perdida',
  fecha: '2026-10-13',
  fecha_adjudicada: null,
  tipo_cliente: 'Entidad Pública',
  tipo_compra: 'Compra Ágil',
  ...extra,
});
const linea = (valor_unitario: number, cantidad: number, licitacion_id = 5909) => ({ licitacion_id, cantidad, valor_unitario });

const fichaPerdida = (items: any[], extra: any = {}) => ({
  licitacion_id: 5909,
  codigo_mp: '2735-1290-COT26',
  tipo: 'compra_agil',
  estado_mp: 'proveedor_seleccionado',
  ganamos: false,
  participamos: true,
  ganador_nombre: 'GRUPO MEDENT SPA',
  fecha_adjudicacion: '2026-10-22T08:55:00+00:00',
  organismo: 'Hospital de Talca',
  comparacion_items: items,
  ...extra,
});

describe('adjudicacionDeLinea · Compra Ágil', () => {
  it('ganada: se adjudicó a nuestro precio', () => {
    const { fila } = adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'Adjudicada' }), fichaPerdida([], { ganamos: true, ganador_nombre: 'AMSODENT MEDICAL SPA' }));
    expect(fila).toMatchObject({ resultado: 'ganada', precio_adjudicado: 3000, nuestro_precio: 3000, ganador: NOSOTROS, calce: 'exacto', fecha: '2026-10-22' });
  });

  it('perdida: reconoce la línea por su precio y trae el precio ganador', () => {
    const items = [
      { nombre: 'Mascarillas', nuestro_precio: 42, precio_ganador: 36, nuestra_cantidad: 20000, cantidad_ganador: 20000 },
      { nombre: 'Guantes', nuestro_precio: 2594, precio_ganador: 2100, nuestra_cantidad: 10, cantidad_ganador: 10 },
    ];
    const { fila, faltaContexto } = adjudicacionDeLinea(linea(42, 20000), cot(), fichaPerdida(items));
    expect(faltaContexto).toBe(false);
    expect(fila).toMatchObject({ resultado: 'perdida', precio_adjudicado: 36, ganador: 'GRUPO MEDENT SPA', calce: 'exacto', codigo_mp: '2735-1290-COT26' });
  });

  it('varias líneas con el mismo precio: desempata por cantidad', () => {
    const items = [
      { nuestro_precio: 3000, precio_ganador: 1990, nuestra_cantidad: 18 },
      { nuestro_precio: 3000, precio_ganador: 2500, nuestra_cantidad: 40 },
    ];
    expect(adjudicacionDeLinea(linea(3000, 40), cot(), fichaPerdida(items)).fila).toMatchObject({ precio_adjudicado: 2500, calce: 'exacto' });
  });

  it('mismo precio y cantidad, todas adjudicadas igual: da lo mismo cuál sea', () => {
    const items = [
      { nuestro_precio: 3000, precio_ganador: 1990, nuestra_cantidad: 18 },
      { nuestro_precio: 3000, precio_ganador: 1990, nuestra_cantidad: 18 },
      { nuestro_precio: 4500, precio_ganador: 1990, nuestra_cantidad: 18 },
    ];
    expect(adjudicacionDeLinea(linea(3000, 18), cot(), fichaPerdida(items)).fila).toMatchObject({ precio_adjudicado: 1990, calce: 'exacto' });
  });

  it('candidatas con precios ganadores parecidos: promedio aproximado; muy distintos: sin dato', () => {
    const parecidos = [
      { nuestro_precio: 3000, precio_ganador: 2000, nuestra_cantidad: 18 },
      { nuestro_precio: 3000, precio_ganador: 2100, nuestra_cantidad: 18 },
    ];
    expect(adjudicacionDeLinea(linea(3000, 18), cot(), fichaPerdida(parecidos)).fila).toMatchObject({ precio_adjudicado: 2050, calce: 'aproximado' });
    const distintos = [
      { nuestro_precio: 3000, precio_ganador: 1000, nuestra_cantidad: 18 },
      { nuestro_precio: 3000, precio_ganador: 2900, nuestra_cantidad: 18 },
    ];
    // Sin las demás líneas de la cotización no se decide: las pide.
    expect(adjudicacionDeLinea({ id: 12, ...linea(3000, 18) }, cot(), fichaPerdida(distintos))).toEqual({ fila: null, faltaContexto: true });
    // Dos gemelas nuestras y dos en la ficha: se emparejan en orden.
    const gemelas = [{ id: 11, ...linea(3000, 18) }, { id: 12, ...linea(3000, 18) }, { id: 13, ...linea(900, 5) }];
    expect(adjudicacionDeLinea(gemelas[0], cot(), fichaPerdida(distintos), gemelas).fila).toMatchObject({ precio_adjudicado: 1000, calce: 'aproximado' });
    expect(adjudicacionDeLinea(gemelas[1], cot(), fichaPerdida(distintos), gemelas).fila).toMatchObject({ precio_adjudicado: 2900, calce: 'aproximado' });
    // Si no hay la misma cantidad de gemelas a cada lado, no se adivina.
    expect(adjudicacionDeLinea(gemelas[1], cot(), fichaPerdida(distintos), [gemelas[1], gemelas[2]]).fila).toMatchObject({ resultado: 'perdida', precio_adjudicado: null, calce: 'sin_dato' });
  });

  it('precio ajustado al postular: reconoce la línea por cantidad y usa lo ofertado en Mercado Público', () => {
    // Caso real 5350-477-COT26: cotización a $62, oferta en MP a $46, ganó $19.
    const items = [{ nombre: 'Mascarillas', nuestro_precio: 46, precio_ganador: 19, nuestra_cantidad: 20000, cantidad_ganador: 20000 }];
    const mia = { id: 1, ...linea(62, 20000) };
    expect(adjudicacionDeLinea(mia, cot(), fichaPerdida(items))).toEqual({ fila: null, faltaContexto: true });
    expect(adjudicacionDeLinea(mia, cot(), fichaPerdida(items), [mia]).fila).toMatchObject({
      resultado: 'perdida', nuestro_precio: 46, precio_adjudicado: 19, calce: 'aproximado', atipico: false,
    });
    // Misma cantidad pero un precio de otro orden: no es nuestra línea.
    const otro = [{ nuestro_precio: 900, precio_ganador: 700, nuestra_cantidad: 20000 }];
    expect(adjudicacionDeLinea(mia, cot(), fichaPerdida(otro), [mia]).fila).toMatchObject({ precio_adjudicado: null, calce: 'sin_dato' });
    // Dos ítems con esa cantidad y ofertas distintas: no se adivina cuál es.
    const dos = [
      { nuestro_precio: 46, precio_ganador: 19, nuestra_cantidad: 20000 },
      { nuestro_precio: 70, precio_ganador: 50, nuestra_cantidad: 20000 },
    ];
    expect(adjudicacionDeLinea(mia, cot(), fichaPerdida(dos), [mia]).fila).toMatchObject({ precio_adjudicado: null, calce: 'sin_dato' });
    // El ítem de esa cantidad es de OTRA línea nuestra (calza con su precio): no es el de esta.
    const hermana = { id: 2, ...linea(46, 20000) };
    expect(adjudicacionDeLinea(mia, cot(), fichaPerdida(items), [mia, hermana]).fila).toMatchObject({ precio_adjudicado: null, calce: 'sin_dato' });
    // Dos líneas nuestras sin calce con esa cantidad y un solo ítem libre: no se sabe de cuál es.
    const otraSinCalce = { id: 3, ...linea(58, 20000) };
    expect(adjudicacionDeLinea(mia, cot(), fichaPerdida(items), [mia, otraSinCalce]).fila).toMatchObject({ precio_adjudicado: null, calce: 'sin_dato' });
  });

  it('marca como atípico un precio ganador de otro orden (dato mal ingresado en Mercado Público)', () => {
    const items = [{ nuestro_precio: 929, precio_ganador: 21, nuestra_cantidad: 100 }];
    expect(adjudicacionDeLinea(linea(929, 100), cot(), fichaPerdida(items)).fila).toMatchObject({ precio_adjudicado: 21, atipico: true });
  });

  it('cotizada por el total: pide el resto de la cotización y estima con la proporción', () => {
    const items = [{ nombre: 'Unidades dentales', nuestro_precio: 1000000, precio_ganador: 800000, nuestra_cantidad: 1, cantidad_ganador: 1 }];
    const ficha = fichaPerdida(items);
    expect(adjudicacionDeLinea(linea(5000, 10), cot(), ficha)).toEqual({ fila: null, faltaContexto: true });
    const todas = [linea(5000, 10), linea(95000, 10)];
    expect(adjudicacionDeLinea(linea(5000, 10), cot(), ficha, todas).fila).toMatchObject({ resultado: 'perdida', precio_adjudicado: 4000, calce: 'estimado' });
    // Con una sola línea nuestra no es «por el total»: no se inventa un precio.
    expect(adjudicacionDeLinea(linea(5000, 10), cot(), ficha, [linea(5000, 10)]).fila).toMatchObject({ precio_adjudicado: null, calce: 'sin_dato' });
  });

  it('sin nuestra oferta en el proceso no dice nada', () => {
    expect(adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'En espera' }), fichaPerdida([], { participamos: false })).fila).toBeNull();
  });

  it('ficha perdida pero la cotización terminó Adjudicada: vale la cotización', () => {
    const items = [{ nuestro_precio: 3000, precio_ganador: 1990, nuestra_cantidad: 18 }];
    expect(adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'Adjudicada', fecha_adjudicada: '2026-10-25' }), fichaPerdida(items)).fila).toMatchObject({ resultado: 'ganada', precio_adjudicado: 3000 });
  });

  it('proceso aún sin resolver: no aparece', () => {
    expect(adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'En espera' }), fichaPerdida([], { ganamos: null, estado_mp: 'cerrada' })).fila).toBeNull();
  });
});

describe('adjudicacionDeLinea · Licitación', () => {
  const ficha = (items: any[], extra: any = {}) => ({
    licitacion_id: 5909,
    codigo_mp: '1237328-59-LP26',
    tipo: 'licitacion',
    estado_mp: 'adjudicada',
    ganamos: true,
    participamos: null,
    ganador_nombre: 'CLAN DENT COMERCIALIZADORA LIMITADA',
    fecha_adjudicacion: '2026-10-22T11:45:21.517+00:00',
    organismo: 'Servicio de Salud',
    comparacion_items: items,
    ...extra,
  });
  const items = [
    { cantidad_ganador: 160, precio_ganador: 924, ganador_nombre: 'CLAN DENT', ganado_por_nosotros: false },
    { cantidad_ganador: 380, precio_ganador: 924, ganador_nombre: 'CLAN DENT', ganado_por_nosotros: false },
    { cantidad_ganador: 160, precio_ganador: 1268, ganador_nombre: 'AMSODENT MEDICAL SPA', ganado_por_nosotros: true },
    { cantidad_ganador: 50, precio_ganador: 6100, ganador_nombre: 'MAYORDENT', ganado_por_nosotros: false },
  ];

  it('lo que nos adjudicaron a nuestro precio es una ganada segura', () => {
    expect(adjudicacionDeLinea(linea(1268, 160), cot({ estado: 'Adjudicada' }), ficha(items)).fila).toMatchObject({ resultado: 'ganada', precio_adjudicado: 1268, calce: 'exacto' });
  });

  it('ítem adjudicado a otro: lo reconoce por cantidad y queda aproximado', () => {
    expect(adjudicacionDeLinea(linea(7500, 50), cot(), ficha(items)).fila).toMatchObject({ resultado: 'perdida', precio_adjudicado: 6100, ganador: 'MAYORDENT', calce: 'aproximado' });
  });

  it('una cantidad que calza con un precio de otro orden no cuenta', () => {
    // 380 unidades a $924 no puede ser nuestra línea de $90.000.
    expect(adjudicacionDeLinea(linea(90000, 380), cot({ estado: 'En espera' }), ficha(items)).fila).toBeNull();
  });

  it('adjudicada entera a otros y sin reconocer la línea: perdida sin precio', () => {
    expect(adjudicacionDeLinea(linea(7500, 77), cot(), ficha(items.slice(0, 2), { ganamos: false })).fila).toMatchObject({ resultado: 'perdida', precio_adjudicado: null, calce: 'sin_dato' });
  });

  it('adjudicada por el total a un solo proveedor: estima con la proporción', () => {
    const total = [{ cantidad_ganador: 1, precio_ganador: 900000, ganador_nombre: 'VAMPRODEN SPA', ganado_por_nosotros: false }];
    const f = ficha(total, { ganamos: false });
    expect(adjudicacionDeLinea(linea(5000, 10), cot(), f).faltaContexto).toBe(true);
    const todas = [linea(5000, 10), linea(95000, 10)];
    expect(adjudicacionDeLinea(linea(5000, 10), cot(), f, todas).fila).toMatchObject({ precio_adjudicado: 4500, calce: 'estimado', ganador: 'VAMPRODEN SPA' });
  });
});

describe('adjudicacionDeLinea · sin ficha', () => {
  it('Adjudicada = a nuestro precio; Perdida = sin precio; En espera = nada', () => {
    expect(adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'Adjudicada', fecha_adjudicada: '2026-03-02' }), null).fila).toMatchObject({ resultado: 'ganada', precio_adjudicado: 3000, fecha: '2026-03-02', codigo_mp: null, organismo: 'Hospital de Talca' });
    expect(adjudicacionDeLinea(linea(3000, 18), cot(), null).fila).toMatchObject({ resultado: 'perdida', precio_adjudicado: null });
    expect(adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'En espera' }), null).fila).toBeNull();
  });

  it('las cotizaciones a particulares y las líneas sin precio quedan fuera', () => {
    expect(adjudicacionDeLinea(linea(3000, 18), cot({ estado: 'Adjudicada', tipo_cliente: 'Cliente Particular' }), null).fila).toBeNull();
    expect(adjudicacionDeLinea(linea(0, 18), cot({ estado: 'Adjudicada' }), null).fila).toBeNull();
    expect(esParticular({ id: 1, tipo_compra: 'Cliente particular' })).toBe(true);
    expect(desenlaceInterno({ id: 1, estado: 'Adjudicada parcial' })).toBe('ganada');
  });
});

describe('sinRepetidas', () => {
  it('deja una fila por proceso (la de la cotización más nueva) y ordena de la más reciente a la más antigua', () => {
    const f = (extra: any) => ({
      fecha: '2026-10-22', licitacion_id: 1, numero: null, codigo_mp: 'A-1-COT26', organismo: null, tipo: 'compra_agil' as const,
      cantidad: 18, nuestro_precio: 3000, precio_adjudicado: 1990, ganador: 'X', resultado: 'perdida' as const, calce: 'exacto' as const, atipico: false, ...extra,
    });
    const r = sinRepetidas([f({ licitacion_id: 10 }), f({ licitacion_id: 12 }), f({ codigo_mp: 'B-2-COT26', fecha: '2026-11-01', licitacion_id: 20 })]);
    expect(r.map((x) => x.licitacion_id)).toEqual([20, 12]);
  });
});
