/* ── Costo de la recepción mayor que el del producto (2026-11-17) ────────────
   Pedido de Ariel: «si se reconoce que en recepción de stock el último costo
   es superior, levantar alerta para confirmar si es modificación de costo
   definitiva o momentánea».

   Regla: de cada producto se mira su ÚLTIMA línea recibida (recepciones
   registradas). Si su costo neto unitario es mayor que el costo que el
   producto tiene hoy y nadie ha decidido sobre esa línea, hay alerta. Se
   resuelve en Productos → Actualización de precios:
     · definitiva → el costo del producto pasa a ser el de la recepción (queda
                    en el historial de precios y sigue a Bsale y al Sheet como
                    cualquier cambio de costo);
     · momentánea → el costo del producto se mantiene y la alerta se cierra.
   Si después llega otra recepción del producto, manda esa (la más nueva).

   Aquí solo está la lógica (sin base de datos) para poder probarla. */

export type DecisionCosto = 'definitiva' | 'momentanea';

export interface LineaRecibida {
  id: number;
  recepcion_id: number;
  producto_id: number;
  sku: string | null;
  nombre: string | null;
  cantidad: number;
  costo_unitario: number;
  costo_decision?: string | null;
  created_at?: string | null;
  /** Cabecera de la recepción. */
  documento?: string | null;
  proveedor?: string | null;
  fecha?: string | null;
  usuario?: string | null;
}

export interface ProductoCosto {
  id: number;
  sku: string | null;
  nombre: string | null;
  marca?: string | null;
  categoria?: string | null;
  costo: number | null;
  lista1?: number | null;
  lista2?: number | null;
  lista3?: number | null;
}

export interface AlertaCosto {
  linea_id: number;
  recepcion_id: number;
  producto_id: number;
  sku: string;
  nombre: string;
  marca: string;
  categoria: string;
  costo_actual: number;
  costo_recepcion: number;
  /** (2026-11-26) Precios netos vigentes de las listas 1 y 2 (0 = sin precio): la alerta deja cambiarlos junto al costo. */
  lista1: number;
  lista2: number;
  diferencia: number;
  /** % de alza sobre el costo actual; null si el producto no tenía costo. */
  alza_pct: number | null;
  cantidad: number;
  documento: string;
  proveedor: string;
  fecha: string | null;
  usuario: string;
  /** Margen de cada lista con el costo actual y con el de la recepción. */
  margenes: { lista: 'lista1' | 'lista2' | 'lista3'; precio: number; actual: number | null; nuevo: number | null }[];
}

const n = (v: any) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const margen = (precio: number, costo: number) => (precio > 0 ? Math.round(((precio - costo) / precio) * 1000) / 10 : null);

/** ¿El costo recibido es superior al del producto? (más de 50 centavos: los costos llevan decimales) */
export function costoMayor(costoRecepcion: any, costoProducto: any): boolean {
  const r = n(costoRecepcion);
  return r > 0 && r - n(costoProducto) > 0.5;
}

/** La línea más nueva de cada producto. */
export function ultimaPorProducto(lineas: LineaRecibida[]): Map<number, LineaRecibida> {
  const mapa = new Map<number, LineaRecibida>();
  for (const l of lineas || []) {
    const id = Number(l?.producto_id);
    if (!id) continue;
    const previa = mapa.get(id);
    if (!previa || Number(l.id) > Number(previa.id)) mapa.set(id, l);
  }
  return mapa;
}

