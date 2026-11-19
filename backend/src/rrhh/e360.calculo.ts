/* ============================================================================
   Evaluación 360° — lógica pura (sin base de datos)
   ----------------------------------------------------------------------------
   Todo lo que se calcula vive aquí para poder probarlo solo:
   · normalizarConfig     → sanea el instrumento del ciclo (competencias,
     escala, pesos por relación, niveles, anonimato).
   · sugerirAsignaciones  → arma la matriz «quién evalúa a quién» desde la
     jefatura y el área de cada ficha.
   · puntajeFormulario / validarFormulario → un formulario respondido.
   · cumplimientoObjetivo / resumenObjetivos → objetivos con meta y valor real.
   · calcularResultado    → el informe del evaluado: promedio por competencia
     y por tipo de evaluador, brechas contra la autoevaluación, nota final y
     comentarios, respetando el anonimato.

   La relación siempre se lee DESDE EL EVALUADO: «jefatura» = lo evalúa su
   jefatura; «reporte» = lo evalúa alguien de su equipo.
============================================================================ */

export const RELACIONES = ['auto', 'jefatura', 'par', 'reporte', 'otro'] as const;
export type Relacion = (typeof RELACIONES)[number];

export const ETIQUETA_RELACION: Record<Relacion | 'combinado', string> = {
  auto: 'Autoevaluación',
  jefatura: 'Jefatura',
  par: 'Pares',
  reporte: 'Equipo a cargo',
  otro: 'Otros evaluadores',
  combinado: 'Pares y equipo',
};

// Relaciones cuya identidad se protege cuando el ciclo es anónimo. La
// autoevaluación y la jefatura son identificables por definición.
const RELACIONES_ANONIMAS: Relacion[] = ['par', 'reporte', 'otro'];

export interface Competencia {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  peso: number;
  // null = la responden todos; si no, solo estas relaciones.
  relaciones: Relacion[] | null;
}

export interface Pregunta {
  id: string;
  texto: string;
  obligatoria: boolean;
}

export interface Nivel {
  desde: number; // porcentaje mínimo (0–100)
  etiqueta: string;
}

export interface ConfigCiclo {
  escala: { max: number; etiquetas: string[]; permitir_na: boolean };
  competencias: Competencia[];
  preguntas: Pregunta[];
  pesos_relacion: Record<Relacion, number>;
  peso_competencias: number;
  peso_objetivos: number;
  anonimo: boolean;
  min_anonimato: number;
  comentario_obligatorio_hasta: number; // nota ≤ este valor exige comentario (0 = nunca)
  jefatura_ve_resultados: boolean;
  max_pares: number;
  niveles: Nivel[];
}

const ETIQUETAS_ESCALA: Record<number, string[]> = {
  3: ['Bajo lo esperado', 'Cumple lo esperado', 'Sobre lo esperado'],
  4: ['Insuficiente', 'En desarrollo', 'Cumple lo esperado', 'Destacado'],
  5: ['Insuficiente', 'En desarrollo', 'Cumple lo esperado', 'Destacado', 'Sobresaliente'],
};

export const NIVELES_DEFECTO: Nivel[] = [
  { desde: 0, etiqueta: 'Insuficiente' },
  { desde: 50, etiqueta: 'En desarrollo' },
  { desde: 65, etiqueta: 'Cumple lo esperado' },
  { desde: 80, etiqueta: 'Destacado' },
  { desde: 90, etiqueta: 'Sobresaliente' },
];

export const PESOS_RELACION_DEFECTO: Record<Relacion, number> = {
  auto: 10,
  jefatura: 35,
  par: 25,
  reporte: 20,
  otro: 10,
};

// Tope de cumplimiento de un objetivo: sobrecumplir cuenta, pero con límite.
export const TOPE_OBJETIVO = 120;

const num = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const txt = (v: any, max = 400): string => String(v ?? '').trim().slice(0, max);
const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const redondear = (v: number, dec = 2) => Number(v.toFixed(dec));
const esRelacion = (v: any): v is Relacion => (RELACIONES as readonly string[]).includes(v);

export function etiquetasEscala(max: number): string[] {
  if (ETIQUETAS_ESCALA[max]) return [...ETIQUETAS_ESCALA[max]];
  return Array.from({ length: max }, (_, i) => (i === 0 ? 'Muy bajo' : i === max - 1 ? 'Excelente' : String(i + 1)));
}

