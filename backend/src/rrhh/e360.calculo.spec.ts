import {
  calcularResultado,
  cumplimientoObjetivo,
  nivelDe,
  normalizarConfig,
  puntajeFormulario,
  resumenObjetivos,
  sanearRespuestas,
  sugerirAsignaciones,
  validarFormulario,
} from './e360.calculo';

/* Evaluación 360° (2026-11-19): instrumento, matriz, objetivos y resultado. */

const config = normalizarConfig({
  competencias: [
    { id: 'c1', nombre: 'Trabajo en equipo', peso: 2 },
    { id: 'c2', nombre: 'Comunicación', peso: 1 },
    { id: 'c3', nombre: 'Liderazgo', peso: 1, relaciones: ['jefatura', 'reporte', 'auto'] },
  ],
  preguntas: [{ id: 'p1', texto: '¿Qué debería seguir haciendo?', obligatoria: true }],
  pesos_relacion: { auto: 0, jefatura: 50, par: 25, reporte: 25, otro: 0 },
  peso_competencias: 60,
  peso_objetivos: 40,
  min_anonimato: 2,
});

const resp = (c1: number | null, c2: number | null, c3?: number | null, comentario = '') => ({
  c1: { puntaje: c1, comentario },
  c2: { puntaje: c2 },
  ...(c3 === undefined ? {} : { c3: { puntaje: c3 } }),
});
const enviada = (evaluador_id: number, relacion: string, respuestas: any, abiertas: any = {}) => ({
  evaluador_id,
  relacion,
  estado: 'enviada',
  respuestas,
  abiertas,
});

describe('normalizarConfig', () => {
  it('parte con el instrumento por defecto', () => {
    const c = normalizarConfig(null);
    expect(c.escala.max).toBe(5);
    expect(c.escala.etiquetas).toHaveLength(5);
    expect(c.anonimo).toBe(true);
    expect(c.min_anonimato).toBe(3);
    expect(c.peso_competencias + c.peso_objetivos).toBe(100);
    expect(c.niveles[0].desde).toBe(0);
  });

  it('da id a lo que no lo trae, sin repetir, y descarta lo vacío', () => {
    const c = normalizarConfig({
      competencias: [{ id: 'c1', nombre: 'A' }, { nombre: 'B' }, { id: 'c1', nombre: 'C' }, { nombre: '  ' }],
    });
    expect(c.competencias.map((x) => x.nombre)).toEqual(['A', 'B', 'C']);
    expect(new Set(c.competencias.map((x) => x.id)).size).toBe(3);
    expect(c.competencias[0].id).toBe('c1');
  });

  it('acota la escala y completa las etiquetas que falten', () => {
    expect(normalizarConfig({ escala: { max: 99 } }).escala.max).toBe(10);
    const c = normalizarConfig({ escala: { max: 4, etiquetas: ['Malo'] } });
    expect(c.escala.etiquetas).toEqual(['Malo', 'En desarrollo', 'Cumple lo esperado', 'Destacado']);
  });

  it('nunca deja las dos ponderaciones en cero', () => {
    const c = normalizarConfig({ peso_competencias: 0, peso_objetivos: 0 });
    expect(c.peso_competencias).toBe(100);
  });
});

describe('formulario', () => {
  it('promedia por peso de competencia e ignora lo que no aplica', () => {
    expect(puntajeFormulario(config, 'jefatura', resp(5, 2, 3))).toBe(3.75); // (5·2 + 2 + 3) / 4
    expect(puntajeFormulario(config, 'jefatura', resp(5, null, 3))).toBe(4.33);
    expect(puntajeFormulario(config, 'par', {})).toBeNull();
  });

  it('un par no responde las competencias que no le tocan', () => {
    expect(puntajeFormulario(config, 'par', resp(4, 4, 1))).toBe(4);
    const limpio = sanearRespuestas(config, 'par', resp(4, 4, 1), { p1: ' ok ', otra: 'x' });
    expect(Object.keys(limpio.respuestas)).toEqual(['c1', 'c2']);
    expect(limpio.abiertas).toEqual({ p1: 'ok' });
  });

  it('descarta puntajes fuera de la escala', () => {
    const limpio = sanearRespuestas(config, 'par', { c1: { puntaje: 9 }, c2: { puntaje: 3 } }, {});
    expect(limpio.respuestas).toEqual({ c2: { puntaje: 3, na: false, comentario: '' } });
  });

  it('exige todo antes de enviar; «no aplica» cuenta como respondido', () => {
    expect(validarFormulario(config, 'par', {}, {})).toHaveLength(3);
    const ok = validarFormulario(config, 'par', { c1: { puntaje: 4 }, c2: { na: true } }, { p1: 'Seguir así' });
    expect(ok).toEqual([]);
  });

  it('pide comentario en las notas bajas cuando el ciclo lo exige', () => {
    const estricto = normalizarConfig({ ...config, comentario_obligatorio_hasta: 2 });
    const faltan = validarFormulario(estricto, 'par', { c1: { puntaje: 2 }, c2: { puntaje: 4 } }, { p1: 'x' });
    expect(faltan).toHaveLength(1);
    expect(faltan[0]).toContain('Trabajo en equipo');
  });
});

