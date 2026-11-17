/* ── Comunidad Amsodent: categorías y unión de fuentes (2026-11-17) ──────────
   Pedidos de Ariel:
     · «todos los clientes/personas en sorteo y evento se deben visualizar en
       Comunidad Amsodent»;
     · «todas las filas de Comunidad se deben categorizar: Estudiante, Clínica,
       Doctor Particular, Doctor Docente, Doctor Docente y Profesional Privado,
       Doctor Docente y Profesional Público, Cliente Rastreado».

   La lista de Comunidad es la UNIÓN, en vivo, de:
     · comunidad_registros   → el formulario del QR, las personas a las que se
                               les guardó una categoría y las clínicas rastreadas;
     · sorteo_participantes  → quienes participaron en un sorteo;
     · evento_inscripciones  → quienes se inscribieron a un evento.
   Una persona se reconoce por su correo: si figura en varias fuentes sale UNA
   fila con todas sus fuentes. Las clínicas rastreadas no se mezclan con
   personas (varias sucursales comparten correo).

   Toda fila tiene categoría: la guardada a mano o, si no hay, la que se deduce
   del origen (`categoria_auto: true`, para que se sepa que es una propuesta).

   Aquí solo está la lógica (sin base de datos) para poder probarla. La lista de
   categorías está espejada en src/lib/comunidad.js. */

export const CATEGORIAS_COMUNIDAD = [
  { clave: 'estudiante', nombre: 'Estudiante' },
  { clave: 'clinica', nombre: 'Clínica' },
  { clave: 'doctor_particular', nombre: 'Doctor Particular' },
  { clave: 'doctor_docente', nombre: 'Doctor Docente' },
  { clave: 'doctor_docente_privado', nombre: 'Doctor Docente y Profesional Privado' },
  { clave: 'doctor_docente_publico', nombre: 'Doctor Docente y Profesional Público' },
  { clave: 'cliente_rastreado', nombre: 'Cliente Rastreado' },
] as const;

export type CategoriaComunidad = (typeof CATEGORIAS_COMUNIDAD)[number]['clave'];
export type FuenteComunidad = 'comunidad' | 'sorteo' | 'evento' | 'rastreo';

const CLAVES = new Set<string>(CATEGORIAS_COMUNIDAD.map((c) => c.clave));
export const esCategoria = (v: any): v is CategoriaComunidad => CLAVES.has(String(v ?? ''));
export const nombreCategoria = (clave: any) => CATEGORIAS_COMUNIDAD.find((c) => c.clave === clave)?.nombre || '';

export interface FuenteDePersona {
  tipo: FuenteComunidad;
  /** «Sorteo Amsodent · UVM», «Evento Santiago», «Formulario del QR», «Google Maps». */
  etiqueta: string;
  /** Fila de origen: 'sorteo:55', 'evento:8', 'comunidad:12'. */
  ref: string;
  fecha: string | null;
}

export interface FilaComunidad {
  /** Identificador estable de la fila en pantalla: el de su fuente principal. */
  ref: string;
  /** id en comunidad_registros (null = solo existe en sorteos/eventos). */
  id: number | null;
  fuente: FuenteComunidad;
  fuentes: FuenteDePersona[];
  nombre: string;
  apellido: string;
  correo: string;
  telefono: string;
  whatsapp: string;
  sitio_web: string;
  direccion: string;
  comuna: string;
  region: string;
  ciudad: string;
  perfil: string | null;
  anio_estudio: string;
  universidad: string;
  especialidad: string;
  como_conociste: string;
  origen: string;
  categoria: CategoriaComunidad;
  /** La categoría no está guardada: se dedujo del origen. */
  categoria_auto: boolean;
  correo_enviado: boolean | null;
  maps_url: string;
  place_id: string;
  rastreo: any;
  created_at: string | null;
}

const txt = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim();
const correoDe = (v: any) => txt(v).toLowerCase();

/* Los sorteos y eventos piden el nombre en un solo campo: «Ana María Pérez
   Soto». Para la tabla se deja todo en `nombre` (no se adivina el apellido). */