// Asigna un id estable a cada elemento que no lo traiga, sin repetir.
function conIds<T extends { id?: any }>(items: T[], prefijo: string): (T & { id: string })[] {
  const usados = new Set<string>();
  for (const it of items) {
    const id = txt(it?.id, 40);
    if (id && !usados.has(id)) usados.add(id);
  }
  const vistos = new Set<string>();
  let n = 1;
  return items.map((it) => {
    let id = txt(it?.id, 40);
    if (!id || vistos.has(id)) {
      while (usados.has(`${prefijo}${n}`)) n += 1;
      id = `${prefijo}${n}`;
      usados.add(id);
    }
    vistos.add(id);
    return { ...it, id };
  });
}

export function normalizarConfig(raw: any): ConfigCiclo {
  const r = raw && typeof raw === 'object' ? raw : {};

  const max = acotar(Math.round(num(r?.escala?.max, 5)), 3, 10);
  const etiquetasBase = etiquetasEscala(max);
  const etiquetasIn: any[] = Array.isArray(r?.escala?.etiquetas) ? r.escala.etiquetas : [];
  const etiquetas = etiquetasBase.map((def, i) => txt(etiquetasIn[i], 60) || def);

  const competencias = conIds(
    (Array.isArray(r?.competencias) ? r.competencias : [])
      .filter((c: any) => txt(c?.nombre))
      .slice(0, 40),
    'c',
  ).map((c: any): Competencia => {
    const rels = Array.isArray(c?.relaciones) ? c.relaciones.filter(esRelacion) : [];
    return {
      id: c.id,
      nombre: txt(c.nombre, 120),
      descripcion: txt(c.descripcion, 600),
      categoria: txt(c.categoria, 80),
      peso: acotar(num(c.peso, 1), 0, 100) || 1,
      relaciones: rels.length && rels.length < RELACIONES.length ? rels : null,
    };
  });

  const preguntas = conIds(
    (Array.isArray(r?.preguntas) ? r.preguntas : []).filter((p: any) => txt(p?.texto)).slice(0, 12),
    'p',
  ).map((p: any): Pregunta => ({ id: p.id, texto: txt(p.texto, 300), obligatoria: Boolean(p.obligatoria) }));

  const pesos = {} as Record<Relacion, number>;
  for (const rel of RELACIONES) {
    const v = r?.pesos_relacion?.[rel];
    pesos[rel] = v === undefined || v === null || v === '' ? PESOS_RELACION_DEFECTO[rel] : acotar(num(v), 0, 100);
  }

  let pesoComp = r?.peso_competencias === undefined ? 70 : acotar(num(r.peso_competencias), 0, 100);
  let pesoObj = r?.peso_objetivos === undefined ? 30 : acotar(num(r.peso_objetivos), 0, 100);
  if (pesoComp + pesoObj <= 0) {
    pesoComp = 100;
    pesoObj = 0;
  }

  const nivelesIn: any[] = Array.isArray(r?.niveles) ? r.niveles : [];
  let niveles = nivelesIn
    .filter((n) => txt(n?.etiqueta))
    .map((n) => ({ desde: acotar(num(n.desde), 0, 100), etiqueta: txt(n.etiqueta, 60) }))
    .sort((a, b) => a.desde - b.desde)
    .slice(0, 8);
  if (!niveles.length) niveles = NIVELES_DEFECTO.map((n) => ({ ...n }));
  niveles[0].desde = 0;

  return {
    escala: { max, etiquetas, permitir_na: r?.escala?.permitir_na !== false },
    competencias,
    preguntas,
    pesos_relacion: pesos,
    peso_competencias: pesoComp,
    peso_objetivos: pesoObj,
    anonimo: r?.anonimo !== false,
    min_anonimato: acotar(Math.round(num(r?.min_anonimato, 3)), 1, 6),
    comentario_obligatorio_hasta: acotar(Math.round(num(r?.comentario_obligatorio_hasta, 0)), 0, max),
    jefatura_ve_resultados: Boolean(r?.jefatura_ve_resultados),
    max_pares: acotar(Math.round(num(r?.max_pares, 3)), 0, 10),
    niveles,
  };
}

