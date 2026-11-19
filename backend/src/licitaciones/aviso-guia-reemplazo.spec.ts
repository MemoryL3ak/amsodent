import { decidirAvisoGuia, normNumeroGuia } from './aviso-guia-reemplazo';

describe('Aviso de guía de despacho: solo la primera vez', () => {
  const aviso = (id: number, documento_id: number, numero: any, leida = true, deriva_de_id: any = undefined) => ({
    id,
    leida_at: leida ? '2026-11-19T12:00:00Z' : null,
    metadata: { licitacion_id: 50, documento_id, numero, ...(deriva_de_id === undefined ? {} : { deriva_de_id }) },
  });

  it('compara folios aunque vengan escritos distinto', () => {
    expect(normNumeroGuia('N° 001234')).toBe('1234');
    expect(normNumeroGuia('GD-1234')).toBe('1234');
    expect(normNumeroGuia(' 1234 ')).toBe('1234');
    expect(normNumeroGuia('')).toBe('');
    expect(normNumeroGuia(null)).toBe('');
    expect(normNumeroGuia('s/n')).toBe('S/N');
  });

  it('la primera guía de la cotización avisa', () => {
    expect(decidirAvisoGuia([], { docId: 10, numero: '1234' }, [10])).toEqual({ reemplazo: false, pendiente: null });
  });

  it('otra guía con otro folio (despacho parcial) también avisa', () => {
    const r = decidirAvisoGuia([aviso(1, 10, '1234')], { docId: 11, numero: '1235' }, [10, 11]);
    expect(r.reemplazo).toBe(false);
  });

  it('la misma guía cargada de nuevo (eliminada y vuelta a subir) no avisa', () => {
    const r = decidirAvisoGuia([aviso(1, 10, '1234')], { docId: 11, numero: 'N° 1234' }, [11]);
    expect(r).toEqual({ reemplazo: true, pendiente: null });
  });

  it('el mismo folio subido encima de la guía emitida en Bsale no avisa', () => {
    const r = decidirAvisoGuia([aviso(1, 10, '1234')], { docId: 11, numero: '1234' }, [10, 11]);
    expect(r.reemplazo).toBe(true);
  });

  it('si el aviso original sigue sin atender, se le apunta al documento nuevo', () => {
    const r = decidirAvisoGuia([aviso(1, 9, '1234'), aviso(2, 10, '1234', false)], { docId: 11, numero: '1234' }, [11]);
    expect(r.reemplazo).toBe(true);
    expect(r.pendiente?.id).toBe(2);
  });

  it('el aviso del mismo documento no cuenta como anterior', () => {
    const r = decidirAvisoGuia([aviso(1, 11, '1234', false)], { docId: 11, numero: '1234' }, [11]);
    expect(r.reemplazo).toBe(false);
  });

  describe('guías sin número', () => {
    it('reemplaza si la anterior sin número ya no existe', () => {
      const r = decidirAvisoGuia([aviso(1, 10, '', true, 7)], { docId: 11, numero: null, derivaDeId: 7 }, [11]);
      expect(r.reemplazo).toBe(true);
    });

    it('no reemplaza si la anterior sin número sigue cargada (son dos guías)', () => {
      const r = decidirAvisoGuia([aviso(1, 10, '', true, 7)], { docId: 11, numero: '', derivaDeId: 7 }, [10, 11]);
      expect(r.reemplazo).toBe(false);
    });

    it('no reemplaza si la anterior era de otra orden de compra', () => {
      const r = decidirAvisoGuia([aviso(1, 10, '', true, 7)], { docId: 11, numero: '', derivaDeId: 8 }, [11]);
      expect(r.reemplazo).toBe(false);
    });

    it('no mezcla una guía sin número con una que sí lo tenía', () => {
      const r = decidirAvisoGuia([aviso(1, 10, '1234')], { docId: 11, numero: '' }, [11]);
      expect(r.reemplazo).toBe(false);
    });

    it('un aviso antiguo (sin la orden anotada) de una guía eliminada cuenta', () => {
      const r = decidirAvisoGuia([aviso(1, 10, '')], { docId: 11, numero: '', derivaDeId: 7 }, [11]);
      expect(r.reemplazo).toBe(true);
    });
  });
});
