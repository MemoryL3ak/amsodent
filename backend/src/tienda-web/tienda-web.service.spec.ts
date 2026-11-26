import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';
import { TiendaWebService } from './tienda-web.service';

/* Tabla pedidos_tienda_web en memoria: lo justo del cliente de Supabase que
   usa el servicio (upsert ignoreDuplicates, select/eq/single, update con
   compara-y-cambia sobre updated_at). */
function supabaseFalso() {
  const filas = new Map<string, any>();
  let reloj = Date.now();
  const ahora = () => new Date((reloj += 1)).toISOString();
  const from = () => {
    const q: any = { filtros: [] as [string, any][], cambios: null as any };
    const coincide = (f: any) => q.filtros.every(([k, v]: [string, any]) => f[k] === v);
    const resolver = () => {
      if (q.cambios) {
        const hits = [...filas.values()].filter(coincide);
        for (const f of hits) Object.assign(f, q.cambios, { updated_at: ahora() });
        return { data: hits.map((f) => ({ ...f })), error: null };
      }
      return { data: [...filas.values()].filter(coincide).map((f) => ({ ...f })), error: null };
    };
    Object.assign(q, {
      upsert: (rows: any[]) => {
        for (const r of rows) if (!filas.has(r.pedido)) filas.set(r.pedido, { estado: 'recibido', intentos: 0, ...r, updated_at: ahora() });
        return Promise.resolve({ error: null });
      },
      select: () => q,
      update: (c: any) => ((q.cambios = c), q),
      eq: (k: string, v: any) => (q.filtros.push([k, v]), q),
      single: () => Promise.resolve({ data: resolver().data[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: resolver().data[0] ?? null, error: null }),
      then: (ok: any, ko: any) => Promise.resolve(resolver()).then(ok, ko),
    });
    return q;
  };
  const envejecer = (pedido: string, ms: number) => (filas.get(pedido).updated_at = new Date(Date.now() - ms).toISOString());
  return { filas, envejecer, servicio: { getClient: () => ({ from }) } as any };
}

const pedido = (extra: any = {}) => ({
  pedido: 'AMS-2026-0031', tipo: 'boleta', medio_pago: 'webpay', referencia_pago: 'AUTH1',
  cliente: { razon_social: 'Ana Pérez' }, despacho: null,
  lineas: [{ sku: 'PH00302', producto: 'Clorhexidina', cantidad: 1, neto_unitario: 8403 }],
  despacho_neto: 0, total_tienda: 10000, ...extra,
});

function armar(emitir: jest.Mock) {
  const db = supabaseFalso();
  const facturacion: any = { listas: async () => ({ formas: [{ id: 9, nombre: 'WebPay' }, { id: 4, nombre: 'Transferencia' }] }) };
  const svc = new TiendaWebService(db.servicio, facturacion, { emitir } as any);
  return { db, svc };
}

const emitida = { emitida: true, numero: '5501', bsale_id: 777, url_pdf: 'https://bsale/x.pdf', total: 10000, cotizacion: { id: 42 }, documento_id: 9, avisos: [], guia: null };

describe('TiendaWebService', () => {
  it('emite una vez y un reenvío del mismo pedido devuelve el mismo documento sin volver a Bsale', async () => {
    const emitir = jest.fn().mockResolvedValue(emitida);
    const { svc } = armar(emitir);
    const r1 = await svc.recibir(pedido());
    const r2 = await svc.recibir(pedido());
    expect(r1).toMatchObject({ estado: 'emitida', numero: '5501', cotizacion_id: 42 });
    expect(r2).toMatchObject({ estado: 'emitida', numero: '5501' });
    expect(emitir).toHaveBeenCalledTimes(1);
    const [, cuerpo, sistema] = emitir.mock.calls[0];
    expect(sistema).toMatchObject({ sistema: true, clave: 'AMS-WEB-AMS-2026-0031', salesId: 'AMS-WEB-AMS-2026-0031' });
    expect(cuerpo).toMatchObject({ venta_directa: true, forma_pago_id: 9, comprobante: 'AUTH1' });
  });

  it('dos envíos simultáneos: solo uno emite', async () => {
    let soltar!: () => void;
    const emitir = jest.fn().mockImplementation(() => new Promise((ok) => (soltar = () => ok(emitida))));
    const { svc } = armar(emitir);
    const primero = svc.recibir(pedido());
    // Se espera a que el primero esté DENTRO de la emisión (pedido tomado).
    for (let i = 0; i < 50 && !emitir.mock.calls.length; i++) await new Promise((r) => setImmediate(r));
    expect(emitir).toHaveBeenCalledTimes(1);
    await expect(svc.recibir(pedido())).rejects.toBeInstanceOf(ConflictException);
    soltar();
    await expect(primero).resolves.toMatchObject({ estado: 'emitida' });
    expect(emitir).toHaveBeenCalledTimes(1);
  });

  it('un intento que quedó «emitiendo» más de 10 min pasa a incierta y no se reemite', async () => {
    const emitir = jest.fn().mockImplementation(() => new Promise(() => undefined)); // nunca termina
    const { svc, db } = armar(emitir);
    void svc.recibir(pedido());
    for (let i = 0; i < 50 && !emitir.mock.calls.length; i++) await new Promise((r) => setImmediate(r));
    db.envejecer('AMS-2026-0031', 11 * 60 * 1000);
    await expect(svc.recibir(pedido())).rejects.toBeInstanceOf(ConflictException);
    expect(db.filas.get('AMS-2026-0031').estado).toBe('incierta');
    expect(emitir).toHaveBeenCalledTimes(1);
  });

  it('un rechazo de Bsale queda en error y se puede reintentar', async () => {
    const emitir = jest.fn().mockRejectedValueOnce(new BadRequestException('Bsale rechazó el documento: SKU inválido')).mockResolvedValueOnce(emitida);
    const { svc, db } = armar(emitir);
    await expect(svc.recibir(pedido())).rejects.toBeInstanceOf(BadRequestException);
    expect(db.filas.get('AMS-2026-0031')).toMatchObject({ estado: 'error', error: expect.stringContaining('SKU inválido') });
    await expect(svc.recibir(pedido())).resolves.toMatchObject({ estado: 'emitida', intentos: 2 });
  });

  it('si Bsale no respondió queda incierta y NO se reintenta solo', async () => {
    const emitir = jest.fn().mockRejectedValue(new BadGatewayException('Bsale no respondió'));
    const { svc } = armar(emitir);
    await expect(svc.recibir(pedido())).rejects.toBeInstanceOf(BadGatewayException);
    await expect(svc.recibir(pedido())).rejects.toBeInstanceOf(ConflictException);
    expect(emitir).toHaveBeenCalledTimes(1);
  });

  it('con la emisión apagada queda simulada y luego puede emitirse de verdad', async () => {
    const emitir = jest.fn().mockResolvedValueOnce({ simulacion: true, solicitud: { a: 1 }, totales: { total: 10000 }, avisos: [] }).mockResolvedValueOnce(emitida);
    const { svc } = armar(emitir);
    await expect(svc.recibir(pedido())).resolves.toMatchObject({ estado: 'simulada', total_documento: 10000 });
    await expect(svc.recibir(pedido())).resolves.toMatchObject({ estado: 'emitida' });
  });

  it('validación bloqueada (p. ej. SKU que no está en Bsale) queda en error con los problemas', async () => {
    const emitir = jest.fn().mockResolvedValue({ simulacion: true, bloqueada: true, problemas: [{ codigo: 'sku_no_en_bsale', mensaje: 'El SKU PH00302 no está en Bsale.' }], avisos: [] });
    const { svc, db } = armar(emitir);
    await expect(svc.recibir(pedido())).rejects.toBeInstanceOf(BadRequestException);
    expect(db.filas.get('AMS-2026-0031')).toMatchObject({ estado: 'error', error: 'El SKU PH00302 no está en Bsale.' });
  });

  it('avisa si el total del documento no calza con lo cobrado', async () => {
    const emitir = jest.fn().mockResolvedValue({ ...emitida, total: 10500 });
    const { svc } = armar(emitir);
    const r: any = await svc.recibir(pedido());
    expect(r.avisos.join(' ')).toMatch(/no calza/);
  });

  it('sin forma de pago en Bsale no emite y deja el error', async () => {
    const emitir = jest.fn();
    const db = supabaseFalso();
    const svc = new TiendaWebService(db.servicio, { listas: async () => ({ formas: [{ id: 1, nombre: 'Efectivo' }] }) } as any, { emitir } as any);
    await expect(svc.recibir(pedido({ medio_pago: 'transferencia' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(emitir).not.toHaveBeenCalled();
    expect(db.filas.get('AMS-2026-0031')).toMatchObject({ estado: 'error' });
  });
});