export function competenciasPara(config: ConfigCiclo, relacion: Relacion): Competencia[] {
  return config.competencias.filter((c) => !c.relaciones || c.relaciones.includes(relacion));
}

// Puntaje válido de una respuesta: entero dentro de la escala, o null (no aplica / sin responder).
function puntajeDe(config: ConfigCiclo, respuesta: any): number | null {
  const p = respuesta?.puntaje;
  if (p === null || p === undefined || p === '') return null;
  const n = Math.round(num(p, NaN));
  if (!Number.isFinite(n) || n < 1 || n > config.escala.max) return null;
  return n;
}

// Deja solo lo que el instrumento admite: competencias que le tocan a esa
// relación, puntajes dentro de la escala y textos acotados.
export function sanearRespuestas(config: ConfigCiclo, relacion: Relacion, respuestas: any, abiertas: any) {
  const r: Record<string, { puntaje: number | null; na: boolean; comentario: string }> = {};
  for (const c of competenciasPara(config, relacion)) {
    const e = respuestas?.[c.id];
    if (!e) continue;
    const puntaje = puntajeDe(config, e);
    const na = puntaje === null && Boolean(e.na) && config.escala.permitir_na;
    const comentario = txt(e.comentario, 2000);
    if (puntaje === null && !na && !comentario) continue;
    r[c.id] = { puntaje, na, comentario };
  }
  const a: Record<string, string> = {};
  for (const p of config.preguntas) {
    const t = txt(abiertas?.[p.id], 4000);
    if (t) a[p.id] = t;
  }
  return { respuestas: r, abiertas: a };
}

// Promedio ponderado (por peso de competencia) de un formulario.
export function puntajeFormulario(config: ConfigCiclo, relacion: Relacion, respuestas: any): number | null {
  let suma = 0;
  let pesos = 0;
  for (const c of competenciasPara(config, relacion)) {
    const p = puntajeDe(config, respuestas?.[c.id]);
    if (p === null) continue;
    suma += p * c.peso;
    pesos += c.peso;
  }
  return pesos > 0 ? redondear(suma / pesos) : null;
}

// Lo que falta para poder enviar el formulario (vacío = se puede enviar).
export function validarFormulario(config: ConfigCiclo, relacion: Relacion, respuestas: any, abiertas: any): string[] {
  const faltan: string[] = [];
  for (const c of competenciasPara(config, relacion)) {
    const e = respuestas?.[c.id];
    const p = puntajeDe(config, e);
    const na = p === null && Boolean(e?.na) && config.escala.permitir_na;
    if (p === null && !na) {
      faltan.push(`Falta evaluar «${c.nombre}».`);
      continue;
    }
    if (p !== null && p <= config.comentario_obligatorio_hasta && !txt(e?.comentario)) {
      faltan.push(`«${c.nombre}»: una nota de ${p} necesita un comentario que la explique.`);
    }
  }
  for (const q of config.preguntas) {
    if (q.obligatoria && !txt(abiertas?.[q.id])) faltan.push(`Falta responder «${q.texto}».`);
  }
  return faltan;
}

export function nivelDe(config: ConfigCiclo, porcentaje: number | null): (Nivel & { indice: number; total: number }) | null {
  if (porcentaje === null || !Number.isFinite(porcentaje)) return null;
  let indice = 0;
  config.niveles.forEach((n, i) => {
    if (porcentaje >= n.desde) indice = i;
  });
  return { ...config.niveles[indice], indice, total: config.niveles.length };
}

// ── Objetivos ────────────────────────────────────────────────────────────────

export interface Objetivo {
  id?: number;
  titulo?: string;
  unidad?: string; // porcentaje | numero | monto | si_no
  sentido?: string; // mayor | menor
  meta?: number | null;
  valor_real?: number | null;
  peso?: number;
  [k: string]: any;
}

// Porcentaje de cumplimiento (0–TOPE_OBJETIVO) o null si todavía no se mide.
export function cumplimientoObjetivo(o: Objetivo): number | null {
  if (o?.valor_real === null || o?.valor_real === undefined || (o.valor_real as any) === '') return null;
  const real = num(o.valor_real, NaN);
  if (!Number.isFinite(real)) return null;
  if (o.unidad === 'si_no') return real >= 1 ? 100 : 0;
  const meta = num(o.meta, NaN);
  if (!Number.isFinite(meta)) return null;
  let pct: number;
  if (o.sentido === 'menor') {
    // Menos es mejor (reclamos, días de atraso…): llegar a 0 es el tope.
    if (real <= 0) pct = meta >= 0 ? TOPE_OBJETIVO : 0;
    else if (meta <= 0) pct = 0;
    else pct = (meta / real) * 100;
  } else {
    if (meta <= 0) return null;
    pct = (real / meta) * 100;
  }
  return redondear(acotar(pct, 0, TOPE_OBJETIVO), 1);
}

