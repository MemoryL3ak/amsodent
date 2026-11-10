import { LotesService, LoteDisponible, fechaValida, normLote, notaConLotes, textoLotes } from './lotes.service';

/* Lógica de los lotes en la guía (2026-11-09): el texto que sale en la línea
   y la validación de lo elegido. La lectura de la BD se reemplaza. */

const lote = (id: number, codigo: string, vencimiento: string, disponible: number, sku = 'ABC1'): LoteDisponible => ({
  id, producto_id: 7, sku, lote: codigo, vencimiento, recibido: disponible, despachado: 0, disponible,
});

function servicio(lotes: LoteDisponible[]) {
  const s = new LotesService({ getClient: () => ({}) } as any);
  jest.spyOn(s, 'listo').mockResolvedValue(true);
  jest.spyOn(s, 'porSku').mockImplementation(async (skus: string[]) => {
    const m = new Map<string, LoteDisponible[]>();
    for (const l of lotes) if (skus.map((x) => x.toUpperCase()).includes(l.sku)) m.set(l.sku, [...(m.get(l.sku) || []), l]);
    return m;
  });
  return s;
}

describe('textoLotes / notaConLotes', () => {
  it('un lote que cubre la línea va sin cantidades', () => {
    expect(textoLotes([{ lote_id: 1, producto_id: 7, sku: 'ABC1', lote: 'L1', vencimiento: '2027-12-31', cantidad: 10 }], 10)).toBe('Lote L1 · Venc. 31-12-2027');
  });
  it('varios lotes llevan las unidades de cada uno', () => {
    const t = textoLotes([
      { lote_id: 1, producto_id: 7, sku: 'ABC1', lote: 'L1', vencimiento: '2027-12-31', cantidad: 6 },
      { lote_id: 2, producto_id: 7, sku: 'ABC1', lote: 'L2', vencimiento: '2028-06-15', cantidad: 4 },
    ], 10);
    expect(t).toBe('Lote L1 · Venc. 31-12-2027 (6 u.) / Lote L2 · Venc. 15-06-2028 (4 u.)');
  });
  it('la nota pone el lote antes de la observación', () => {
    expect(notaConLotes('Lote L1 · Venc. 31-12-2027', ' entregar  en bodega ')).toBe('Lote L1 · Venc. 31-12-2027 · entregar en bodega');
    expect(notaConLotes('', 'solo obs')).toBe('solo obs');
    expect(notaConLotes(null, '')).toBe('');
  });
  it('normaliza lote y fecha', () => {
    expect(normLote('  l-23   a ')).toBe('L-23 A');
    expect(fechaValida('2027-02-30')).toBeNull();
    expect(fechaValida('2027-02-28')).toBe('2027-02-28');
  });
});

describe('LotesService.asignar', () => {
  const lotes = [lote(1, 'L1', '2099-01-31', 5), lote(2, 'L2', '2099-06-30', 20), lote(9, 'OTRO', '2099-01-01', 3, 'XYZ9')];

  it('un lote sin cantidad toma toda la línea', async () => {
    const r = await servicio(lotes).asignar([{ sku: 'abc1', cantidad: 4 }], { ABC1: [{ lote_id: 1 }] });
    expect(r.problemas).toEqual([]);
    expect(r.porSku.get('ABC1')?.asignaciones.map((a) => [a.lote_id, a.cantidad])).toEqual([[1, 4]]);
    expect(r.porSku.get('ABC1')?.texto).toBe('Lote L1 · Venc. 31-01-2099');
  });

  it('avisa si van más unidades que las disponibles, sin frenar', async () => {
    const r = await servicio(lotes).asignar([{ sku: 'ABC1', cantidad: 8 }], { ABC1: [{ lote_id: 1 }] });
    expect(r.problemas).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/quedan 5 disponibles/);
  });

  it('varios lotes que suman más que la línea es un problema', async () => {
    const r = await servicio(lotes).asignar([{ sku: 'ABC1', cantidad: 10 }], { ABC1: [{ lote_id: 1, cantidad: 5 }, { lote_id: 2, cantidad: 6 }] });
    expect(r.problemas.join(' ')).toMatch(/suman 11/);
    expect(r.porSku.size).toBe(0);
  });

  it('si suman menos, el resto va sin lote (aviso)', async () => {
    const r = await servicio(lotes).asignar([{ sku: 'ABC1', cantidad: 10 }], { ABC1: [{ lote_id: 2, cantidad: 4 }, { lote_id: 1, cantidad: 3 }] });
    expect(r.problemas).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/3 de 10 unidades van sin lote/);
    // Ordenados por vencimiento.
    expect(r.porSku.get('ABC1')?.asignaciones.map((a) => a.lote_id)).toEqual([1, 2]);
  });

  it('rechaza un lote de otro producto', async () => {
    const r = await servicio(lotes).asignar([{ sku: 'ABC1', cantidad: 2 }], { ABC1: [{ lote_id: 9 }] });
    expect(r.problemas.join(' ')).toMatch(/no es de este producto/);
  });

  it('avisa el producto con lotes que va sin lote y el lote vencido', async () => {
    const s = servicio([lote(1, 'L1', '2020-01-31', 5), lote(9, 'OTRO', '2099-01-01', 3, 'XYZ9')]);
    const r = await s.asignar([{ sku: 'ABC1', cantidad: 1 }, { sku: 'XYZ9', cantidad: 1 }], { ABC1: [{ lote_id: 1 }] });
    expect(r.avisos.join(' ')).toMatch(/VENCIDO/);
    expect(r.avisos.join(' ')).toMatch(/sin lote en la guía: XYZ9/);
  });
});
