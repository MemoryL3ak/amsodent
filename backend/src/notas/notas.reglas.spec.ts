import { limpiarNota, ordenValido, rutaInterna, MAX_CONTENIDO_NOTA } from './notas.reglas';

describe('notas adhesivas: reglas', () => {
  it('una nota nueva sin datos queda con los predeterminados', () => {
    expect(limpiarNota({}, false)).toEqual({
      contenido: '',
      color: 'amarillo',
      papel: 'liso',
      letra: 'normal',
      sujecion: 'cinta',
      destacada: false,
      ruta: null,
      ruta_titulo: null,
      flotante: false,
      pos_x: null,
      pos_y: null,
    });
  });

  it('al crear, un estilo desconocido cae en el predeterminado', () => {
    const n = limpiarNota({ color: 'fucsia-neon', papel: 'CUADROS', letra: ' Manuscrita ', sujecion: 'grapa' }, false);
    expect(n.color).toBe('amarillo');
    expect(n.papel).toBe('cuadros');
    expect(n.letra).toBe('manuscrita');
    expect(n.sujecion).toBe('cinta');
  });

  it('al editar solo toca lo que viene y descarta lo inválido o desconocido', () => {
    expect(limpiarNota({ color: 'rosa' }, true)).toEqual({ color: 'rosa' });
    expect(limpiarNota({ color: 'inventado', user_id: 'otro', id: 9, orden: -5 }, true)).toEqual({});
    expect(limpiarNota({ destacada: 'si' }, true)).toEqual({ destacada: false });
    expect(limpiarNota({ destacada: true }, true)).toEqual({ destacada: true });
  });

  it('recorta el contenido al tope y unifica los saltos de línea', () => {
    const n = limpiarNota({ contenido: 'a\r\nb\rc' + 'x'.repeat(MAX_CONTENIDO_NOTA) }, true);
    expect(n.contenido?.startsWith('a\nb\nc')).toBe(true);
    expect(n.contenido?.length).toBe(MAX_CONTENIDO_NOTA);
  });

  it('la posición es una fracción de 0 a 1', () => {
    expect(limpiarNota({ pos_x: 1.7, pos_y: -3 }, true)).toEqual({ pos_x: 1, pos_y: 0 });
    expect(limpiarNota({ pos_x: 'abc', pos_y: null }, true)).toEqual({ pos_x: null, pos_y: null });
    expect(limpiarNota({ pos_x: 0.25 }, true)).toEqual({ pos_x: 0.25 });
  });

  it('solo acepta rutas internas de la plataforma', () => {
    expect(rutaInterna('/trazabilidad?estado=parcial')).toBe('/trazabilidad?estado=parcial');
    expect(rutaInterna('https://otro.sitio/x')).toBeNull();
    expect(rutaInterna('//otro.sitio/x')).toBeNull();
    expect(rutaInterna('javascript:alert(1)')).toBeNull();
    expect(rutaInterna('/con espacio')).toBeNull();
    expect(rutaInterna('')).toBeNull();
  });

  it('quitar la ruta quita también su título', () => {
    expect(limpiarNota({ ruta: null, ruta_titulo: 'Trazabilidad' }, true)).toEqual({ ruta: null, ruta_titulo: null });
    expect(limpiarNota({ ruta: '/clientes', ruta_titulo: '  Clientes ' }, true)).toEqual({ ruta: '/clientes', ruta_titulo: 'Clientes' });
  });

  it('el orden ignora ids ajenos, repetidos o inválidos', () => {
    expect(ordenValido([3, '1', 3, 99, 'x', -2, 2.5, 2], [1, 2, 3])).toEqual([3, 1, 2]);
    expect(ordenValido(null, [1, 2])).toEqual([]);
  });
});