export function resumenObjetivos(objetivos: Objetivo[]) {
  const items = (objetivos || []).map((o) => ({ ...o, cumplimiento: cumplimientoObjetivo(o) }));
  const medidos = items.filter((o) => o.cumplimiento !== null);
  const pesoTotal = medidos.reduce((s, o) => s + (num(o.peso, 1) || 1), 0);
  const cumplimiento =
    medidos.length && pesoTotal > 0
      ? redondear(medidos.reduce((s, o) => s + (o.cumplimiento as number) * (num(o.peso, 1) || 1), 0) / pesoTotal, 1)
      : null;
  return { items, total: items.length, medidos: medidos.length, cumplimiento };
}

// ── Matriz de evaluadores ────────────────────────────────────────────────────

export interface EmpleadoBase {
  id: number;
  email?: string | null;
  jefatura_email?: string | null;
  area?: string | null;
  estado?: string | null;
}

export interface AsignacionSugerida {
  evaluado_id: number;
  evaluador_id: number;
  relacion: Relacion;
}

export interface OpcionesMatriz {
  auto?: boolean;
  jefatura?: boolean;
  pares?: boolean;
  reportes?: boolean;
  max_pares?: number;
}

const correo = (v: any) => String(v || '').trim().toLowerCase();

/* Sugiere la matriz desde las fichas:
   · jefatura → la persona cuyo correo es el `jefatura_email` del evaluado.
   · reporte  → quienes tienen al evaluado como jefatura.
   · par      → quienes comparten jefatura (o área, si la ficha no tiene
     jefatura), hasta `max_pares`, repartiendo la carga entre evaluadores.
   Solo evalúan fichas activas con correo (lo necesitan para entrar). */
export function sugerirAsignaciones(
  empleados: EmpleadoBase[],
  evaluadosIds: number[],
  opciones: OpcionesMatriz = {},
): AsignacionSugerida[] {
  const op = { auto: true, jefatura: true, pares: true, reportes: true, max_pares: 3, ...opciones };
  const puedeEvaluar = (e: EmpleadoBase) => Boolean(correo(e.email)) && (e.estado || 'activo') === 'activo';
  const porId = new Map(empleados.map((e) => [Number(e.id), e]));
  const porCorreo = new Map(empleados.filter((e) => correo(e.email)).map((e) => [correo(e.email), e]));
  const carga = new Map<number, number>();
  // A igual carga se elige al «siguiente» en la lista (en círculo), no siempre
  // al de id más bajo: así los pares se reparten parejo.
  const posicion = new Map([...empleados].sort((a, b) => Number(a.id) - Number(b.id)).map((e, i) => [Number(e.id), i]));
  const giro = (x: EmpleadoBase, desdeId: number) =>
    ((posicion.get(Number(x.id)) || 0) - (posicion.get(desdeId) || 0) + empleados.length) % empleados.length;
  const salida: AsignacionSugerida[] = [];
  const ids = [...new Set(evaluadosIds.map(Number))].sort((a, b) => a - b);

  for (const id of ids) {
    const e = porId.get(id);
    if (!e) continue;
    const jefe = correo(e.jefatura_email) ? porCorreo.get(correo(e.jefatura_email)) : undefined;
    const reportes = correo(e.email)
      ? empleados.filter((x) => Number(x.id) !== id && correo(x.jefatura_email) === correo(e.email))
      : [];

    if (op.auto && puedeEvaluar(e)) salida.push({ evaluado_id: id, evaluador_id: id, relacion: 'auto' });
    if (op.jefatura && jefe && Number(jefe.id) !== id && puedeEvaluar(jefe)) {
      salida.push({ evaluado_id: id, evaluador_id: Number(jefe.id), relacion: 'jefatura' });
    }
    if (op.reportes) {
      for (const r of reportes.filter(puedeEvaluar)) {
        salida.push({ evaluado_id: id, evaluador_id: Number(r.id), relacion: 'reporte' });
      }
    }
    if (op.pares && op.max_pares > 0) {
      const excluidos = new Set<number>([id, ...(jefe ? [Number(jefe.id)] : []), ...reportes.map((r) => Number(r.id))]);
      const mismoJefe = correo(e.jefatura_email)
        ? empleados.filter((x) => correo(x.jefatura_email) === correo(e.jefatura_email))
        : [];
      const mismaArea = !correo(e.jefatura_email) && txt(e.area)
        ? empleados.filter((x) => txt(x.area).toLowerCase() === txt(e.area).toLowerCase())
        : [];
      const candidatos = (mismoJefe.length ? mismoJefe : mismaArea)
        .filter((x) => !excluidos.has(Number(x.id)) && puedeEvaluar(x))
        .sort((a, b) => (carga.get(Number(a.id)) || 0) - (carga.get(Number(b.id)) || 0) || giro(a, id) - giro(b, id))
        .slice(0, op.max_pares);
      for (const c of candidatos) {
        carga.set(Number(c.id), (carga.get(Number(c.id)) || 0) + 1);
        salida.push({ evaluado_id: id, evaluador_id: Number(c.id), relacion: 'par' });
      }
    }
  }
  return salida;
}