/** Categoría que se propone para un registro del formulario de Comunidad. */
export function categoriaDeComunidad(r: any): CategoriaComunidad {
  if (r?.fuente === 'rastreo') return 'cliente_rastreado';
  if (r?.perfil === 'estudiante') return 'estudiante';
  if (r?.perfil === 'clinica') return 'clinica';
  return 'doctor_particular';
}

/** Sorteo: el formulario nuevo pregunta «¿eres estudiante?»; el antiguo, estudiante o egresado. */
export function categoriaDeSorteo(p: any): CategoriaComunidad {
  if (p?.es_estudiante === true) return 'estudiante';
  if (p?.es_estudiante === false) return 'doctor_particular';
  return String(p?.tipo_perfil || '').toLowerCase() === 'estudiante' ? 'estudiante' : 'doctor_particular';
}

/** Evento: quien marcó «soy profesor» es docente. */
export function categoriaDeEvento(i: any): CategoriaComunidad {
  return i?.es_profesor === true ? 'doctor_docente' : 'doctor_particular';
}

const ETIQUETA_EVENTO: Record<string, string> = { santiago: 'Evento Santiago', vina: 'Evento Viña del Mar', brasil: 'Evento Viña del Mar' };

function filaVacia(ref: string, fuente: FuenteComunidad): FilaComunidad {
  return {
    ref, id: null, fuente, fuentes: [], nombre: '', apellido: '', correo: '', telefono: '', whatsapp: '', sitio_web: '', direccion: '',
    comuna: '', region: '', ciudad: '', perfil: null, anio_estudio: '', universidad: '', especialidad: '', como_conociste: '', origen: '',
    categoria: 'doctor_particular', categoria_auto: true, correo_enviado: null, maps_url: '', place_id: '', rastreo: null, created_at: null,
  };
}

/**
 * Une las tres fuentes en la lista de Comunidad. `sorteos` son las filas de la
 * tabla `sorteos` (para el nombre de cada uno).
 */
