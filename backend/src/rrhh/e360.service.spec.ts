import { E360Service } from './e360.service';

/* Evaluación 360° (2026-11-19): recorrido completo de un ciclo contra una base
   en memoria. Lo que se cuida aquí es QUIÉN puede ver y hacer qué: el
   trabajador solo llega a lo suyo, el informe se abre recién al publicar, el
   instrumento queda fijo con el ciclo en marcha y el anonimato no se filtra. */

// ── Doble mínimo del cliente de Supabase (solo lo que usa el servicio) ──────
class Consulta {
  private filtros: ((f: any) => boolean)[] = [];
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private carga: any;
  private ignorarDuplicados = false;
  private columnas: string[] | null = null;

  constructor(
    private bd: Record<string, any[]>,
    private tabla: string,
    private sec: { n: number },
  ) {}

  // Proyecta las columnas pedidas, como PostgREST: así se nota si el servicio
  // pide de más (por ejemplo, respuestas donde solo hace falta el estado).
  select(cols?: string) {
    if (this.op === 'select' && cols && cols !== '*') this.columnas = cols.split(',').map((c) => c.trim());
    return this;
  }
  insert(filas: any) { this.op = 'insert'; this.carga = Array.isArray(filas) ? filas : [filas]; return this; }
  upsert(filas: any, o?: any) { this.ignorarDuplicados = Boolean(o?.ignoreDuplicates); return this.insert(filas); }
  update(cambio: any) { this.op = 'update'; this.carga = cambio; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filtros.push((f) => String(f[c]) === String(v)); return this; }
  in(c: string, vs: any[]) { const s = new Set(vs.map(String)); this.filtros.push((f) => s.has(String(f[c]))); return this; }
  ilike(c: string, v: any) { this.filtros.push((f) => String(f[c] || '').toLowerCase() === String(v).toLowerCase()); return this; }
  order() { return this; }
  range() { return this; }

  private ejecutar(): { data: any; error: any } {
    const filas = (this.bd[this.tabla] ||= []);
    const calza = (f: any) => this.filtros.every((fn) => fn(f));
    if (this.op === 'insert') {
      const nuevas: any[] = [];
      for (const fila of this.carga) {
        if (this.tabla === 'rrhh_e360_asignaciones') {
          const repetida = filas.some(
            (x) => x.ciclo_id === fila.ciclo_id && x.evaluado_id === fila.evaluado_id && x.evaluador_id === fila.evaluador_id,
          );
          if (repetida && this.ignorarDuplicados) continue;
          if (repetida) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        }
        const base = this.tabla === 'rrhh_e360_asignaciones' ? { estado: 'pendiente', respuestas: {}, abiertas: {} } : {};
        const completa = { id: (this.sec.n += 1), ...base, ...JSON.parse(JSON.stringify(fila)) };
        filas.push(completa);
        nuevas.push(completa);
      }
      return { data: nuevas, error: null };
    }
    if (this.op === 'update') {
      const tocadas = filas.filter(calza);
      tocadas.forEach((f) => Object.assign(f, JSON.parse(JSON.stringify(this.carga))));
      return { data: tocadas, error: null };
    }
    if (this.op === 'delete') {
      this.bd[this.tabla] = filas.filter((f) => !calza(f));
      return { data: null, error: null };
    }
    const proyectar = (f: any) => (this.columnas ? Object.fromEntries(this.columnas.map((c) => [c, f[c]])) : f);
    return { data: filas.filter(calza).map((f) => JSON.parse(JSON.stringify(proyectar(f)))), error: null };
  }

  async maybeSingle() { const r = this.ejecutar(); return { data: r.data?.[0] ?? null, error: r.error }; }
  async single() { return this.maybeSingle(); }
  then(ok: any, mal: any) { return Promise.resolve(this.ejecutar()).then(ok, mal); }
}

