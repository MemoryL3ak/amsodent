/* ── Giros del cliente: funciones puras (2026-11-05) ──────────────────────────
   Salieron de bsale-clientes.service.ts para que la facturación también las
   use (elegir el giro al emitir una factura) sin importar ese servicio, que a
   su vez depende del de facturación. */

export const GIRO_MAX = 80; // largo de cada giro en la ficha
export const GIROS_MAX = 6; // cuántos giros admite la ficha
export const ACTIVITY_MAX = 80; // lo que se manda a Bsale (un solo texto)
export const SEPARADOR_GIROS = ' / ';

export const clave = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/* Lista limpia: sin vacíos ni repetidos (sin distinguir mayúsculas ni tildes),
   cada uno recortado a GIRO_MAX y como mucho GIROS_MAX. Acepta un arreglo o un
   texto con un giro por línea. */
export function normalizarGiros(valor: any): string[] {
  const crudos: any[] = Array.isArray(valor) ? valor : String(valor ?? '').split(/\r?\n/);
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const v of crudos) {
    const g = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, GIRO_MAX).trim();
    if (!g) continue;
    const k = clave(g);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(g);
    if (out.length >= GIROS_MAX) break;
  }
  return out;
}

/* Un solo texto para `activity`: los giros que quepan, en orden, unidos con « / ». */
export function girosParaBsale(giros: any): string {
  const lista = normalizarGiros(giros);
  if (!lista.length) return '';
  let acc = '';
  for (const g of lista) {
    const sig = acc ? `${acc}${SEPARADOR_GIROS}${g}` : g;
    if (sig.length > ACTIVITY_MAX) break;
    acc = sig;
  }
  return acc || lista[0].slice(0, ACTIVITY_MAX).trim();
}

/* Giros de una fila de `clientes` (tolera la columna sin migrar). */
export function leerGiros(fila: any): string[] {
  return normalizarGiros(Array.isArray(fila?.giros) ? fila.giros : []);
}

/* ¿Son el mismo giro? (sin distinguir mayúsculas, tildes ni espacios dobles) */
export const mismoGiro = (a: any, b: any) => clave(a) === clave(b);

/* Texto de `activity` para un grupo de giros, COMPLETO (sin recortar): el que
   elige los giros de una factura necesita saber si caben, no que se pierdan. */
export function textoDeGiros(giros: any): string {
  return normalizarGiros(giros).join(SEPARADOR_GIROS);
}

/* De los giros de la ficha, cuáles están hoy en el `activity` de Bsale (que
   puede traer uno solo o varios unidos con « / »). */
export function girosEnActividad(girosFicha: string[], actividad: any): string[] {
  const texto = String(actividad ?? '').replace(/\s+/g, ' ').trim();
  if (!texto) return [];
  const partes = texto.split(SEPARADOR_GIROS).map((p) => p.trim()).filter(Boolean);
  return (girosFicha || []).filter((g) => mismoGiro(g, texto) || partes.some((p) => mismoGiro(p, g)));
}

/* (2026-11-17) Giros que se ofrecen al emitir una guía y cuáles vienen
   marcados. `girosFicha` son los de la ficha (ya filtrados: solo se ofrece
   elegir cuando tiene más de uno); `giroBsale`, el texto que el cliente tiene
   hoy en Bsale (o, si es un cliente nuevo, la propuesta para crearlo).

   Regla: nada cambia en Bsale si la persona no lo decide. Por eso, cuando el
   giro que Bsale tiene hoy NO corresponde a los de la ficha, ese giro entra
   como una opción más y es el que viene marcado; cambiarlo a uno de la ficha
   es un clic consciente. Si Bsale ya tiene giros de la ficha, vienen marcados
   esos. (Hay fichas con giros mal escritos —«W»—: marcarlos por defecto habría
   cambiado el giro bueno de Bsale sin que nadie lo pidiera.) */
export function opcionesDeGiro(girosFicha: string[], giroBsale: any, clienteNuevo = false): { giros: string[]; elegidos: string[] } {
  const ficha = normalizarGiros(girosFicha);
  if (ficha.length < 2) return { giros: [], elegidos: [] };
  const actual = String(giroBsale ?? '').replace(/\s+/g, ' ').trim();
  const enBsale = girosEnActividad(ficha, actual);
  if (clienteNuevo || !actual) return { giros: ficha, elegidos: enBsale.length ? enBsale : ficha.slice(0, 1) };
  // Lo que Bsale tiene hoy es exactamente uno o más giros de la ficha: se ofrecen solo los de la ficha.
  if (enBsale.length && mismoGiro(textoDeGiros(enBsale), actual)) return { giros: ficha, elegidos: enBsale };
  // Bsale tiene otro giro (o uno de la ficha junto a otro que no está): se ofrece tal cual, marcado.
  return { giros: [actual, ...ficha.filter((g) => !mismoGiro(g, actual))], elegidos: [actual] };
}

/* El RUT se guarda en la ficha en varios formatos (con puntos, con guion,
   plano, con k minúscula): todas las formas de escribir el mismo RUT. */
export function variantesRutFicha(rut: any): string[] {
  const n = String(rut ?? '').toUpperCase().replace(/[^0-9K]/g, '');
  if (n.length < 2) return [];
  const cuerpo = n.slice(0, -1);
  const dv = n.slice(-1);
  const conPuntos = `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
  return [...new Set([conPuntos, `${cuerpo}-${dv}`, n, conPuntos.toLowerCase(), `${cuerpo}-${dv}`.toLowerCase(), n.toLowerCase()])];
}