export function unirComunidad(
  registros: any[],
  participantes: any[],
  inscripciones: any[],
  sorteos: any[] = [],
): FilaComunidad[] {
  const tituloSorteo = new Map<number, string>((sorteos || []).map((s: any) => [Number(s.id), txt(s.titulo) || `Sorteo ${s.id}`]));
  const filas: FilaComunidad[] = [];
  const porCorreo = new Map<string, FilaComunidad>();

  // 1) Lo guardado en Comunidad manda: es donde vive la categoría elegida a mano.
  for (const r of registros || []) {
    const fuente: FuenteComunidad = ['sorteo', 'evento', 'rastreo'].includes(r?.fuente) ? r.fuente : 'comunidad';
    const f = filaVacia(`comunidad:${r.id}`, fuente);
    f.id = Number(r.id);
    f.nombre = txt(r.nombre);
    f.apellido = txt(r.apellido);
    f.correo = correoDe(r.correo);
    f.telefono = txt(r.telefono);
    f.whatsapp = txt(r.whatsapp);
    f.sitio_web = txt(r.sitio_web);
    f.direccion = txt(r.direccion);
    f.comuna = txt(r.comuna);
    f.region = txt(r.region);
    f.ciudad = txt(r.ciudad);
    f.perfil = r.perfil || null;
    f.anio_estudio = txt(r.anio_estudio);
    f.universidad = txt(r.universidad);
    f.especialidad = txt(r.especialidad);
    f.como_conociste = txt(r.como_conociste);
    f.origen = txt(r.origen);
    f.correo_enviado = fuente === 'comunidad' ? r.correo_enviado === true : null;
    f.maps_url = txt(r.maps_url);
    f.place_id = txt(r.place_id);
    f.rastreo = r.rastreo ?? null;
    f.created_at = r.created_at || null;
    if (esCategoria(r.categoria)) { f.categoria = r.categoria; f.categoria_auto = false; }
    else f.categoria = categoriaDeComunidad({ ...r, fuente });
    // La fila guardada por categorizar a alguien de un sorteo o evento no agrega
    // fuente propia: su fuente real aparece al cruzar con esas tablas (abajo).
    if (fuente === 'comunidad') f.fuentes.push({ tipo: 'comunidad', etiqueta: 'Formulario del QR', ref: f.ref, fecha: f.created_at });
    if (fuente === 'rastreo') f.fuentes.push({ tipo: 'rastreo', etiqueta: 'Google Maps', ref: f.ref, fecha: f.created_at });
    filas.push(f);
    // Las clínicas rastreadas no se cruzan con personas por correo.
    if (fuente !== 'rastreo' && f.correo && !porCorreo.has(f.correo)) porCorreo.set(f.correo, f);
  }

  const sumar = (correo: string, fuente: FuenteDePersona, datos: Partial<FilaComunidad>, categoria: CategoriaComunidad) => {
    let f = correo ? porCorreo.get(correo) : undefined;
    if (!f) {
      f = filaVacia(fuente.ref, fuente.tipo);
      f.correo = correo;
      f.created_at = fuente.fecha;
      f.categoria = categoria;
      filas.push(f);
      if (correo) porCorreo.set(correo, f);
    }
    f.fuentes.push(fuente);
    // Completa lo que la fila no traía (nunca pisa lo que ya tiene).
    for (const [k, v] of Object.entries(datos)) {
      if (v && !(f as any)[k]) (f as any)[k] = v;
    }
    // La fecha de la fila es la de su primera aparición.
    if (fuente.fecha && (!f.created_at || fuente.fecha < f.created_at)) f.created_at = fuente.fecha;
    // Categoría propuesta: «docente» y «estudiante» dicen más que el valor por defecto.
    if (f.categoria_auto && f.categoria === 'doctor_particular' && categoria !== 'doctor_particular') f.categoria = categoria;
  };

  // 2) Participantes de sorteos.
  for (const p of participantes || []) {
    const estudiante = categoriaDeSorteo(p) === 'estudiante';
    sumar(
      correoDe(p.email),
      { tipo: 'sorteo', etiqueta: tituloSorteo.get(Number(p.sorteo_id)) || 'Sorteo', ref: `sorteo:${p.id}`, fecha: p.created_at || null },
      {
        nombre: txt(p.nombre),
        perfil: estudiante ? 'estudiante' : 'dentista',
        anio_estudio: txt(p.anio),
        universidad: estudiante ? txt(p.universidad_clinica) : '',
        especialidad: estudiante ? '' : txt(p.especialidad),
      },
      categoriaDeSorteo(p),
    );
  }

  // 3) Inscritos a eventos.
  for (const i of inscripciones || []) {
    sumar(
      correoDe(i.correo),
      { tipo: 'evento', etiqueta: ETIQUETA_EVENTO[String(i.evento || '').toLowerCase()] || `Evento ${txt(i.evento)}`.trim(), ref: `evento:${i.id}`, fecha: i.created_at || null },
      { nombre: txt(i.nombre), apellido: txt(i.apellido), telefono: txt(i.telefono), perfil: 'dentista', especialidad: txt(i.especialidad), universidad: i.es_profesor ? txt(i.universidad) : '' },
      categoriaDeEvento(i),
    );
  }

  // Una fila guardada desde un sorteo o evento cuya fila de origen ya no existe conserva al menos esa pista.
  for (const f of filas) {
    if (!f.fuentes.length) f.fuentes.push({ tipo: f.fuente, etiqueta: f.fuente === 'sorteo' ? 'Sorteo' : f.fuente === 'evento' ? 'Evento' : 'Comunidad', ref: f.ref, fecha: f.created_at });
  }
  return filas.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/* ¿El error de la base es porque falta la migración 20261117? Columna o tabla
   que no existe, o las restricciones antiguas (apellido y correo obligatorios,
   perfil solo estudiante/dentista). */
export const esFaltaMigracion = (e: any) =>
  /^(42703|42P01|PGRST204|PGRST205|23502|23514)$/.test(String(e?.code || '')) ||
  /could not find|does not exist|schema cache|null value in column|violates check constraint/i.test(String(e?.message || ''));

/** `'sorteo:55'` → `{ tipo: 'sorteo', id: 55 }`; null si no es una referencia válida. */
export function leerRef(ref: any): { tipo: 'comunidad' | 'sorteo' | 'evento'; id: number } | null {
  const m = String(ref ?? '').match(/^(comunidad|sorteo|evento):(\d+)$/);
  return m ? { tipo: m[1] as any, id: Number(m[2]) } : null;
}