function armar() {
  const bd: Record<string, any[]> = {
    rrhh_empleados: [
      { id: 1, nombre: 'Julia', apellidos: 'Jefa', email: 'jefa@a.cl', jefatura_email: null, cargo: 'Gerenta', area: 'Gerencia', estado: 'activo' },
      { id: 2, nombre: 'Ana', apellidos: 'Araya', email: 'ana@a.cl', jefatura_email: 'jefa@a.cl', cargo: 'Ejecutiva', area: 'Ventas', estado: 'activo' },
      { id: 3, nombre: 'Beto', apellidos: 'Bravo', email: 'beto@a.cl', jefatura_email: 'jefa@a.cl', cargo: 'Ejecutivo', area: 'Ventas', estado: 'activo' },
      { id: 4, nombre: 'Caro', apellidos: 'Castro', email: 'caro@a.cl', jefatura_email: 'jefa@a.cl', cargo: 'Bodega', area: 'Bodega', estado: 'activo' },
    ],
    notificaciones: [],
  };
  const sec = { n: 100 };
  const cliente = { from: (tabla: string) => new Consulta(bd, tabla, sec) };
  const servicio = new E360Service({ getClient: () => cliente } as any);
  const emp = (id: number) => bd.rrhh_empleados.find((e) => e.id === id);
  return { bd, servicio, emp };
}

const CONFIG = {
  competencias: [
    { id: 'c1', nombre: 'Trabajo en equipo' },
    { id: 'c2', nombre: 'Comunicación' },
    { id: 'c3', nombre: 'Liderazgo', relaciones: ['reporte'] },
  ],
  preguntas: [{ id: 'p1', texto: '¿Qué debería seguir haciendo?', obligatoria: false }],
  min_anonimato: 2,
};

