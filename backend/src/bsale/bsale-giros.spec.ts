import { opcionesDeGiro } from './bsale-giros';

describe('giros que se ofrecen al emitir una guía', () => {
  const ficha = ['Clínica dental', 'Salud', 'Venta de insumos'];

  it('con menos de dos giros en la ficha no se ofrece elegir', () => {
    expect(opcionesDeGiro([], 'Lo que sea')).toEqual({ giros: [], elegidos: [] });
    expect(opcionesDeGiro(['Clínica dental'], 'Otro')).toEqual({ giros: [], elegidos: [] });
  });

  it('si Bsale ya tiene un giro de la ficha, viene marcado ese', () => {
    expect(opcionesDeGiro(ficha, 'SALUD')).toEqual({ giros: ficha, elegidos: ['Salud'] });
    // Varios unidos con « / », como los deja la factura.
    expect(opcionesDeGiro(ficha, 'Clínica dental / Venta de insumos')).toEqual({ giros: ficha, elegidos: ['Clínica dental', 'Venta de insumos'] });
  });

  it('si Bsale tiene un giro que no es de la ficha, se ofrece también y es el marcado (nada cambia sin elegirlo)', () => {
    const r = opcionesDeGiro(['W', 'Iluste Municipalida'], 'ACTIVIDADES DE LA ADMINISTRACION PUBLICA EN GENERAL');
    expect(r.giros).toEqual(['ACTIVIDADES DE LA ADMINISTRACION PUBLICA EN GENERAL', 'W', 'Iluste Municipalida']);
    expect(r.elegidos).toEqual(['ACTIVIDADES DE LA ADMINISTRACION PUBLICA EN GENERAL']);
  });

  it('un giro de la ficha junto a otro que no está: se conserva el texto de Bsale tal cual', () => {
    const r = opcionesDeGiro(ficha, 'Salud / Otra cosa');
    expect(r.elegidos).toEqual(['Salud / Otra cosa']);
    expect(r.giros).toEqual(['Salud / Otra cosa', ...ficha]);
  });

  it('cliente sin giro en Bsale o cliente nuevo: se parte del principal de la ficha (o de la propuesta)', () => {
    expect(opcionesDeGiro(ficha, '')).toEqual({ giros: ficha, elegidos: ['Clínica dental'] });
    expect(opcionesDeGiro(ficha, 'Clínica dental / Salud', true)).toEqual({ giros: ficha, elegidos: ['Clínica dental', 'Salud'] });
  });
});
