import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  RELACIONES,
  Relacion,
  calcularResultado,
  competenciasPara,
  cumplimientoObjetivo,
  normalizarConfig,
  puntajeFormulario,
  sanearRespuestas,
  sugerirAsignaciones,
  validarFormulario,
} from './e360.calculo';

/* ============================================================================
   Evaluación 360° — servicio
   ----------------------------------------------------------------------------
   Ciclos, participantes, matriz de evaluadores, objetivos, formularios y
   resultados. El cálculo vive en e360.calculo.ts; aquí solo se leen y guardan
   filas y se decide quién puede ver qué:

   · En un ciclo ANÓNIMO nadie —tampoco el panel de RR.HH.— ve qué respondió
     cada par o cada persona del equipo: el panel sabe quién respondió y quién
     falta, pero las notas y comentarios salen siempre agregados.
   · El trabajador solo llega a sus propios formularios y a su propio informe,
     y al informe recién cuando el ciclo está publicado.
============================================================================ */

const ESTADOS = ['borrador', 'activo', 'cerrado', 'publicado'];
const TRANSICIONES: Record<string, string[]> = {
  borrador: ['activo'],
  activo: ['cerrado', 'borrador'],
  cerrado: ['activo', 'publicado'],
  publicado: ['cerrado'],
};
export const TIPO_E360_PENDIENTE = 'rrhh_e360_pendiente';
export const TIPO_E360_PUBLICADA = 'rrhh_e360_publicada';
const LINK_MI_FICHA = '/mi-ficha?seccion=e360';

const num = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const texto = (v: any, max = 400): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const correo = (v: any) => String(v || '').trim().toLowerCase();
const nombreDe = (e: any) => `${e?.nombre || ''} ${e?.apellidos || ''}`.trim() || 'Sin nombre';
const esRelacion = (v: any): v is Relacion => (RELACIONES as readonly string[]).includes(v);

const CAMPOS_EMPLEADO = 'id, nombre, apellidos, email, cargo, area, jefatura_email, estado';

@Injectable()
export class E360Service {
  private readonly logger = new Logger(E360Service.name);

  constructor(private supabase: SupabaseService) {}

  private get db() {
    return this.supabase.getClient();
  }

  private error(e: any): never {
    const msg = String(e?.message || e || 'Error desconocido');
    if (/rrhh_e360_/i.test(msg) && (/does not exist/i.test(msg) || /schema cache/i.test(msg) || /could not find/i.test(msg))) {
      throw new BadRequestException(
        'Falta aplicar la migración de Evaluación 360° (supabase/migrations/20261119_rrhh_evaluacion_360.sql).',
      );
    }
    throw new BadRequestException(msg);
  }

  // ── Lecturas base ─────────────────────────────────────────────────────────
  private async empleados(): Promise<any[]> {
    const { data, error } = await this.db.from('rrhh_empleados').select(CAMPOS_EMPLEADO).order('nombre');
    if (error) this.error(error);
    return data || [];
  }

  private fichaPublica(e: any) {
    return e
      ? { id: Number(e.id), nombre: nombreDe(e), cargo: e.cargo || null, area: e.area || null, email: e.email || null, estado: e.estado }
      : null;
  }

  private async ciclo(id: number) {
    const { data, error } = await this.db.from('rrhh_e360_ciclos').select('*').eq('id', id).maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Ciclo de evaluación no encontrado.');
    return { ...data, config: normalizarConfig(data.config) };
  }

  private async asignacionesDe(cicloId: number, columnas = '*'): Promise<any[]> {
    const { data, error } = await this.db
      .from('rrhh_e360_asignaciones')
      .select(columnas)
      .eq('ciclo_id', cicloId)
      .order('id')
      .range(0, 4999);
    if (error) this.error(error);
    return data || [];
  }

  private async objetivosDe(cicloId: number, empleadoId?: number): Promise<any[]> {
    let q = this.db.from('rrhh_e360_objetivos').select('*').eq('ciclo_id', cicloId).order('orden').order('id');
    if (empleadoId) q = q.eq('empleado_id', empleadoId);
    const { data, error } = await q.range(0, 4999);
    if (error) this.error(error);
    return (data || []).map((o: any) => ({ ...o, cumplimiento: cumplimientoObjetivo(o) }));
  }

  private async evaluadosDe(cicloId: number): Promise<any[]> {
    const { data, error } = await this.db.from('rrhh_e360_evaluados').select('*').eq('ciclo_id', cicloId).order('id');
    if (error) this.error(error);
    return data || [];
  }

