import { CATEGORIAS_COMUNIDAD, esCategoria, esFaltaMigracion, leerRef, unirComunidad } from './comunidad-categorias';

describe('Comunidad: unión de fuentes y categorías', () => {
  const registros = [
    { id: 1, nombre: 'Ana', apellido: 'Pérez', correo: 'ana@x.cl', telefono: '+56911112222', perfil: 'estudiante', anio_estudio: '3° año', universidad: 'UV', correo_enviado: true, created_at: '2026-08-28T10:00:00Z' },
    { id: 2, nombre: 'Luis', apellido: 'Soto', correo: 'luis@x.cl', telefono: '1', perfil: 'dentista', especialidad: 'Endodoncia', categoria: 'doctor_docente_publico', created_at: '2026-08-29T10:00:00Z' },
    { id: 3, nombre: 'Clínica Sonrisa', correo: 'contacto@sonrisa.cl', fuente: 'rastreo', perfil: 'clinica', categoria: 'cliente_rastreado', place_id: 'abc', comuna: 'Ñuñoa', created_at: '2026-11-17T10:00:00Z' },
  ];
  const participantes = [
    { id: 10, sorteo_id: 2, nombre: 'Ana Pérez', email: 'ANA@x.cl', es_estudiante: true, anio: '3°', created_at: '2026-10-29T10:00:00Z' },
    { id: 11, sorteo_id: 2, nombre: 'Marta Díaz', email: 'marta@x.cl', es_estudiante: false, created_at: '2026-10-29T11:00:00Z' },
    { id: 12, sorteo_id: 1, nombre: 'Pedro Antiguo', email: 'pedro@x.cl', tipo_perfil: 'egresado', especialidad: 'Ortodoncia', created_at: '2026-04-23T11:00:00Z' },
    { id: 13, sorteo_id: 1, nombre: 'Marta Díaz', email: 'marta@x.cl', tipo_perfil: 'estudiante', universidad_clinica: 'UVM', created_at: '2026-04-23T12:00:00Z' },
  ];
  const inscripciones = [
    { id: 20, evento: 'santiago', nombre: 'Carla', apellido: 'Rojas', telefono: '+56922223333', correo: 'carla@x.cl', especialidad: 'Rehabilitación', es_profesor: true, universidad: 'U. de Chile', created_at: '2026-08-06T10:00:00Z' },
    { id: 21, evento: 'vina', nombre: 'Marta', apellido: 'Díaz', telefono: '+56933334444', correo: 'marta@x.cl', especialidad: 'General', es_profesor: false, created_at: '2026-08-07T10:00:00Z' },
    { id: 22, evento: 'santiago', nombre: 'Clínica', apellido: 'Sonrisa', telefono: '2', correo: 'contacto@sonrisa.cl', especialidad: 'General', es_profesor: false, created_at: '2026-08-07T11:00:00Z' },
  ];
  const sorteos = [{ id: 1, titulo: 'Sorteo Amsodent 2026' }, { id: 2, titulo: 'Sorteo Amsodent · UVM' }];
  const filas = unirComunidad(registros, participantes, inscripciones, sorteos);
  const de = (correo: string) => filas.filter((f) => f.correo === correo);

  it('muestra a todas las personas de sorteos y eventos, una fila por correo', () => {
    expect(filas).toHaveLength(7); // ana, luis, clínica rastreada, marta, pedro, carla y la persona del evento que comparte correo con la clínica
    expect(de('ana@x.cl')).toHaveLength(1);
    expect(de('marta@x.cl')).toHaveLength(1);
  });

  it('junta las fuentes de quien aparece en varias y completa sus datos', () => {
    const ana = de('ana@x.cl')[0];
    expect(ana.id).toBe(1);
    expect(ana.fuentes.map((f) => f.etiqueta)).toEqual(['Formulario del QR', 'Sorteo Amsodent · UVM']);
    const marta = de('marta@x.cl')[0];
    expect(marta.id).toBeNull();
    expect(marta.fuentes.map((f) => f.tipo).sort()).toEqual(['evento', 'sorteo', 'sorteo']);
    expect(marta.telefono).toBe('+56933334444'); // lo aporta el evento
    expect(marta.created_at).toBe('2026-04-23T12:00:00Z'); // su primera aparición
  });

  it('toda fila tiene categoría: la guardada o la propuesta según el origen', () => {
    for (const f of filas) expect(esCategoria(f.categoria)).toBe(true);
    expect(de('ana@x.cl')[0]).toMatchObject({ categoria: 'estudiante', categoria_auto: true });
    expect(de('luis@x.cl')[0]).toMatchObject({ categoria: 'doctor_docente_publico', categoria_auto: false });
    expect(de('carla@x.cl')[0]).toMatchObject({ categoria: 'doctor_docente', categoria_auto: true });
    expect(de('pedro@x.cl')[0]).toMatchObject({ categoria: 'doctor_particular', categoria_auto: true });
    // Estudiante en un sorteo pesa más que el «particular» por defecto de otra fuente.
    expect(de('marta@x.cl')[0].categoria).toBe('estudiante');
  });

  it('las clínicas rastreadas no se mezclan con personas aunque compartan correo', () => {
    const mismas = de('contacto@sonrisa.cl');
    expect(mismas).toHaveLength(2);
    expect(mismas.find((f) => f.fuente === 'rastreo')).toMatchObject({ categoria: 'cliente_rastreado', categoria_auto: false, place_id: 'abc' });
    expect(mismas.find((f) => f.fuente === 'evento')?.fuentes.map((x) => x.ref)).toEqual(['evento:22']);
  });

  it('una persona de sorteo con categoría guardada usa su fila de Comunidad', () => {
    const guardada = unirComunidad([{ id: 9, nombre: 'Pedro Antiguo', correo: 'pedro@x.cl', fuente: 'sorteo', categoria: 'clinica', created_at: '2026-11-17T10:00:00Z' }], participantes, [], sorteos);
    const pedro = guardada.find((f) => f.correo === 'pedro@x.cl')!;
    expect(pedro).toMatchObject({ id: 9, ref: 'comunidad:9', categoria: 'clinica', categoria_auto: false, correo_enviado: null });
    expect(pedro.fuentes.map((f) => f.etiqueta)).toEqual(['Sorteo Amsodent 2026']);
  });

  it('lee las referencias de fila y reconoce la migración que falta', () => {
    expect(leerRef('sorteo:55')).toEqual({ tipo: 'sorteo', id: 55 });
    expect(leerRef('comunidad:1')).toEqual({ tipo: 'comunidad', id: 1 });
    expect(leerRef('rastreo:1')).toBeNull();
    expect(leerRef('sorteo:abc')).toBeNull();
    expect(esFaltaMigracion({ code: 'PGRST204', message: "Could not find the 'categoria' column of 'comunidad_registros' in the schema cache" })).toBe(true);
    expect(esFaltaMigracion({ code: '23502', message: 'null value in column "apellido" violates not-null constraint' })).toBe(true);
    expect(esFaltaMigracion({ code: '23505', message: 'duplicate key value violates unique constraint "comunidad_registros_place_id_unique"' })).toBe(false);
  });

  it('las siete categorías pedidas, en su orden', () => {
    expect(CATEGORIAS_COMUNIDAD.map((c) => c.nombre)).toEqual([
      'Estudiante', 'Clínica', 'Doctor Particular', 'Doctor Docente', 'Doctor Docente y Profesional Privado', 'Doctor Docente y Profesional Público', 'Cliente Rastreado',
    ]);
  });
});