describe('objetivos', () => {
  it('mide contra la meta y topa el sobrecumplimiento', () => {
    expect(cumplimientoObjetivo({ meta: 200, valor_real: 150 })).toBe(75);
    expect(cumplimientoObjetivo({ meta: 100, valor_real: 500 })).toBe(120);
    expect(cumplimientoObjetivo({ meta: 100, valor_real: null })).toBeNull();
    expect(cumplimientoObjetivo({ meta: 0, valor_real: 5 })).toBeNull();
  });

  it('«menos es mejor» invierte la razón', () => {
    expect(cumplimientoObjetivo({ sentido: 'menor', meta: 10, valor_real: 20 })).toBe(50);
    expect(cumplimientoObjetivo({ sentido: 'menor', meta: 10, valor_real: 8 })).toBe(120);
    expect(cumplimientoObjetivo({ sentido: 'menor', meta: 5, valor_real: 0 })).toBe(120);
  });

  it('sí/no vale todo o nada', () => {
    expect(cumplimientoObjetivo({ unidad: 'si_no', valor_real: 1 })).toBe(100);
    expect(cumplimientoObjetivo({ unidad: 'si_no', valor_real: 0 })).toBe(0);
  });

  it('pondera solo los objetivos ya medidos', () => {
    const r = resumenObjetivos([
      { meta: 100, valor_real: 100, peso: 3 },
      { meta: 100, valor_real: 50, peso: 1 },
      { meta: 100, valor_real: null, peso: 10 },
    ]);
    expect(r.medidos).toBe(2);
    expect(r.cumplimiento).toBe(87.5);
  });
});

describe('sugerirAsignaciones', () => {
  const equipo = [
    { id: 1, email: 'jefa@a.cl', jefatura_email: null, area: 'Gerencia', estado: 'activo' },
    { id: 2, email: 'ana@a.cl', jefatura_email: 'JEFA@a.cl', area: 'Ventas', estado: 'activo' },
    { id: 3, email: 'beto@a.cl', jefatura_email: 'jefa@a.cl', area: 'Ventas', estado: 'activo' },
    { id: 4, email: 'caro@a.cl', jefatura_email: 'jefa@a.cl', area: 'Ventas', estado: 'activo' },
    { id: 5, email: null, jefatura_email: 'jefa@a.cl', area: 'Bodega', estado: 'activo' },
    { id: 6, email: 'ex@a.cl', jefatura_email: 'jefa@a.cl', area: 'Ventas', estado: 'finiquitado' },
  ];
  const de = (lista: any[], evaluado: number, relacion: string) =>
    lista.filter((a) => a.evaluado_id === evaluado && a.relacion === relacion).map((a) => a.evaluador_id);

  it('arma auto, jefatura, pares y equipo desde las fichas', () => {
    const m = sugerirAsignaciones(equipo, [1, 2]);
    expect(de(m, 2, 'auto')).toEqual([2]);
    expect(de(m, 2, 'jefatura')).toEqual([1]);
    expect(de(m, 2, 'par')).toEqual([3, 4]); // sin correo o finiquitado no evalúa
    expect(de(m, 1, 'reporte')).toEqual([2, 3, 4]);
    expect(de(m, 1, 'jefatura')).toEqual([]);
  });

  it('reparte los pares para no cargar siempre a los mismos', () => {
    const m = sugerirAsignaciones(equipo, [2, 3, 4], { max_pares: 1 });
    const carga = [2, 3, 4].map((id) => m.filter((a) => a.relacion === 'par' && a.evaluador_id === id).length);
    expect(carga).toEqual([1, 1, 1]);
  });

  it('respeta lo que se desactiva y no evalúa quien no tiene correo', () => {
    const m = sugerirAsignaciones(equipo, [5], { pares: false });
    expect(m).toEqual([{ evaluado_id: 5, evaluador_id: 1, relacion: 'jefatura' }]);
  });
});