  // ==========================================================================
  // CICLOS (admin)
  // ==========================================================================
  async listarCiclos() {
    const { data, error } = await this.db
      .from('rrhh_e360_ciclos')
      .select('id, nombre, periodo, descripcion, fecha_inicio, fecha_cierre, estado, activado_at, cerrado_at, publicado_at, created_at')
      .order('created_at', { ascending: false });
    if (error) this.error(error);
    const ciclos = data || [];
    if (!ciclos.length) return [];
    const ids = ciclos.map((c: any) => c.id);
    const [asig, evals] = await Promise.all([
      this.db.from('rrhh_e360_asignaciones').select('ciclo_id, estado').in('ciclo_id', ids).range(0, 9999),
      this.db.from('rrhh_e360_evaluados').select('ciclo_id').in('ciclo_id', ids).range(0, 9999),
    ]);
    if (asig.error) this.error(asig.error);
    if (evals.error) this.error(evals.error);
    return ciclos.map((c: any) => {
      const suyas = (asig.data || []).filter((a: any) => a.ciclo_id === c.id);
      return {
        ...c,
        evaluados: (evals.data || []).filter((e: any) => e.ciclo_id === c.id).length,
        formularios: suyas.length,
        enviados: suyas.filter((a: any) => a.estado === 'enviada').length,
      };
    });
  }

  async detalleCiclo(id: number) {
    const ciclo = await this.ciclo(id);
    const [evaluados, asignaciones, objetivos] = await Promise.all([
      this.evaluadosDe(id),
      // Sin respuestas: el panel solo necesita saber quién respondió.
      this.asignacionesDe(id, 'id, evaluado_id, evaluador_id, relacion, estado, iniciada_at, enviada_at'),
      this.objetivosDe(id),
    ]);
    return { ciclo, evaluados, asignaciones, objetivos };
  }

  async guardarCiclo(body: any, autor?: string) {
    const nombre = texto(body?.nombre, 160);
    if (!nombre) throw new BadRequestException('El ciclo necesita un nombre.');
    const comunes: Record<string, any> = {
      nombre,
      periodo: texto(body?.periodo, 40),
      descripcion: texto(body?.descripcion, 2000),
      instrucciones: texto(body?.instrucciones, 4000),
      fecha_inicio: body?.fecha_inicio || null,
      fecha_cierre: body?.fecha_cierre || null,
      updated_at: new Date().toISOString(),
    };
    if (comunes.fecha_inicio && comunes.fecha_cierre && comunes.fecha_cierre < comunes.fecha_inicio) {
      throw new BadRequestException('La fecha de cierre no puede ser anterior a la de inicio.');
    }

    if (!body?.id) {
      const { data, error } = await this.db
        .from('rrhh_e360_ciclos')
        .insert({ ...comunes, estado: 'borrador', config: normalizarConfig(body?.config), creado_por: texto(autor, 120) })
        .select()
        .single();
      if (error) this.error(error);
      return { ...data, config: normalizarConfig(data.config) };
    }

    const actual = await this.ciclo(num(body.id));
    const nueva = normalizarConfig(body?.config ?? actual.config);
    let config = nueva;
    if (actual.estado !== 'borrador') {
      // Con el ciclo en marcha el instrumento queda fijo (ya hay gente
      // respondiéndolo) y el anonimato prometido no se puede retirar. Lo que sí
      // se puede ajustar es cómo se pondera y qué niveles se muestran.
      config = {
        ...actual.config,
        pesos_relacion: nueva.pesos_relacion,
        peso_competencias: nueva.peso_competencias,
        peso_objetivos: nueva.peso_objetivos,
        niveles: nueva.niveles,
        jefatura_ve_resultados: nueva.jefatura_ve_resultados,
        max_pares: nueva.max_pares,
      };
    }
    const { data, error } = await this.db
      .from('rrhh_e360_ciclos')
      .update({ ...comunes, config })
      .eq('id', actual.id)
      .select()
      .single();
    if (error) this.error(error);
    return { ...data, config: normalizarConfig(data.config) };
  }