describe('E360Service — un ciclo de punta a punta', () => {
  const { bd, servicio, emp } = armar();
  let cicloId: number;
  const formulariosDe = async (id: number) => (await servicio.misDatos(emp(id))).formularios as any[];
  const responder = async (id: number, nota: number, comentario = '') => {
    for (const f of (await formulariosDe(id)).filter((x) => x.abierta)) {
      const form = await servicio.miFormulario(emp(id), f.id);
      const respuestas = Object.fromEntries(form.competencias.map((c: any) => [c.id, { puntaje: nota, comentario }]));
      await servicio.guardarMiFormulario(emp(id), f.id, { respuestas, abiertas: {}, enviar: true });
    }
  };

  it('crea el ciclo en borrador con el instrumento saneado', async () => {
    const c = await servicio.guardarCiclo({ nombre: '360 de prueba', fecha_cierre: '2026-12-15', config: CONFIG }, 'admin@a.cl');
    cicloId = c.id;
    expect(c.estado).toBe('borrador');
    expect(c.config.competencias).toHaveLength(3);
    expect(c.config.anonimo).toBe(true);
    await expect(servicio.guardarCiclo({ nombre: '  ' })).rejects.toThrow('nombre');
  });

  it('no deja iniciar sin matriz', async () => {
    await expect(servicio.cambiarEstado(cicloId, 'activo')).rejects.toThrow('matriz');
  });

  it('simula la matriz sin guardar y luego la genera una sola vez', async () => {
    await servicio.definirParticipantes(cicloId, [1, 2, 3, 4]);
    const sim = await servicio.sugerirMatriz(cicloId, {});
    // 4 auto + 3 jefatura + 3 equipo→jefa + 3·2 pares = 16
    expect(sim.nuevas).toHaveLength(16);
    expect(sim.por_relacion).toEqual({ auto: 4, jefatura: 3, par: 6, reporte: 3, otro: 0 });
    expect(sim.sin_jefatura.map((e: any) => e.id)).toEqual([1]);
    expect(bd.rrhh_e360_asignaciones || []).toHaveLength(0);

    expect((await servicio.generarMatriz(cicloId, {})).agregadas).toBe(16);
    expect((await servicio.generarMatriz(cicloId, {})).agregadas).toBe(0);
  });

  it('rechaza un evaluador repetido y una autoevaluación ajena', async () => {
    await expect(servicio.crearAsignacion(cicloId, { evaluado_id: 2, evaluador_id: 1, relacion: 'otro' })).rejects.toThrow('ya evalúa');
    await expect(servicio.crearAsignacion(cicloId, { evaluado_id: 2, evaluador_id: 9, relacion: 'auto' })).rejects.toThrow('misma persona');
  });

  it('en borrador el trabajador todavía no ve nada', async () => {
    expect(await formulariosDe(2)).toEqual([]);
  });

  it('al iniciar avisa a cada evaluador en la campana', async () => {
    const r = await servicio.cambiarEstado(cicloId, 'activo');
    expect(r.estado).toBe('activo');
    expect(r.avisados).toBe(4);
    const aviso = bd.notificaciones.find((n) => n.user_email === 'ana@a.cl');
    expect(aviso.tipo).toBe('rrhh_e360_pendiente');
    expect(aviso.link).toBe('/mi-ficha?seccion=e360');
    expect(aviso.mensaje).toContain('4 evaluaciones'); // auto + jefa + 2 pares
  });

  it('con el ciclo en marcha el instrumento y el anonimato quedan fijos', async () => {
    const c = await servicio.guardarCiclo({
      id: cicloId,
      nombre: '360 de prueba',
      config: { ...CONFIG, competencias: [], anonimo: false, min_anonimato: 1, peso_objetivos: 50, peso_competencias: 50 },
    });
    expect(c.config.competencias).toHaveLength(3);
    expect(c.config.anonimo).toBe(true);
    expect(c.config.min_anonimato).toBe(2);
    expect(c.config.peso_objetivos).toBe(50); // la ponderación sí se puede ajustar
  });

  it('cada persona ve solo sus formularios y las competencias que le tocan', async () => {
    const deAna = await formulariosDe(2);
    expect(deAna.map((f) => f.relacion).sort()).toEqual(['auto', 'par', 'par', 'reporte']);
    const aJefa = deAna.find((f) => f.relacion === 'reporte');
    const form = await servicio.miFormulario(emp(2), aJefa.id);
    expect(form.evaluado?.nombre).toBe('Julia Jefa');
    expect(form.competencias.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3']); // liderazgo: solo el equipo
    const auto = await servicio.miFormulario(emp(2), deAna.find((f) => f.relacion === 'auto').id);
    expect(auto.competencias.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    await expect(servicio.miFormulario(emp(3), aJefa.id)).rejects.toThrow('no te corresponde');
    await expect(servicio.guardarMiFormulario(emp(3), aJefa.id, { enviar: true })).rejects.toThrow('no te corresponde');
  });

  it('guarda borradores, exige todo para enviar y cierra al enviar', async () => {
    const f = (await formulariosDe(2)).find((x) => x.relacion === 'auto');
    await servicio.guardarMiFormulario(emp(2), f.id, { respuestas: { c1: { puntaje: 5 } }, enviar: false });
    expect((await formulariosDe(2)).find((x) => x.id === f.id).estado).toBe('en_progreso');
    await expect(servicio.guardarMiFormulario(emp(2), f.id, { respuestas: { c1: { puntaje: 5 } }, enviar: true })).rejects.toThrow('Comunicación');
    await servicio.guardarMiFormulario(emp(2), f.id, { respuestas: { c1: { puntaje: 5 }, c2: { puntaje: 5 } }, enviar: true });
    await expect(servicio.guardarMiFormulario(emp(2), f.id, { respuestas: {}, enviar: false })).rejects.toThrow('Ya enviaste');
  });

  it('con respuestas ya no se puede volver a borrador', async () => {
    await expect(servicio.cambiarEstado(cicloId, 'borrador')).rejects.toThrow('iniciadas');
  });

  it('RR.HH. puede devolver un formulario enviado', async () => {
    const f = (await formulariosDe(2)).find((x) => x.relacion === 'auto');
    await servicio.reabrirAsignacion(f.id);
    expect((await formulariosDe(2)).find((x) => x.id === f.id).abierta).toBe(true);
  });

  it('el panel sabe quién respondió, pero no recibe las respuestas', async () => {
    await responder(2, 4, 'Texto A');
    await responder(3, 3, 'Texto B');
    await responder(4, 2);
    await responder(1, 5, 'Texto J');
    const d = await servicio.detalleCiclo(cicloId);
    expect(d.asignaciones.every((a: any) => a.estado === 'enviada')).toBe(true);
    expect(d.asignaciones).toHaveLength(16);
    expect(d.asignaciones.every((a: any) => a.respuestas === undefined && a.abiertas === undefined && a.puntaje === undefined)).toBe(true);
  });

  it('el informe propio no se abre hasta publicar', async () => {
    await expect(servicio.miResultado(emp(2), cicloId)).rejects.toThrow('todavía no se publican');
    await servicio.cambiarEstado(cicloId, 'cerrado');
    await expect(servicio.miResultado(emp(2), cicloId)).rejects.toThrow('todavía no se publican');
    expect((await servicio.misDatos(emp(2))).informes).toEqual([]);
  });

  it('cerrado el ciclo no se reciben más respuestas', async () => {
    const f = (await formulariosDe(2))[0];
    await expect(servicio.guardarMiFormulario(emp(2), f.id, { respuestas: {}, enviar: false })).rejects.toThrow();
  });

  it('los objetivos entran en la nota y validan su meta', async () => {
    await expect(servicio.guardarObjetivo(cicloId, { empleado_id: 2, titulo: 'Ventas' })).rejects.toThrow('meta');
    const o = await servicio.guardarObjetivo(cicloId, { empleado_id: 2, titulo: 'Ventas', unidad: 'monto', meta: 1000, valor_real: 900 });
    expect(o.cumplimiento).toBe(90);
    const tabla = await servicio.resultados(cicloId);
    const ana = tabla.filas.find((f: any) => f.empleado.id === 2)!;
    expect(ana.porcentaje_objetivos).toBe(90);
    expect(ana.respuestas).toEqual({ total: 4, enviadas: 4 });
    expect(tabla.filas[0].porcentaje_final).toBeGreaterThanOrEqual(tabla.filas[1].porcentaje_final as number);
  });

  it('al publicar avisa a los evaluados y cada uno ve su informe, sin nombres', async () => {
    const r = await servicio.cambiarEstado(cicloId, 'publicado');
    expect(r.avisados).toBe(4);
    const informe = await servicio.miResultado(emp(2), cicloId);
    expect(informe.empleado.nombre).toBe('Ana Araya');
    expect(informe.resultado.grupos.map((g) => g.clave)).toEqual(['auto', 'jefatura', 'par']);
    expect(informe.resultado.comentarios.length).toBeGreaterThan(0);
    expect(informe.resultado.comentarios.every((c) => c.autor === null)).toBe(true);
    expect(JSON.stringify(informe)).not.toContain('Beto');
    expect((await servicio.misDatos(emp(2))).informes).toHaveLength(1);
  });

  it('el equipo de la jefa es un grupo de 3: se muestra, pero sin autor', async () => {
    const informe = await servicio.miResultado(emp(1), cicloId);
    const equipo = informe.resultado.grupos.find((g) => g.clave === 'reporte')!;
    expect(equipo.n).toBe(3);
    expect(equipo.visible).toBe(true);
    expect(informe.resultado.competencias.find((c) => c.id === 'c3')!.por_grupo.reporte).toBe(3); // (4+3+2)/3
  });

  it('la jefatura ve a su equipo solo si el ciclo lo permite, y nadie más', async () => {
    await expect(servicio.resultadoDeMiEquipo(emp(1), cicloId, 2)).rejects.toThrow('no comparte');
    expect((await servicio.misDatos(emp(1))).equipo).toEqual([]);
    await servicio.guardarCiclo({ id: cicloId, nombre: '360 de prueba', config: { ...CONFIG, jefatura_ve_resultados: true } });
    expect((await servicio.resultadoDeMiEquipo(emp(1), cicloId, 2)).empleado.nombre).toBe('Ana Araya');
    expect((await servicio.misDatos(emp(1))).equipo).toHaveLength(3);
    await expect(servicio.resultadoDeMiEquipo(emp(3), cicloId, 2)).rejects.toThrow('equipo directo');
  });

  it('guarda el cierre de RR.HH. y el acuse del evaluado', async () => {
    await servicio.guardarCierre(cicloId, 2, {
      retro_rrhh: 'Buen semestre.',
      plan_desarrollo: [{ accion: 'Curso de negociación', plazo: '2027-03-31', estado: 'en_curso' }, { accion: '  ' }],
    });
    await servicio.acusar(emp(2), cicloId, 'De acuerdo.');
    const informe = await servicio.miResultado(emp(2), cicloId);
    expect(informe.cierre.retro_rrhh).toBe('Buen semestre.');
    expect(informe.cierre.plan_desarrollo).toHaveLength(1);
    expect(informe.cierre.acuse_at).toBeTruthy();
    expect(informe.cierre.comentario_evaluado).toBe('De acuerdo.');
  });

  it('quitar a alguien con respuestas pide confirmación', async () => {
    await servicio.cambiarEstado(cicloId, 'cerrado');
    await expect(servicio.definirParticipantes(cicloId, [1, 2, 3])).rejects.toThrow('ya tienen evaluaciones respondidas');
    const r = await servicio.definirParticipantes(cicloId, [1, 2, 3], true);
    expect(r.quitados).toBe(1);
    expect(bd.rrhh_e360_asignaciones.some((a) => a.evaluado_id === 4)).toBe(false);
    expect(bd.rrhh_e360_asignaciones.some((a) => a.evaluador_id === 4)).toBe(true); // lo que ella respondió sigue contando
  });
});
