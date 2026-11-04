import {
  avisoOcCargada,
  duenoDeCotizacion,
  fechaCorta,
} from './oc-cargada-aviso';

/* Aviso al dueño de la cotización cuando otra persona carga una orden de
   compra (2026-11-04). */

const lic = {
  id: 4321,
  id_licitacion: '1057-123-COT26',
  nombre: 'Insumos dentales',
  nombre_entidad: 'Hospital de Talca',
  vendedor_correo: 'Vendedor@amsodentmedical.cl',
  vendedor_nombre: 'Francisco',
  creado_por: 'otro@amsodentmedical.cl',
};
const oc = {
  documentoId: 99,
  numero: 'OC-2026-001',
  monto: 1250000,
  fechaOc: '2026-11-04',
};

describe('duenoDeCotizacion', () => {
  it('prefiere vendedor_correo y cae a creado_por, siempre en minúsculas', () => {
    expect(duenoDeCotizacion(lic)).toBe('vendedor@amsodentmedical.cl');
    expect(
      duenoDeCotizacion({
        vendedor_correo: '  ',
        creado_por: ' Ruth@amsodentmedical.cl ',
      }),
    ).toBe('ruth@amsodentmedical.cl');
  });
  it('sin un correo válido no hay dueño', () => {
    expect(
      duenoDeCotizacion({ vendedor_correo: 'Francisco', creado_por: null }),
    ).toBeNull();
    expect(duenoDeCotizacion({})).toBeNull();
  });
});

describe('avisoOcCargada', () => {
  it('no avisa cuando la carga el propio vendedor (sin importar mayúsculas o espacios)', () => {
    expect(
      avisoOcCargada(lic, oc, ' VENDEDOR@amsodentmedical.cl ', 'Francisco'),
    ).toBeNull();
  });

  it('no avisa sin dueño ni sin saber quién cargó', () => {
    expect(avisoOcCargada({ id: 1 }, oc, 'ruth@amsodentmedical.cl')).toBeNull();
    expect(avisoOcCargada(lic, oc, null)).toBeNull();
    expect(avisoOcCargada(lic, oc, '')).toBeNull();
  });

  it('arma el aviso al dueño con quién, N° de OC, monto neto, cliente y cotización', () => {
    const a = avisoOcCargada(lic, oc, 'Ruth@amsodentmedical.cl', 'Ruth');
    expect(a).not.toBeNull();
    expect(a!.destinatario).toBe('vendedor@amsodentmedical.cl');
    expect(a!.mensaje).toBe(
      'Ruth cargó la orden de compra N° OC-2026-001 ($1.250.000 neto) de Hospital de Talca en tu cotización 1057-123-COT26.',
    );
    expect(a!.link).toBe('/detalle/4321');
    expect(a!.metadata).toEqual({
      licitacion_id: 4321,
      id_licitacion: '1057-123-COT26',
      documento_id: 99,
      numero: 'OC-2026-001',
      monto: 1250000,
      fecha_oc: '2026-11-04',
      cliente: 'Hospital de Talca',
      cargado_por: 'ruth@amsodentmedical.cl',
      cargado_por_nombre: 'Ruth',
    });
  });

  it('sin nombre de perfil usa el correo; sin número, monto ni ID de licitación el mensaje sigue legible', () => {
    const a = avisoOcCargada(
      { id: 77, nombre_entidad: '', creado_por: 'vendedor@amsodentmedical.cl' },
      { documentoId: 5, numero: null, monto: '0', fechaOc: null },
      'ruth@amsodentmedical.cl',
    );
    expect(a!.mensaje).toBe(
      'ruth@amsodentmedical.cl cargó la orden de compra de el cliente en tu cotización 77.',
    );
    expect(a!.metadata.numero).toBeNull();
    expect(a!.metadata.monto).toBeNull();
    expect(a!.metadata.fecha_oc).toBeNull();
    expect(a!.metadata.id_licitacion).toBeNull();
  });

  it('acepta el monto como texto (así llega a veces desde el formulario)', () => {
    const a = avisoOcCargada(
      lic,
      { documentoId: 5, monto: '350000' },
      'ruth@amsodentmedical.cl',
      'Ruth',
    );
    expect(a!.mensaje).toContain('($350.000 neto)');
  });
});

describe('fechaCorta', () => {
  it('pasa la fecha ISO a día-mes-año y tolera vacíos', () => {
    expect(fechaCorta('2026-11-04')).toBe('04-11-2026');
    expect(fechaCorta('2026-11-04T15:00:00Z')).toBe('04-11-2026');
    expect(fechaCorta(null)).toBeNull();
    expect(fechaCorta('hoy')).toBeNull();
  });
});