  async eliminarCiclo(id: number) {
    const { error } = await this.db.from('rrhh_e360_ciclos').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // Copia el instrumento y los participantes; la matriz y las respuestas no.
  async duplicarCiclo(id: number, autor?: string) {
    const origen = await this.ciclo(id);
    const { data, error } = await this.db
      .from('rrhh_e360_ciclos')
      .insert({
        nombre: `${origen.nombre} (copia)`.slice(0, 160),
        periodo: origen.periodo,
        descripcion: origen.descripcion,
        instrucciones: origen.instrucciones,
        estado: 'borrador',
        config: origen.config,
        creado_por: texto(autor, 120),
      })
      .select()
      .single();
    if (error) this.error(error);
    const evaluados = await this.evaluadosDe(id);
    if (evaluados.length) {
      const { error: e2 } = await this.db
        .from('rrhh_e360_evaluados')
        .insert(evaluados.map((e: any) => ({ ciclo_id: data.id, empleado_id: e.empleado_id })));
      if (e2) this.error(e2);
    }
    return data;
  }

  async cambiarEstado(id: number, estadoNuevo: string) {
    const ciclo = await this.ciclo(id);
    const estado = String(estadoNuevo || '').trim();
    if (!ESTADOS.includes(estado)) throw new BadRequestException('Estado inválido.');
    if (estado === ciclo.estado) return ciclo;
    if (!TRANSICIONES[ciclo.estado]?.includes(estado)) {
      throw new BadRequestException(`Un ciclo ${ciclo.estado} no puede pasar a ${estado}.`);
    }
    const asignaciones = await this.asignacionesDe(id, 'id, evaluado_id, evaluador_id, estado');
    const ahora = new Date().toISOString();
    const cambio: Record<string, any> = { estado, updated_at: ahora };

    if (estado === 'activo' && ciclo.estado === 'borrador') {
      if (!ciclo.config.competencias.length) {
        throw new BadRequestException('Agrega al menos una competencia antes de iniciar el ciclo.');
      }
      if (!asignaciones.length) {
        throw new BadRequestException('Arma la matriz de evaluadores antes de iniciar el ciclo.');
      }
      cambio.activado_at = ahora;
    }
    if (estado === 'borrador' && asignaciones.some((a: any) => a.estado !== 'pendiente')) {
      throw new BadRequestException('Ya hay evaluaciones iniciadas: el ciclo no puede volver a borrador. Ciérralo.');
    }
    if (estado === 'cerrado' && ciclo.estado === 'activo') cambio.cerrado_at = ahora;
    if (estado === 'publicado') cambio.publicado_at = ahora;

    const { data, error } = await this.db.from('rrhh_e360_ciclos').update(cambio).eq('id', id).select().single();
    if (error) this.error(error);

    let avisados = 0;
    if (estado === 'activo' && ciclo.estado === 'borrador') {
      avisados = (await this.avisarPendientes(ciclo, asignaciones)).avisados;
    }
    if (estado === 'publicado') avisados = await this.avisarPublicacion(ciclo);
    return { ...data, config: normalizarConfig(data.config), avisados };
  }

  // ── Avisos en la campana ──────────────────────────────────────────────────
  private async notificar(filas: { user_email: string; tipo: string; mensaje: string; link: string; metadata: any }[]) {
    if (!filas.length) return 0;
    const { error } = await this.db.from('notificaciones').insert(filas);
    if (error) {
      // El aviso es un complemento: si falla no se cae la operación.
      this.logger.warn(`No se pudieron crear los avisos de Evaluación 360°: ${error.message}`);
      return 0;
    }
    return filas.length;
  }

  // Un aviso por evaluador con formularios sin enviar. `simular` solo cuenta.
  private async avisarPendientes(ciclo: any, asignaciones: any[], simular = false) {
    const empleados = await this.empleados();
    const porId = new Map(empleados.map((e: any) => [Number(e.id), e]));
    const pendientes = new Map<number, number>();
    for (const a of asignaciones) {
      if (a.estado === 'enviada') continue;
      pendientes.set(Number(a.evaluador_id), (pendientes.get(Number(a.evaluador_id)) || 0) + 1);
    }
    const destinatarios = [...pendientes.entries()]
      .map(([id, n]) => ({ empleado: porId.get(id), pendientes: n }))
      .filter((d) => d.empleado)
      .map((d) => ({ ...this.fichaPublica(d.empleado)!, pendientes: d.pendientes }))
      .sort((a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre));
    const sinCorreo = destinatarios.filter((d) => !correo(d.email));
    const conCorreo = destinatarios.filter((d) => correo(d.email));
    if (simular) return { simulacion: true, avisados: 0, destinatarios: conCorreo, sin_correo: sinCorreo };

    const cierre = ciclo.fecha_cierre ? ` Cierra el ${String(ciclo.fecha_cierre).split('-').reverse().join('-')}.` : '';
    const avisados = await this.notificar(
      conCorreo.map((d) => ({
        user_email: correo(d.email),
        tipo: TIPO_E360_PENDIENTE,
        mensaje: `Evaluación 360° «${ciclo.nombre}»: tienes ${d.pendientes} ${d.pendientes === 1 ? 'evaluación' : 'evaluaciones'} por responder.${cierre}`,
        link: LINK_MI_FICHA,
        metadata: { ciclo_id: ciclo.id, pendientes: d.pendientes },
      })),
    );
    return { simulacion: false, avisados, destinatarios: conCorreo, sin_correo: sinCorreo };
  }

  private async avisarPublicacion(ciclo: any) {
    const [evaluados, empleados] = await Promise.all([this.evaluadosDe(ciclo.id), this.empleados()]);
    const porId = new Map(empleados.map((e: any) => [Number(e.id), e]));
    return this.notificar(
      evaluados
        .map((e: any) => porId.get(Number(e.empleado_id)))
        .filter((e: any) => e && correo(e.email))
        .map((e: any) => ({
          user_email: correo(e.email),
          tipo: TIPO_E360_PUBLICADA,
          mensaje: `Tu informe de la Evaluación 360° «${ciclo.nombre}» ya está disponible en Mi Ficha.`,
          link: LINK_MI_FICHA,
          metadata: { ciclo_id: ciclo.id },
        })),
    );
  }

  async recordar(id: number, simular: boolean) {
    const ciclo = await this.ciclo(id);
    if (ciclo.estado !== 'activo') throw new BadRequestException('Solo se recuerda mientras el ciclo está en curso.');
    const asignaciones = await this.asignacionesDe(id, 'id, evaluador_id, estado');
    return this.avisarPendientes(ciclo, asignaciones, simular);
  }

  // ==========================================================================
  // PARTICIPANTES Y MATRIZ (admin)
  // ==========================================================================
  async definirParticipantes(id: number, empleadoIds: any[], forzar = false) {
    const ciclo = await this.ciclo(id);
    if (ciclo.estado === 'publicado') throw new BadRequestException('El ciclo ya está publicado.');
    const pedidos = [...new Set((Array.isArray(empleadoIds) ? empleadoIds : []).map((x) => num(x)).filter(Boolean))];
    const actuales = await this.evaluadosDe(id);
    const actualesIds = new Set(actuales.map((e: any) => Number(e.empleado_id)));
    const nuevos = pedidos.filter((x) => !actualesIds.has(x));
    const quitar = [...actualesIds].filter((x) => !pedidos.includes(x));

    if (quitar.length) {
      const asignaciones = await this.asignacionesDe(id, 'id, evaluado_id, estado');
      const conRespuestas = quitar.filter((x) =>
        asignaciones.some((a: any) => Number(a.evaluado_id) === x && a.estado !== 'pendiente'),
      );
      if (conRespuestas.length && !forzar) {
        throw new BadRequestException(
          `${conRespuestas.length} de las personas que quitas ya tienen evaluaciones respondidas. Confirma para eliminarlas junto con sus respuestas.`,
        );
      }
      for (const tabla of ['rrhh_e360_asignaciones', 'rrhh_e360_objetivos']) {
        const col = tabla === 'rrhh_e360_asignaciones' ? 'evaluado_id' : 'empleado_id';
        const { error } = await this.db.from(tabla).delete().eq('ciclo_id', id).in(col, quitar);
        if (error) this.error(error);
      }
      const { error } = await this.db.from('rrhh_e360_evaluados').delete().eq('ciclo_id', id).in('empleado_id', quitar);
      if (error) this.error(error);
    }
    if (nuevos.length) {
      const { error } = await this.db
        .from('rrhh_e360_evaluados')
        .insert(nuevos.map((empleado_id) => ({ ciclo_id: id, empleado_id })));
      if (error) this.error(error);
    }
    return { agregados: nuevos.length, quitados: quitar.length };
  }

  private opcionesMatriz(ciclo: any, body: any) {
    return {
      auto: body?.auto !== false,
      jefatura: body?.jefatura !== false,
      pares: body?.pares !== false,
      reportes: body?.reportes !== false,
      max_pares: body?.max_pares != null ? Math.max(0, Math.min(10, num(body.max_pares))) : ciclo.config.max_pares,
    };
  }

  // Simulación de la matriz: qué se agregaría, sin guardar nada.
  async sugerirMatriz(id: number, body: any) {
    const ciclo = await this.ciclo(id);
    const [empleados, evaluados, existentes] = await Promise.all([
      this.empleados(),
      this.evaluadosDe(id),
      this.asignacionesDe(id, 'id, evaluado_id, evaluador_id'),
    ]);
    const ids = evaluados.map((e: any) => Number(e.empleado_id));
    const porId = new Map(empleados.map((e: any) => [Number(e.id), e]));
    const porCorreo = new Set(empleados.map((e: any) => correo(e.email)).filter(Boolean));
    const ya = new Set(existentes.map((a: any) => `${a.evaluado_id}|${a.evaluador_id}`));
    const sugeridas = sugerirAsignaciones(empleados, ids, this.opcionesMatriz(ciclo, body));
    const nuevas = sugeridas.filter((s) => !ya.has(`${s.evaluado_id}|${s.evaluador_id}`));
    const fichas = ids.map((x) => porId.get(x)).filter(Boolean);
    return {
      opciones: this.opcionesMatriz(ciclo, body),
      nuevas,
      ya_existentes: sugeridas.length - nuevas.length,
      por_relacion: RELACIONES.reduce(
        (acc, r) => ({ ...acc, [r]: nuevas.filter((n) => n.relacion === r).length }),
        {} as Record<string, number>,
      ),
      // Avisos para que RR.HH. complete las fichas antes de generar.
      sin_correo: fichas.filter((e: any) => !correo(e.email)).map((e: any) => this.fichaPublica(e)),
      sin_jefatura: fichas
        .filter((e: any) => !correo(e.jefatura_email) || !porCorreo.has(correo(e.jefatura_email)))
        .map((e: any) => this.fichaPublica(e)),
    };
  }

  async generarMatriz(id: number, body: any) {
    const ciclo = await this.ciclo(id);
    if (['cerrado', 'publicado'].includes(ciclo.estado)) {
      throw new BadRequestException('El ciclo está cerrado: reábrelo para cambiar la matriz.');
    }
    const sugerencia = await this.sugerirMatriz(id, body);
    if (sugerencia.nuevas.length) {
      const { error } = await this.db
        .from('rrhh_e360_asignaciones')
        .upsert(
          sugerencia.nuevas.map((n) => ({ ciclo_id: id, ...n })),
          { onConflict: 'ciclo_id,evaluado_id,evaluador_id', ignoreDuplicates: true },
        );
      if (error) this.error(error);
    }
    return { agregadas: sugerencia.nuevas.length };
  }

  async crearAsignacion(id: number, body: any) {
    const ciclo = await this.ciclo(id);
    if (['cerrado', 'publicado'].includes(ciclo.estado)) {
      throw new BadRequestException('El ciclo está cerrado: reábrelo para cambiar la matriz.');
    }
    const evaluado = num(body?.evaluado_id);
    const evaluador = num(body?.evaluador_id);
    let relacion = String(body?.relacion || '');
    if (!evaluado || !evaluador) throw new BadRequestException('Falta el evaluado o el evaluador.');
    if (evaluado === evaluador) relacion = 'auto';
    if (!esRelacion(relacion)) throw new BadRequestException('Relación inválida.');
    if (relacion === 'auto' && evaluado !== evaluador) {
      throw new BadRequestException('La autoevaluación solo puede hacerla la misma persona.');
    }
    const evaluados = await this.evaluadosDe(id);
    if (!evaluados.some((e: any) => Number(e.empleado_id) === evaluado)) {
      throw new BadRequestException('Esa persona no participa como evaluada en este ciclo.');
    }
    const { data, error } = await this.db
      .from('rrhh_e360_asignaciones')
      .insert({ ciclo_id: id, evaluado_id: evaluado, evaluador_id: evaluador, relacion })
      .select('id, evaluado_id, evaluador_id, relacion, estado')
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        throw new BadRequestException('Esa persona ya evalúa a este trabajador en el ciclo.');
      }
      this.error(error);
    }
    return data;
  }

  private async asignacion(id: number) {
    const { data, error } = await this.db.from('rrhh_e360_asignaciones').select('*').eq('id', id).maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Evaluación no encontrada.');
    return data;
  }

  async eliminarAsignacion(id: number, forzar = false) {
    const a = await this.asignacion(id);
    if (a.estado === 'enviada' && !forzar) {
      throw new BadRequestException('Esa evaluación ya fue enviada. Confirma para eliminarla junto con sus respuestas.');
    }
    const { error } = await this.db.from('rrhh_e360_asignaciones').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // Devuelve un formulario enviado a su autor para que lo corrija.
  async reabrirAsignacion(id: number) {
    const a = await this.asignacion(id);
    const ciclo = await this.ciclo(Number(a.ciclo_id));
    if (ciclo.estado !== 'activo') throw new BadRequestException('Solo se reabre con el ciclo en curso.');
    if (a.estado !== 'enviada') throw new BadRequestException('Esa evaluación todavía no se envía.');
    const { error } = await this.db
      .from('rrhh_e360_asignaciones')
      .update({ estado: 'en_progreso', enviada_at: null, puntaje: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ==========================================================================
  // OBJETIVOS (admin)
  // ==========================================================================
  async guardarObjetivo(cicloId: number, body: any) {
    const ciclo = await this.ciclo(cicloId);
    const empleadoId = num(body?.empleado_id);
    const titulo = texto(body?.titulo, 200);
    if (!empleadoId) throw new BadRequestException('Falta el trabajador.');
    if (!titulo) throw new BadRequestException('El objetivo necesita un título.');
    const unidad = ['porcentaje', 'numero', 'monto', 'si_no'].includes(body?.unidad) ? body.unidad : 'porcentaje';
    const numero = (v: any) => (v === null || v === undefined || v === '' ? null : num(v, NaN));
    const meta = unidad === 'si_no' ? 1 : numero(body?.meta);
    const real = numero(body?.valor_real);
    if (meta !== null && !Number.isFinite(meta)) throw new BadRequestException('La meta debe ser un número.');
    if (real !== null && !Number.isFinite(real)) throw new BadRequestException('El valor real debe ser un número.');
    if (unidad !== 'si_no' && meta === null) throw new BadRequestException('Indica la meta del objetivo.');
    const payload = {
      ciclo_id: ciclo.id,
      empleado_id: empleadoId,
      titulo,
      descripcion: texto(body?.descripcion, 2000),
      indicador: texto(body?.indicador, 200),
      unidad,
      sentido: body?.sentido === 'menor' && unidad !== 'si_no' ? 'menor' : 'mayor',
      meta,
      valor_real: real,
      peso: Math.max(0.1, Math.min(100, num(body?.peso, 1) || 1)),
      comentario: texto(body?.comentario, 2000),
      orden: Math.round(num(body?.orden)),
      updated_at: new Date().toISOString(),
    };
    const consulta = body?.id
      ? this.db.from('rrhh_e360_objetivos').update(payload).eq('id', num(body.id)).eq('ciclo_id', ciclo.id)
      : this.db.from('rrhh_e360_objetivos').insert(payload);
    const { data, error } = await consulta.select().single();
    if (error) this.error(error);
    return { ...data, cumplimiento: cumplimientoObjetivo(data) };
  }

  async eliminarObjetivo(id: number) {
    const { error } = await this.db.from('rrhh_e360_objetivos').delete().eq('id', id);
    if (error) this.error(error);
    return { ok: true };
  }

  // ==========================================================================
  // RESULTADOS
  // ==========================================================================
  private informe(ciclo: any, empleadoId: number, asignaciones: any[], objetivos: any[], empleados: any[]) {
    const nombres = new Map<number, string>(empleados.map((e: any) => [Number(e.id), nombreDe(e)]));
    return calcularResultado(
      ciclo.config,
      asignaciones.filter((a: any) => Number(a.evaluado_id) === empleadoId),
      objetivos.filter((o: any) => Number(o.empleado_id) === empleadoId),
      { nombres },
    );
  }

  // Tabla comparativa del ciclo: una fila por evaluado.
  async resultados(id: number) {
    const ciclo = await this.ciclo(id);
    const [evaluados, asignaciones, objetivos, empleados] = await Promise.all([
      this.evaluadosDe(id),
      this.asignacionesDe(id),
      this.objetivosDe(id),
      this.empleados(),
    ]);
    const porId = new Map(empleados.map((e: any) => [Number(e.id), e]));
    const filas = evaluados.map((ev: any) => {
      const r = this.informe(ciclo, Number(ev.empleado_id), asignaciones, objetivos, empleados);
      return {
        empleado: this.fichaPublica(porId.get(Number(ev.empleado_id))) || { id: Number(ev.empleado_id), nombre: `#${ev.empleado_id}` },
        porcentaje_final: r.porcentaje_final,
        puntaje_final: r.puntaje_final,
        nivel: r.nivel,
        puntaje_competencias: r.puntaje_competencias,
        puntaje_auto: r.puntaje_auto,
        puntaje_otros: r.puntaje_otros,
        porcentaje_objetivos: r.porcentaje_objetivos,
        objetivos: { total: r.objetivos.total, medidos: r.objetivos.medidos },
        respuestas: { total: r.respuestas.total, enviadas: r.respuestas.enviadas },
        competencias: Object.fromEntries(r.competencias.map((c) => [c.id, c.promedio])),
        acuse_at: ev.acuse_at,
      };
    });
    const promedios: Record<string, number | null> = {};
    for (const c of ciclo.config.competencias) {
      const xs = filas.map((f) => f.competencias[c.id]).filter((x): x is number => x !== null && x !== undefined);
      promedios[c.id] = xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2)) : null;
    }
    const finales = filas.map((f) => f.porcentaje_final).filter((x): x is number => x !== null);
    return {
      ciclo: { id: ciclo.id, nombre: ciclo.nombre, periodo: ciclo.periodo, estado: ciclo.estado },
      escala: ciclo.config.escala,
      niveles: ciclo.config.niveles,
      competencias: ciclo.config.competencias.map((c) => ({ id: c.id, nombre: c.nombre, categoria: c.categoria })),
      filas: filas.sort((a, b) => (b.porcentaje_final ?? -1) - (a.porcentaje_final ?? -1) || a.empleado.nombre.localeCompare(b.empleado.nombre)),
      promedios,
      promedio_final: finales.length ? Number((finales.reduce((s, x) => s + x, 0) / finales.length).toFixed(1)) : null,
    };
  }

  // Informe individual. Lo usan el panel, el propio evaluado y su jefatura.
  async resultadoDe(cicloId: number, empleadoId: number) {
    const ciclo = await this.ciclo(cicloId);
    const [evaluados, asignaciones, objetivos, empleados] = await Promise.all([
      this.evaluadosDe(cicloId),
      this.asignacionesDe(cicloId),
      this.objetivosDe(cicloId, empleadoId),
      this.empleados(),
    ]);
    const fila = evaluados.find((e: any) => Number(e.empleado_id) === empleadoId);
    if (!fila) throw new NotFoundException('Esa persona no fue evaluada en este ciclo.');
    const empleado = empleados.find((e: any) => Number(e.id) === empleadoId);
    return {
      ciclo: {
        id: ciclo.id,
        nombre: ciclo.nombre,
        periodo: ciclo.periodo,
        estado: ciclo.estado,
        fecha_inicio: ciclo.fecha_inicio,
        fecha_cierre: ciclo.fecha_cierre,
        publicado_at: ciclo.publicado_at,
      },
      empleado: this.fichaPublica(empleado) || { id: empleadoId, nombre: `#${empleadoId}` },
      resultado: this.informe(ciclo, empleadoId, asignaciones, objetivos, empleados),
      cierre: {
        id: fila.id,
        retro_rrhh: fila.retro_rrhh,
        plan_desarrollo: Array.isArray(fila.plan_desarrollo) ? fila.plan_desarrollo : [],
        acuse_at: fila.acuse_at,
        comentario_evaluado: fila.comentario_evaluado,
      },
    };
  }

  // Retroalimentación de cierre y plan de desarrollo (los escribe RR.HH.).
  async guardarCierre(cicloId: number, empleadoId: number, body: any) {
    const plan = (Array.isArray(body?.plan_desarrollo) ? body.plan_desarrollo : [])
      .map((p: any) => ({
        accion: texto(p?.accion, 400),
        plazo: p?.plazo ? String(p.plazo).slice(0, 10) : null,
        responsable: texto(p?.responsable, 120),
        estado: ['pendiente', 'en_curso', 'cumplida'].includes(p?.estado) ? p.estado : 'pendiente',
      }))
      .filter((p: any) => p.accion)
      .slice(0, 20);
    const { data, error } = await this.db
      .from('rrhh_e360_evaluados')
      .update({ retro_rrhh: texto(body?.retro_rrhh, 6000), plan_desarrollo: plan, updated_at: new Date().toISOString() })
      .eq('ciclo_id', cicloId)
      .eq('empleado_id', empleadoId)
      .select()
      .maybeSingle();
    if (error) this.error(error);
    if (!data) throw new NotFoundException('Esa persona no fue evaluada en este ciclo.');
    return data;
  }

  // ==========================================================================
  // PORTAL DEL TRABAJADOR (solo lo propio)
  // ==========================================================================
  async misDatos(empleado: any) {
    const yo = Number(empleado.id);
    const [mias, comoEvaluado] = await Promise.all([
      this.db
        .from('rrhh_e360_asignaciones')
        .select('id, ciclo_id, evaluado_id, relacion, estado, respuestas, enviada_at')
        .eq('evaluador_id', yo)
        .range(0, 999),
      this.db.from('rrhh_e360_evaluados').select('ciclo_id, acuse_at').eq('empleado_id', yo),
    ]);
    if (mias.error) this.error(mias.error);
    if (comoEvaluado.error) this.error(comoEvaluado.error);

    // Equipo directo: sus ciclos pueden no ser los mismos de la jefatura.
    const empleados = await this.empleados();
    const miCorreo = correo(empleado.email);
    const reportes = miCorreo ? empleados.filter((e: any) => correo(e.jefatura_email) === miCorreo) : [];
    let delEquipo: any[] = [];
    if (reportes.length) {
      const { data, error } = await this.db
        .from('rrhh_e360_evaluados')
        .select('ciclo_id, empleado_id')
        .in('empleado_id', reportes.map((r: any) => r.id));
      if (error) this.error(error);
      delEquipo = data || [];
    }

    const cicloIds = [
      ...new Set(
        [...(mias.data || []), ...(comoEvaluado.data || []), ...delEquipo].map((x: any) => Number(x.ciclo_id)),
      ),
    ];
    if (!cicloIds.length) return { formularios: [], informes: [], objetivos: [], equipo: [] };

    const [ciclosRes, objetivosRes] = await Promise.all([
      this.db.from('rrhh_e360_ciclos').select('*').in('id', cicloIds),
      this.db.from('rrhh_e360_objetivos').select('*').eq('empleado_id', yo).in('ciclo_id', cicloIds).order('orden').order('id'),
    ]);
    if (ciclosRes.error) this.error(ciclosRes.error);
    if (objetivosRes.error) this.error(objetivosRes.error);
    const ciclos = new Map<number, any>(
      (ciclosRes.data || []).map((c: any) => [Number(c.id), { ...c, config: normalizarConfig(c.config) }]),
    );
    const porId = new Map(empleados.map((e: any) => [Number(e.id), e]));
    const resumenCiclo = (c: any) => ({
      id: c.id,
      nombre: c.nombre,
      periodo: c.periodo,
      estado: c.estado,
      fecha_cierre: c.fecha_cierre,
      anonimo: c.config.anonimo,
    });

    // Formularios: los de ciclos en curso (para responder) y el historial.
    const formularios = (mias.data || [])
      .map((a: any) => {
        const c = ciclos.get(Number(a.ciclo_id));
        if (!c || c.estado === 'borrador') return null;
        const total = competenciasPara(c.config, a.relacion).length;
        const respondidas = Object.values(a.respuestas || {}).filter(
          (r: any) => r && (r.puntaje != null || r.na),
        ).length;
        return {
          id: a.id,
          ciclo: resumenCiclo(c),
          evaluado: this.fichaPublica(porId.get(Number(a.evaluado_id))),
          relacion: a.relacion,
          estado: a.estado,
          enviada_at: a.enviada_at,
          avance: { respondidas: Math.min(respondidas, total), total },
          abierta: c.estado === 'activo' && a.estado !== 'enviada',
        };
      })
      .filter(Boolean);

    const informes = (comoEvaluado.data || [])
      .map((e: any) => ({ ciclo: ciclos.get(Number(e.ciclo_id)), acuse_at: e.acuse_at }))
      .filter((x: any) => x.ciclo && x.ciclo.estado === 'publicado')
      .map((x: any) => ({ ciclo: resumenCiclo(x.ciclo), publicado_at: x.ciclo.publicado_at, acuse_at: x.acuse_at }));

    const objetivos = (objetivosRes.data || [])
      .map((o: any) => ({ o, c: ciclos.get(Number(o.ciclo_id)) }))
      .filter((x: any) => x.c && x.c.estado !== 'borrador')
      .map((x: any) => ({ ...x.o, cumplimiento: cumplimientoObjetivo(x.o), ciclo: resumenCiclo(x.c) }));

    // Informes del equipo: solo si el ciclo lo permite y está publicado.
    const equipo = delEquipo
      .map((x: any) => ({ fila: x, c: ciclos.get(Number(x.ciclo_id)) }))
      .filter((x: any) => x.c && x.c.estado === 'publicado' && x.c.config.jefatura_ve_resultados)
      .map((x: any) => ({ ciclo: resumenCiclo(x.c), empleado: this.fichaPublica(porId.get(Number(x.fila.empleado_id))) }));

    return { formularios, informes, objetivos, equipo };
  }

  private async miAsignacion(empleado: any, id: number) {
    const a = await this.asignacion(id);
    if (Number(a.evaluador_id) !== Number(empleado.id)) {
      throw new ForbiddenException('Esa evaluación no te corresponde.');
    }
    const ciclo = await this.ciclo(Number(a.ciclo_id));
    if (ciclo.estado === 'borrador') throw new ForbiddenException('El ciclo todavía no comienza.');
    return { a, ciclo };
  }

  async miFormulario(empleado: any, id: number) {
    const { a, ciclo } = await this.miAsignacion(empleado, id);
    const { data: evaluado } = await this.db
      .from('rrhh_empleados')
      .select(CAMPOS_EMPLEADO)
      .eq('id', a.evaluado_id)
      .maybeSingle();
    return {
      id: a.id,
      relacion: a.relacion,
      estado: a.estado,
      enviada_at: a.enviada_at,
      editable: ciclo.estado === 'activo' && a.estado !== 'enviada',
      respuestas: a.respuestas || {},
      abiertas: a.abiertas || {},
      evaluado: this.fichaPublica(evaluado),
      ciclo: {
        id: ciclo.id,
        nombre: ciclo.nombre,
        periodo: ciclo.periodo,
        estado: ciclo.estado,
        instrucciones: ciclo.instrucciones,
        fecha_cierre: ciclo.fecha_cierre,
        anonimo: ciclo.config.anonimo,
        min_anonimato: ciclo.config.min_anonimato,
        comentario_obligatorio_hasta: ciclo.config.comentario_obligatorio_hasta,
      },
      escala: ciclo.config.escala,
      competencias: competenciasPara(ciclo.config, a.relacion),
      preguntas: ciclo.config.preguntas,
    };
  }

  async guardarMiFormulario(empleado: any, id: number, body: any) {
    const { a, ciclo } = await this.miAsignacion(empleado, id);
    if (ciclo.estado !== 'activo') throw new BadRequestException('El ciclo ya cerró: no se reciben más respuestas.');
    if (a.estado === 'enviada') {
      throw new BadRequestException('Ya enviaste esta evaluación. Si necesitas corregirla, pídele a RR.HH. que la reabra.');
    }
    const limpio = sanearRespuestas(ciclo.config, a.relacion, body?.respuestas, body?.abiertas);
    const enviar = Boolean(body?.enviar);
    if (enviar) {
      const faltan = validarFormulario(ciclo.config, a.relacion, limpio.respuestas, limpio.abiertas);
      if (faltan.length) {
        throw new BadRequestException(
          faltan.length === 1 ? faltan[0] : `${faltan[0]} (y ${faltan.length - 1} pendiente${faltan.length === 2 ? '' : 's'} más)`,
        );
      }
    }
    const ahora = new Date().toISOString();
    const { error } = await this.db
      .from('rrhh_e360_asignaciones')
      .update({
        respuestas: limpio.respuestas,
        abiertas: limpio.abiertas,
        estado: enviar ? 'enviada' : 'en_progreso',
        puntaje: enviar ? puntajeFormulario(ciclo.config, a.relacion, limpio.respuestas) : null,
        iniciada_at: a.iniciada_at || ahora,
        enviada_at: enviar ? ahora : null,
        updated_at: ahora,
      })
      .eq('id', id);
    if (error) this.error(error);
    return { ok: true, estado: enviar ? 'enviada' : 'en_progreso' };
  }

  // Informe propio: solo con el ciclo publicado.
  async miResultado(empleado: any, cicloId: number) {
    const informe = await this.resultadoDe(cicloId, Number(empleado.id));
    if (informe.ciclo.estado !== 'publicado') {
      throw new ForbiddenException('Los resultados de este ciclo todavía no se publican.');
    }
    return informe;
  }

  // Informe de alguien del equipo: solo su jefatura, y si el ciclo lo permite.
  async resultadoDeMiEquipo(empleado: any, cicloId: number, empleadoId: number) {
    const ciclo = await this.ciclo(cicloId);
    if (ciclo.estado !== 'publicado' || !ciclo.config.jefatura_ve_resultados) {
      throw new ForbiddenException('Este ciclo no comparte los informes con las jefaturas.');
    }
    const { data: reporte } = await this.db
      .from('rrhh_empleados')
      .select('id, jefatura_email')
      .eq('id', empleadoId)
      .maybeSingle();
    if (!reporte || !correo(empleado.email) || correo(reporte.jefatura_email) !== correo(empleado.email)) {
      throw new ForbiddenException('Solo puedes ver los informes de tu equipo directo.');
    }
    return this.resultadoDe(cicloId, empleadoId);
  }

  // El evaluado deja constancia de que revisó su informe.
  async acusar(empleado: any, cicloId: number, comentario?: string) {
    await this.miResultado(empleado, cicloId);
    const { error } = await this.db
      .from('rrhh_e360_evaluados')
      .update({
        acuse_at: new Date().toISOString(),
        comentario_evaluado: texto(comentario, 4000),
        updated_at: new Date().toISOString(),
      })
      .eq('ciclo_id', cicloId)
      .eq('empleado_id', empleado.id);
    if (error) this.error(error);
    return { ok: true };
  }
}