/** Alertas vigentes: última recepción de cada producto con costo superior y sin decisión. */
export function alertasDeCosto(lineas: LineaRecibida[], productos: Map<number, ProductoCosto>): AlertaCosto[] {
  const out: AlertaCosto[] = [];
  for (const [productoId, l] of ultimaPorProducto(lineas)) {
    if (l.costo_decision) continue;
    const p = productos.get(productoId);
    if (!p) continue; // el producto ya no existe
    const actual = n(p.costo);
    const recibido = Math.round(n(l.costo_unitario) * 100) / 100;
    if (!costoMayor(recibido, actual)) continue;
    const l2 = n(p.lista2);
    // Lista 3 vacía se calcula sola (lista 2 × 1,08), igual que en el resto de la plataforma.
    const l3 = n(p.lista3) > 0 ? n(p.lista3) : l2 > 0 ? Math.round(l2 * 1.08) : 0;
    out.push({
      linea_id: Number(l.id),
      recepcion_id: Number(l.recepcion_id),
      producto_id: productoId,
      sku: String(p.sku || l.sku || ''),
      nombre: String(p.nombre || l.nombre || ''),
      marca: String(p.marca || ''),
      categoria: String(p.categoria || ''),
      costo_actual: actual,
      costo_recepcion: recibido,
      lista1: n(p.lista1),
      lista2: l2,
      diferencia: Math.round((recibido - actual) * 100) / 100,
      alza_pct: actual > 0 ? Math.round(((recibido - actual) / actual) * 1000) / 10 : null,
      cantidad: n(l.cantidad),
      documento: String(l.documento || ''),
      proveedor: String(l.proveedor || ''),
      fecha: l.fecha || l.created_at || null,
      usuario: String(l.usuario || ''),
      margenes: ([['lista1', n(p.lista1)], ['lista2', l2], ['lista3', l3]] as const)
        .filter(([, precio]) => precio > 0)
        .map(([lista, precio]) => ({ lista, precio, actual: actual > 0 ? margen(precio, actual) : null, nuevo: margen(precio, recibido) })),
    });
  }
  // Las alzas más fuertes primero; los que no tenían costo, al final.
  return out.sort((a, b) => (b.alza_pct ?? -1) - (a.alza_pct ?? -1) || b.linea_id - a.linea_id);
}

/* (2026-11-26) Pedido de Ariel: «cuando en actualización de precios se
   despliegue alerta de costo, permitir actualizar además el listado de precios
   1 y 2». Al confirmar el alza como DEFINITIVA se pueden mandar los precios
   nuevos de las listas 1 y 2. Esta función valida lo pedido y devuelve SOLO
   las listas que de verdad cambian (vacío = no tocar). Precios netos enteros,
   como en el resto de la plataforma. Lanza un Error con el motivo si algo no
   es un precio válido. */
export const PRECIO_LISTA_MAX = 999_999_999;
export function preciosPedidosEnAlerta(
  pedido: { lista1?: any; lista2?: any } | null | undefined,
  actual: { lista1: number; lista2: number },
): { lista1?: number; lista2?: number } {
  const out: { lista1?: number; lista2?: number } = {};
  for (const lista of ['lista1', 'lista2'] as const) {
    const crudo = pedido?.[lista];
    if (crudo === undefined || crudo === null || String(crudo).trim() === '') continue;
    const valor = typeof crudo === 'number' ? crudo : Number(String(crudo).trim());
    const nombre = lista === 'lista1' ? 'lista 1' : 'lista 2';
    if (!Number.isFinite(valor) || valor <= 0) throw new Error(`El precio de la ${nombre} debe ser un número mayor que cero.`);
    if (valor > PRECIO_LISTA_MAX) throw new Error(`El precio de la ${nombre} es demasiado alto.`);
    const precio = Math.round(valor);
    if (precio !== Math.round(n(actual[lista]))) out[lista] = precio;
  }
  return out;
}

/** Aviso de la campana tras registrar una recepción (sin montos: el costo no se difunde). */
export function mensajeCostoMayor(recepcionId: number, productos: { sku?: string | null; nombre?: string | null }[], max = 4): string {
  const total = productos.length;
  const nombres = productos.slice(0, max).map((p) => String(p.sku || p.nombre || 'producto')).join(', ');
  return `Recepción #${recepcionId}: ${total} producto${total === 1 ? ' llegó' : 's llegaron'} con un costo mayor al del catálogo (${nombres}${total > max ? ` y ${total - max} más` : ''}). Confirma en Actualización de precios si el cambio de costo es definitivo o momentáneo.`;
}
