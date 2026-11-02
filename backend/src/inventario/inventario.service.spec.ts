import { planSincronizacion, ContextoSync, Sucursal } from './inventario.service';

/* Plan de la sincronización con Bsale por sucursal (2026-11-02): cada sucursal
   mapeada a una sucursal de Bsale queda con el stock de Bsale + lo que Bsale
   no sabe (compensación); las no mapeadas no se tocan. */

const suc = (id: number, nombre: string, office: number | null, es_principal = false): Sucursal => ({
  id, nombre, direccion: null, comuna: null, activa: true, es_principal, bsale_office_id: office, orden: 0,
});
const CM = suc(1, 'Casa Matriz', 1, true);
const BSC = suc(2, 'Bodega Santiago Centro', 2);
const LOCAL = suc(3, 'Local Providencia', null);

function ctxDe(stock: Record<number, Record<number, number>>, comp: Record<number, Record<number, number>> = {}): ContextoSync {
  const aMapa = (o: Record<number, Record<number, number>>) =>
    new Map(Object.entries(o).map(([pid, porSuc]) => [Number(pid), new Map(Object.entries(porSuc).map(([sid, n]) => [Number(sid), n]))]));
  return {
    sucursales: [CM, BSC, LOCAL],
    mapeadas: [{ sucursal: CM, office: 1 }, { sucursal: BSC, office: 2 }],
    principal: CM,
    stock: aMapa(stock),
    compensacion: aMapa(comp),
    enTransito: new Map(),
  };
}

describe('planSincronizacion', () => {
  it('no aplica sin contexto, sin sucursales mapeadas o sin stock por oficina', () => {
    expect(planSincronizacion(null, 7, { 1: 10 })).toBeNull();
    expect(planSincronizacion({ ...ctxDe({}), mapeadas: [] }, 7, { 1: 10 })).toBeNull();
    expect(planSincronizacion(ctxDe({}), 7, null)).toBeNull();
  });

  it('deja cada sucursal mapeada exactamente con el stock de su sucursal de Bsale', () => {
    const plan = planSincronizacion(ctxDe({ 7: { 1: 7, 2: 2, 3: 5 } }), 7, { 1: 10, 2: 2 });
    expect(plan).toEqual([{ sucursalId: 1, nombre: 'Casa Matriz', delta: 3, resultante: 10 }]);
  });

  it('no toca la bodega solo del sistema aunque Bsale no la conozca', () => {
    // Local Providencia (sin office) tiene 5: no aparece en el plan.
    const plan = planSincronizacion(ctxDe({ 7: { 1: 10, 2: 2, 3: 5 } }), 7, { 1: 10, 2: 2 });
    expect(plan).toEqual([]);
  });

  it('descuenta lo trasladado sin guía a una bodega no mapeada (Bsale lo sigue contando en el origen)', () => {
    // Se mandaron 3 de Casa Matriz al Local sin guía: Bsale dice 10 en la 1, acá quedan 7 → sin cambio.
    const plan = planSincronizacion(ctxDe({ 7: { 1: 7, 3: 3 } }, { 7: { 1: -3 } }), 7, { 1: 10 });
    expect(plan).toEqual([]);
    // Si además Bsale vendió 2 (dice 8), Casa Matriz baja a 5.
    const plan2 = planSincronizacion(ctxDe({ 7: { 1: 7, 3: 3 } }, { 7: { 1: -3 } }), 7, { 1: 8 });
    expect(plan2).toEqual([{ sucursalId: 1, nombre: 'Casa Matriz', delta: -2, resultante: 5 }]);
  });

  it('suma lo recibido acá de un traslado con guía que Bsale aún no recepciona', () => {
    // 4 recibidas en BSC (bsale_recibido_at nulo): Bsale dice 0 en la 2 → objetivo 4 → sin cambio.
    const plan = planSincronizacion(ctxDe({ 7: { 1: 6, 2: 4 } }, { 7: { 2: 4 } }), 7, { 1: 6, 2: 0 });
    expect(plan).toEqual([]);
  });

  it('un SKU sin filas de stock en Bsale queda en 0 en las sucursales mapeadas', () => {
    const plan = planSincronizacion(ctxDe({ 7: { 1: 4, 2: 1 } }), 7, {});
    expect(plan).toEqual([
      { sucursalId: 1, nombre: 'Casa Matriz', delta: -4, resultante: 0 },
      { sucursalId: 2, nombre: 'Bodega Santiago Centro', delta: -1, resultante: 0 },
    ]);
  });

  it('pisa a 0 un stock negativo de Bsale (sobreventa)', () => {
    const plan = planSincronizacion(ctxDe({ 7: { 1: 2 } }), 7, { 1: -5 });
    expect(plan).toEqual([{ sucursalId: 1, nombre: 'Casa Matriz', delta: -2, resultante: 0 }]);
  });
});
