/* (2026-11-27) Notas adhesivas: reglas puras (sin base de datos).
   Las listas de estilos son la única fuente de verdad del servidor; el espejo
   del frontend está en src/lib/notasEstilos.js. Un valor desconocido no rompe:
   al crear cae en el predeterminado y al editar se ignora. */

export const COLORES_NOTA = ['amarillo', 'rosa', 'menta', 'celeste', 'lila', 'naranja', 'turquesa', 'blanco', 'grafito'] as const;
export const PAPELES_NOTA = ['liso', 'lineas', 'cuadros', 'puntos'] as const;
export const LETRAS_NOTA = ['normal', 'manuscrita', 'marcador', 'maquina'] as const;
export const SUJECIONES_NOTA = ['cinta', 'chinche', 'clip', 'ninguna'] as const;

export const MAX_CONTENIDO_NOTA = 2000;
export const MAX_NOTAS_POR_PERSONA = 200;
export const MAX_RUTA_NOTA = 300;
export const MAX_TITULO_RUTA_NOTA = 80;

export const MIGRACION_NOTAS =
  'Falta aplicar la migración 20261127_notas_adhesivas.sql en Supabase: las notas todavía no se pueden guardar.';

export function sinTablaNotas(error: any): boolean {
  return /(schema cache|does not exist|not find|PGRST205|PGRST204|42P01|42703)/i.test(`${error?.code} ${error?.message}`);
}

export type CamposNota = {
  contenido?: string;
  color?: string;
  papel?: string;
  letra?: string;
  sujecion?: string;
  destacada?: boolean;
  ruta?: string | null;
  ruta_titulo?: string | null;
  flotante?: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
};

const enLista = (lista: readonly string[], v: any): string | null => {
  const s = String(v ?? '').trim().toLowerCase();
  return lista.includes(s) ? s : null;
};

/* Fracción de la ventana (0 a 1); cualquier otra cosa = sin posición. */
const fraccion = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
};

/* Solo rutas internas de la plataforma («/trazabilidad?x=1»). Nunca una URL
   completa ni «//otro-sitio»: la nota lleva a esa ruta con un clic. */
export function rutaInterna(v: any): string | null {
  const s = String(v ?? '').trim();
  if (!s || !s.startsWith('/') || s.startsWith('//') || s.includes('\\') || /[\s<>"]/.test(s)) return null;
  return s.slice(0, MAX_RUTA_NOTA);
}

/* Deja solo los campos conocidos y con valores válidos.
   `parcial` = edición: lo que no viene (o viene inválido) no se toca.
   Sin `parcial` = nota nueva: todo campo queda con su valor o su predeterminado. */
export function limpiarNota(body: any, parcial: boolean): CamposNota {
  const b = body && typeof body === 'object' ? body : {};
  const out: CamposNota = {};
  const trae = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

  if (trae('contenido') || !parcial) {
    out.contenido = String(b.contenido ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_CONTENIDO_NOTA);
  }
  const estilos: Array<[keyof CamposNota, readonly string[]]> = [
    ['color', COLORES_NOTA],
    ['papel', PAPELES_NOTA],
    ['letra', LETRAS_NOTA],
    ['sujecion', SUJECIONES_NOTA],
  ];
  for (const [campo, lista] of estilos) {
    const v = enLista(lista, b[campo]);
    if (v) (out as any)[campo] = v;
    else if (!parcial) (out as any)[campo] = lista[0];
  }
  if (trae('destacada') || !parcial) out.destacada = b.destacada === true;
  if (trae('ruta') || !parcial) {
    out.ruta = rutaInterna(b.ruta);
    // Sin ruta no hay título: el título solo acompaña a una ruta válida.
    out.ruta_titulo = out.ruta ? String(b.ruta_titulo ?? '').trim().slice(0, MAX_TITULO_RUTA_NOTA) || null : null;
  }
  if (trae('flotante') || !parcial) out.flotante = b.flotante === true;
  if (trae('pos_x') || !parcial) out.pos_x = fraccion(b.pos_x);
  if (trae('pos_y') || !parcial) out.pos_y = fraccion(b.pos_y);
  return out;
}

/* Ids del pedido de reordenar: enteros positivos, sin repetir y solo los que
   son de la persona. Devuelve el orden final a guardar. */
export function ordenValido(pedidos: any, propios: number[]): number[] {
  const mios = new Set(propios.map(Number));
  const vistos = new Set<number>();
  const out: number[] = [];
  for (const v of Array.isArray(pedidos) ? pedidos : []) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || !mios.has(n) || vistos.has(n)) continue;
    vistos.add(n);
    out.push(n);
  }
  return out;
}