describe('calcularResultado', () => {
  const asignaciones = [
    enviada(10, 'auto', resp(5, 5, 5), { p1: 'Mi orden' }),
    enviada(1, 'jefatura', resp(4, 3, 2, 'Colabora bien con bodega'), { p1: 'La puntualidad' }),
    enviada(2, 'par', resp(5, 4), { p1: 'Su disposición' }),
    enviada(3, 'par', resp(3, 2)),
    enviada(4, 'reporte', resp(2, 4, 4, 'A veces no avisa los cambios')),
    { evaluador_id: 5, relacion: 'reporte', estado: 'pendiente', respuestas: resp(1, 1, 1) },
  ];
  const objetivos = [{ titulo: 'Ventas', meta: 100, valor_real: 90, peso: 1 }];
  const r = calcularResultado(config, asignaciones, objetivos);
  const comp = (id: string) => r.competencias.find((c) => c.id === id)!;

  it('pondera cada relación por su peso y deja fuera lo no enviado', () => {
    // c1: jefatura 4 (50) · pares 4 (25) · equipo 2 (25) → 3,5 ; la auto pesa 0
    expect(comp('c1').promedio).toBe(3.5);
    expect(comp('c1').otros).toBe(3.5);
    expect(comp('c1').auto).toBe(5);
    expect(comp('c1').brecha).toBe(1.5);
    expect(r.respuestas.enviadas).toBe(5);
    expect(r.respuestas.total).toBe(6);
  });

  it('renormaliza los pesos cuando una relación no evalúa esa competencia', () => {
    // c3 no la responden los pares: jefatura 2 (50) + equipo 4 (25) → 2,67
    expect(comp('c3').promedio).toBe(2.67);
  });

  it('combina competencias y objetivos en la nota final', () => {
    // c1 3,5·2 + c2 3,25 + c3 2,67 = 12,92 / 4 = 3,23 → 64,6 %
    expect(r.puntaje_competencias).toBe(3.23);
    expect(r.porcentaje_competencias).toBe(64.6);
    expect(r.porcentaje_objetivos).toBe(90);
    expect(r.porcentaje_final).toBe(74.8); // 64,6·0,6 + 90·0,4
    expect(r.nivel?.etiqueta).toBe('Cumple lo esperado');
  });

  it('sin objetivos medidos la nota final es la de competencias', () => {
    const solo = calcularResultado(config, asignaciones, []);
    expect(solo.porcentaje_final).toBe(64.6);
  });

  it('detecta el punto ciego: se ve mejor de lo que lo ven', () => {
    expect(r.puntos_ciegos.map((c) => c.id)).toContain('c3');
    expect(r.fortalezas_ocultas).toEqual([]);
  });

  it('funde los grupos chicos para no delatar al único que respondió', () => {
    // pares 2 (alcanza el mínimo) + equipo 1 (no alcanza) → un solo grupo de 3
    const claves = r.grupos.map((g) => g.clave);
    expect(claves).toEqual(['auto', 'jefatura', 'combinado']);
    const combinado = r.grupos.find((g) => g.clave === 'combinado')!;
    expect(combinado.n).toBe(3);
    expect(combinado.visible).toBe(true);
    expect(comp('c1').por_grupo.combinado).toBe(3.33);
    expect(r.comentarios.every((c) => c.autor === null)).toBe(true);
    expect(r.comentarios.find((c) => c.texto.startsWith('A veces'))?.grupo).toBe('combinado');
  });

  it('si ni fundidos alcanzan el mínimo, cuentan en la nota pero no se desglosan', () => {
    const pocos = calcularResultado(config, [asignaciones[1], asignaciones[4]], []);
    const g = pocos.grupos.find((x) => x.clave === 'reporte')!;
    expect(g.visible).toBe(false);
    expect(g.promedio).toBeNull();
    expect(pocos.respuestas.protegidas).toBe(1);
    expect(pocos.comentarios.map((c) => c.grupo)).toEqual(['jefatura']);
    expect(pocos.competencias.find((c) => c.id === 'c1')!.promedio).toBe(3.33); // (4·50 + 2·25) / 75
  });

  it('sin anonimato separa cada relación y firma los comentarios', () => {
    const abierto = calcularResultado({ ...config, anonimo: false }, asignaciones, [], {
      nombres: new Map([[4, 'Caro Soto']]),
    });
    expect(abierto.grupos.map((g) => g.clave)).toEqual(['auto', 'jefatura', 'par', 'reporte']);
    expect(abierto.comentarios.find((c) => c.grupo === 'reporte')?.autor).toBe('Caro Soto');
  });

  it('agrupa las respuestas abiertas por pregunta', () => {
    expect(r.abiertas[0].respuestas).toHaveLength(3);
  });

  it('sin respuestas no inventa notas', () => {
    const vacio = calcularResultado(config, [], []);
    expect(vacio.porcentaje_final).toBeNull();
    expect(vacio.nivel).toBeNull();
    expect(vacio.grupos).toEqual([]);
  });
});

describe('nivelDe', () => {
  it('ubica el porcentaje en su tramo', () => {
    expect(nivelDe(config, 49.9)?.etiqueta).toBe('Insuficiente');
    expect(nivelDe(config, 80)?.etiqueta).toBe('Destacado');
    expect(nivelDe(config, 100)?.etiqueta).toBe('Sobresaliente');
    expect(nivelDe(config, null)).toBeNull();
  });
});