// ── Resultado del evaluado ───────────────────────────────────────────────────

export interface AsignacionRespondida {
  id?: number;
  evaluador_id: number;
  relacion: Relacion | string;
  estado: string;
  respuestas?: any;
  abiertas?: any;
}

type ClaveGrupo = Relacion | 'combinado';

interface Grupo {
  clave: ClaveGrupo;
  etiqueta: string;
  relaciones: Relacion[];
  n: number;
  // false = hay respuestas pero son tan pocas que mostrarlas delataría a su autor.
  visible: boolean;
  promedio: number | null;
}

const promedio = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Orden estable que no depende de quién respondió primero: evita que el orden
// de los comentarios delate al autor.
function mezclaEstable<T>(items: T[], clave: (x: T) => string): T[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  return [...items].sort((a, b) => hash(clave(a)) - hash(clave(b)) || clave(a).localeCompare(clave(b)));
}

export function calcularResultado(
  configRaw: any,
  asignaciones: AsignacionRespondida[],
  objetivos: Objetivo[] = [],
  opciones: { nombres?: Map<number, string> } = {},
) {
  const config = normalizarConfig(configRaw);
  const max = config.escala.max;
  const todas = (asignaciones || []).filter((a) => esRelacion(a.relacion)) as (AsignacionRespondida & {
    relacion: Relacion;
  })[];
  const enviadas = todas.filter((a) => a.estado === 'enviada');

  const conteo = {} as Record<Relacion, { total: number; enviadas: number }>;
  for (const rel of RELACIONES) {
    conteo[rel] = {
      total: todas.filter((a) => a.relacion === rel).length,
      enviadas: enviadas.filter((a) => a.relacion === rel).length,
    };
  }

  // ── Grupos visibles según el anonimato ────────────────────────────────────
  const grupoDe = new Map<Relacion, ClaveGrupo>();
  const grupos: Grupo[] = [];
  const agregar = (clave: ClaveGrupo, relaciones: Relacion[], visible: boolean, etiqueta?: string) => {
    const n = relaciones.reduce((s, r) => s + conteo[r].enviadas, 0);
    if (!n) return;
    relaciones.forEach((r) => grupoDe.set(r, clave));
    grupos.push({ clave, etiqueta: etiqueta || ETIQUETA_RELACION[clave], relaciones, n, visible, promedio: null });
  };
  agregar('auto', ['auto'], true);
  agregar('jefatura', ['jefatura'], true);
  const anonimas = RELACIONES_ANONIMAS.filter((r) => conteo[r].enviadas > 0);
  const todasAlcanzan = anonimas.every((r) => conteo[r].enviadas >= config.min_anonimato);
  if (!config.anonimo || todasAlcanzan) {
    anonimas.forEach((r) => agregar(r, [r], true));
  } else if (anonimas.length === 1) {
    // Un solo grupo anónimo y no alcanza el mínimo: no se desglosa (pero sí
    // cuenta en la nota).
    agregar(anonimas[0], anonimas, false);
  } else {
    // Algún grupo es demasiado chico: se funden todos los anónimos en uno, y
    // si ni así alcanza el mínimo, tampoco se desglosa.
    const n = anonimas.reduce((s, r) => s + conteo[r].enviadas, 0);
    agregar('combinado', anonimas, n >= config.min_anonimato, anonimas.map((r) => ETIQUETA_RELACION[r]).join(' + '));
  }

  const puntajes = (c: Competencia, rels: Relacion[]) =>
    enviadas
      .filter((a) => rels.includes(a.relacion) && (!c.relaciones || c.relaciones.includes(a.relacion)))
      .map((a) => puntajeDe(config, a.respuestas?.[c.id]))
      .filter((p): p is number => p !== null);

  // Promedio de una competencia ponderando cada relación por su peso
  // (renormalizado sobre las relaciones que efectivamente respondieron).
  const ponderado = (c: Competencia, rels: Relacion[]) => {
    let suma = 0;
    let pesos = 0;
    for (const rel of rels) {
      const p = promedio(puntajes(c, [rel]));
      const w = config.pesos_relacion[rel];
      if (p === null || w <= 0) continue;
      suma += p * w;
      pesos += w;
    }
    return pesos > 0 ? suma / pesos : null;
  };

  const otrasRelaciones = RELACIONES.filter((r) => r !== 'auto');
  const umbralBrecha = 0.25 * (max - 1);

  const competencias = config.competencias.map((c) => {
    const general = ponderado(c, [...RELACIONES]);
    const auto = promedio(puntajes(c, ['auto']));
    const otros = ponderado(c, otrasRelaciones);
    const porGrupo: Record<string, number | null> = {};
    for (const g of grupos) {
      const p = g.visible ? promedio(puntajes(c, g.relaciones)) : null;
      porGrupo[g.clave] = p === null ? null : redondear(p);
    }
    return {
      id: c.id,
      nombre: c.nombre,
      descripcion: c.descripcion,
      categoria: c.categoria,
      peso: c.peso,
      promedio: general === null ? null : redondear(general),
      auto: auto === null ? null : redondear(auto),
      otros: otros === null ? null : redondear(otros),
      brecha: auto !== null && otros !== null ? redondear(auto - otros) : null,
      por_grupo: porGrupo,
      n: puntajes(c, [...RELACIONES]).length,
    };
  });

  const promedioPonderado = (campo: 'promedio' | 'auto' | 'otros') => {
    const con = competencias.filter((c) => c[campo] !== null);
    const pesos = con.reduce((s, c) => s + c.peso, 0);
    return con.length && pesos > 0 ? redondear(con.reduce((s, c) => s + (c[campo] as number) * c.peso, 0) / pesos) : null;
  };

  for (const g of grupos) {
    if (!g.visible) continue;
    const con = competencias.filter((c) => c.por_grupo[g.clave] !== null);
    const pesos = con.reduce((s, c) => s + c.peso, 0);
    g.promedio = con.length && pesos > 0
      ? redondear(con.reduce((s, c) => s + (c.por_grupo[g.clave] as number) * c.peso, 0) / pesos)
      : null;
  }

  const puntajeCompetencias = promedioPonderado('promedio');
  const pctCompetencias = puntajeCompetencias === null ? null : redondear((puntajeCompetencias / max) * 100, 1);

  const objs = resumenObjetivos(objetivos);
  const pctObjetivos = objs.cumplimiento === null ? null : Math.min(100, objs.cumplimiento);

  let pctFinal: number | null = null;
  const usaObjetivos = pctObjetivos !== null && config.peso_objetivos > 0;
  const usaCompetencias = pctCompetencias !== null && config.peso_competencias > 0;
  if (usaObjetivos && usaCompetencias) {
    pctFinal =
      ((pctCompetencias as number) * config.peso_competencias + (pctObjetivos as number) * config.peso_objetivos) /
      (config.peso_competencias + config.peso_objetivos);
  } else if (usaCompetencias) pctFinal = pctCompetencias;
  else if (usaObjetivos) pctFinal = pctObjetivos;
  else pctFinal = pctCompetencias ?? pctObjetivos;
  if (pctFinal !== null) pctFinal = redondear(pctFinal, 1);

  // Fortalezas y oportunidades según cómo lo ven los demás (o el promedio
  // general si solo hay autoevaluación).
  const base = competencias
    .map((c) => ({ id: c.id, nombre: c.nombre, valor: c.otros ?? c.promedio }))
    .filter((c): c is { id: string; nombre: string; valor: number } => c.valor !== null);
  const ordenadas = [...base].sort((a, b) => b.valor - a.valor);
  const cuantas = Math.min(3, Math.floor(ordenadas.length / 2));
  const fortalezas = ordenadas.slice(0, cuantas);
  const oportunidades = ordenadas.slice(ordenadas.length - cuantas).reverse();

  const conBrecha = competencias.filter((c) => c.brecha !== null);
  const puntosCiegos = conBrecha
    .filter((c) => (c.brecha as number) >= umbralBrecha)
    .sort((a, b) => (b.brecha as number) - (a.brecha as number))
    .map((c) => ({ id: c.id, nombre: c.nombre, brecha: c.brecha }));
  const fortalezasOcultas = conBrecha
    .filter((c) => (c.brecha as number) <= -umbralBrecha)
    .sort((a, b) => (a.brecha as number) - (b.brecha as number))
    .map((c) => ({ id: c.id, nombre: c.nombre, brecha: c.brecha }));

  // ── Comentarios ───────────────────────────────────────────────────────────
  const autorDe = (a: AsignacionRespondida & { relacion: Relacion }) =>
    !config.anonimo && a.relacion !== 'auto' ? opciones.nombres?.get(Number(a.evaluador_id)) || null : null;
  const grupoVisible = (rel: Relacion) => grupos.find((g) => g.clave === grupoDe.get(rel) && g.visible) || null;

  const comentarios: { competencia_id: string; grupo: string; etiqueta: string; texto: string; autor: string | null }[] = [];
  for (const c of config.competencias) {
    for (const a of enviadas) {
      const g = grupoVisible(a.relacion);
      const texto = txt(a.respuestas?.[c.id]?.comentario, 2000);
      if (!g || !texto) continue;
      comentarios.push({ competencia_id: c.id, grupo: g.clave, etiqueta: g.etiqueta, texto, autor: autorDe(a) });
    }
  }
  const abiertas = config.preguntas.map((q) => {
    const respuestas: { grupo: string; etiqueta: string; texto: string; autor: string | null }[] = [];
    for (const a of enviadas) {
      const g = grupoVisible(a.relacion);
      const texto = txt(a.abiertas?.[q.id], 4000);
      if (!g || !texto) continue;
      respuestas.push({ grupo: g.clave, etiqueta: g.etiqueta, texto, autor: autorDe(a) });
    }
    return { id: q.id, texto: q.texto, respuestas: mezclaEstable(respuestas, (r) => `${r.grupo}|${r.texto}`) };
  });

  const ocultas = grupos.filter((g) => !g.visible).reduce((s, g) => s + g.n, 0);

  return {
    escala: config.escala,
    anonimo: config.anonimo,
    min_anonimato: config.min_anonimato,
    pesos: { competencias: config.peso_competencias, objetivos: config.peso_objetivos, relacion: config.pesos_relacion },
    respuestas: {
      total: todas.length,
      enviadas: enviadas.length,
      por_relacion: conteo,
      protegidas: ocultas,
    },
    grupos: grupos.map((g) => ({ clave: g.clave, etiqueta: g.etiqueta, n: g.n, visible: g.visible, promedio: g.promedio })),
    competencias,
    puntaje_competencias: puntajeCompetencias,
    porcentaje_competencias: pctCompetencias,
    puntaje_auto: promedioPonderado('auto'),
    puntaje_otros: promedioPonderado('otros'),
    objetivos: objs,
    porcentaje_objetivos: pctObjetivos,
    porcentaje_final: pctFinal,
    puntaje_final: pctFinal === null ? null : redondear((pctFinal / 100) * max),
    nivel: nivelDe(config, pctFinal),
    fortalezas,
    oportunidades,
    puntos_ciegos: puntosCiegos,
    fortalezas_ocultas: fortalezasOcultas,
    comentarios: mezclaEstable(comentarios, (c) => `${c.competencia_id}|${c.grupo}|${c.texto}`),
    abiertas,
  };
}

export type ResultadoE360 = ReturnType<typeof calcularResultado>;
