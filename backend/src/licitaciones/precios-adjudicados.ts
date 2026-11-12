/* ── Precios adjudicados en Mercado Público, por producto (2026-11-12) ───────
   Pedido de Ariel: «al crear una cotización, agregamos los productos y ahí nos
   aparezca una manera de ver por producto un análisis histórico de precios
   basado en Mercado Público, para ver con qué precio histórico se adjudica».

   Mercado Público no conoce nuestros SKU: nombra cada ítem con la categoría
   ONU del comprador («Trinchadores de cera dentales» para un tiranervios), así
   que buscar por nombre no sirve. El cruce se hace por NUESTRAS cotizaciones:
   cada proceso al que postulamos con ese producto tiene su ficha guardada
   (mp_resultados) y de ahí sale a qué precio se adjudicó ESE ítem:

     · Compra Ágil ganada      → se adjudicó a nuestro precio.
     · Compra Ágil perdida     → la ficha compara ítem por ítem nuestra oferta
                                  con la ganadora; nuestra línea se reconoce
                                  por su precio y, si hay varias iguales, por
                                  cantidad y por orden. Cuando al postular se
                                  ajustó el precio en Mercado Público sin tocar
                                  la cotización, se reconoce por la cantidad y
                                  vale lo ofertado allá («aproximado»).
     · Cotizada «por el total» → el comprador pidió una sola línea y ofertamos
                                  el total: no hay precio por producto. Se
                                  ESTIMA aplicando a nuestra línea la misma
                                  proporción ganador/nosotros del total.
     · Licitación (API v1)     → solo publica lo adjudicado (precio, cantidad y
                                  proveedor por ítem), sin nuestra oferta: la
                                  línea se reconoce por la cantidad y un precio
                                  del mismo orden. Queda como «aproximado».
     · Sin ficha               → vale el estado de la cotización: Adjudicada =
                                  se adjudicó a nuestro precio; Perdida = no
                                  sabemos a cuánto.

   Aquí solo está la lógica (sin base de datos) para poder probarla. */

export type Calce = 'exacto' | 'aproximado' | 'estimado' | 'sin_dato';

export interface LineaCotizada {
  id?: number;
  licitacion_id: number;
  cantidad: number;
  valor_unitario: number;
}

export interface FichaMp {
  licitacion_id: number;
  codigo_mp?: string | null;
  tipo?: string | null;
  estado_mp?: string | null;
  ganamos?: boolean | null;
  participamos?: boolean | null;
  ganador_nombre?: string | null;
  fecha_adjudicacion?: string | null;
  fecha_cierre?: string | null;
  organismo?: string | null;
  comparacion_items?: any[] | null;
}

export interface CotizacionInterna {
  id: number;
  id_licitacion?: string | null;
  nombre_entidad?: string | null;
  estado?: string | null;
  fecha?: string | null;
  fecha_adjudicada?: string | null;
  tipo_cliente?: string | null;
  tipo_compra?: string | null;
}

export interface FilaAdjudicacion {
  fecha: string;
  licitacion_id: number;
  numero: string | null;
  codigo_mp: string | null;
  organismo: string | null;
  tipo: 'compra_agil' | 'licitacion' | null;
  cantidad: number;
  nuestro_precio: number;
  precio_adjudicado: number | null;
  ganador: string | null;
  resultado: 'ganada' | 'perdida';
  calce: Calce;
  /** El precio adjudicado es de otro orden que el nuestro (otra unidad, un
      dato mal ingresado en Mercado Público): se muestra, pero no entra en los
      promedios. */
  atipico: boolean;
}

export interface ResultadoLinea {
  fila: FilaAdjudicacion | null;
  /** No se pudo decidir sin las demás líneas de la cotización (líneas gemelas o proceso cotizado por el total). */
  faltaContexto: boolean;
}

/** Bajo 1/4 o sobre 4 veces nuestro precio no es «el mismo producto más barato o más caro». */
export function esAtipico(nuestro: number, adjudicado: number | null): boolean {
  if (adjudicado == null || !(nuestro > 0)) return false;
  const razon = adjudicado / nuestro;
  return razon < 0.25 || razon > 4;
}

export const NOSOTROS = 'Amsodent';

const entero = (v: any) => Math.round(Number(v) || 0);
const positivo = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dia = (v: any) => {
  const m = String(v || '').match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
};

export function esParticular(cot: CotizacionInterna | null | undefined): boolean {
  return String(cot?.tipo_cliente || '').toLowerCase().includes('particular') || cot?.tipo_compra === 'Cliente particular';
}

/** Desenlace según el estado de nuestra cotización (cuando la ficha no lo dice). */
export function desenlaceInterno(cot: CotizacionInterna | null | undefined): 'ganada' | 'perdida' | null {
  const estado = String(cot?.estado || '').toLowerCase();
  if (estado.includes('adjudicada')) return 'ganada';
  if (estado.includes('perdida')) return 'perdida';
  return null;
}

/* Varios ítems de la ficha pueden calzar con la línea (mismo precio, misma
   cantidad). Si todos se adjudicaron al mismo precio da lo mismo cuál sea; si
   difieren poco (≤ 10 %) vale el promedio como aproximación; si difieren más,
   no se adivina. */
function resolverCandidatos(cands: any[]): { precio: number; calce: Calce; item: any } | null {
  const conPrecio = cands.filter((c) => positivo(c?.precio_ganador) != null);
  if (!conPrecio.length) return null;
  const precios = conPrecio.map((c) => Number(c.precio_ganador));
  const min = Math.min(...precios);
  const max = Math.max(...precios);
  if (entero(min) === entero(max)) return { precio: entero(min), calce: 'exacto', item: conPrecio[0] };
  if ((max - min) / min <= 0.1) {
    return { precio: entero(precios.reduce((a, b) => a + b, 0) / precios.length), calce: 'aproximado', item: conPrecio[0] };
  }
  return null;
}

/* Un proceso cotizado «por el total»: la ficha trae UNA línea de cantidad 1
   con el total y nuestra cotización tiene varias. La proporción entre el total
   ganador y el nuestro se aplica a la línea. */
function estimarPorTotal(linea: LineaCotizada, lineas: LineaCotizada[], item: any, nuestroTotalMp: number | null): number | null {
  const ganador = positivo(item?.precio_ganador);
  if (ganador == null || lineas.length < 2) return null;
  const nuestroTotal = nuestroTotalMp ?? lineas.reduce((a, l) => a + (Number(l.valor_unitario) || 0) * (Number(l.cantidad) || 0), 0);
  if (!(nuestroTotal > 0)) return null;
  const razon = ganador / nuestroTotal;
  // Fuera de este rango no es «el mismo pedido a otro precio»: es otra cosa.
  if (razon < 0.3 || razon > 3) return null;
  return entero((Number(linea.valor_unitario) || 0) * razon);
}

/**
 * A qué precio se adjudicó en Mercado Público la línea de una cotización
 * nuestra. `lineas` son TODAS las líneas de esa cotización (solo hacen falta
 * para las líneas gemelas y los procesos cotizados por el total): si no vienen
 * y hacían falta, devuelve `faltaContexto` para que se pidan y se vuelva a
 * llamar.
 */
export function adjudicacionDeLinea(
  linea: LineaCotizada,
  cot: CotizacionInterna | null | undefined,
  ficha: FichaMp | null | undefined,
  lineas?: LineaCotizada[] | null,
): ResultadoLinea {
  const nuestro = entero(linea?.valor_unitario);
  const cantidad = Number(linea?.cantidad) || 0;
  if (!cot || nuestro <= 0 || esParticular(cot)) return { fila: null, faltaContexto: false };

  const interno = desenlaceInterno(cot);
  const tipo: FilaAdjudicacion['tipo'] = ficha?.tipo === 'compra_agil' ? 'compra_agil' : ficha?.tipo === 'licitacion' ? 'licitacion' : null;
  const base = {
    fecha: dia(ficha?.fecha_adjudicacion) || dia(cot.fecha_adjudicada) || dia(ficha?.fecha_cierre) || dia(cot.fecha),
    licitacion_id: cot.id,
    numero: cot.id_licitacion || null,
    codigo_mp: ficha?.codigo_mp || null,
    organismo: ficha?.organismo || cot.nombre_entidad || null,
    tipo,
    cantidad,
    nuestro_precio: nuestro,
  };
  if (!base.fecha) return { fila: null, faltaContexto: false };

  const ganada = (calce: Calce = 'exacto'): ResultadoLinea => ({
    fila: { ...base, precio_adjudicado: nuestro, ganador: NOSOTROS, resultado: 'ganada', calce, atipico: false },
    faltaContexto: false,
  });
  // `ofertado`: lo que de verdad ofertamos en Mercado Público, cuando no es lo de la cotización.
  const perdida = (precio: number | null, ganador: string | null, calce: Calce, ofertado: number = nuestro): ResultadoLinea => ({
    fila: { ...base, nuestro_precio: ofertado, precio_adjudicado: precio, ganador, resultado: 'perdida', calce, atipico: esAtipico(ofertado, precio) },
    faltaContexto: false,
  });
  const nada: ResultadoLinea = { fila: null, faltaContexto: false };
  const items: any[] = Array.isArray(ficha?.comparacion_items) ? (ficha!.comparacion_items as any[]) : [];

  /* ── Compra Ágil ── */
  if (ficha && tipo === 'compra_agil') {
    // Si la cotización terminó Adjudicada (p. ej. el seleccionado desistió y la
    // orden de compra llegó a nosotros), vale eso aunque la ficha sea anterior.
    if (ficha.ganamos === true || interno === 'ganada') return ganada();
    if (ficha.ganamos === false) {
      // Sin nuestra oferta en el proceso no hay con qué comparar la línea.
      if (ficha.participamos === false) return nada;
      const ganador = ficha.ganador_nombre || null;

      // 1) Por precio: lo ofertado en Mercado Público es el precio de la línea.
      const mismoPrecio = items.filter((m) => entero(m?.nuestro_precio) === nuestro);
      if (mismoPrecio.length) {
        const mismaCantidad = mismoPrecio.filter((m) => Number(m?.nuestra_cantidad) === cantidad);
        const cands = mismaCantidad.length ? mismaCantidad : mismoPrecio;
        const r = resolverCandidatos(cands);
        if (r) return perdida(r.precio, ganador, r.calce);
        /* Líneas gemelas (mismo precio y cantidad: los tonos de una resina, las
           medidas de una fresa) adjudicadas a precios distintos: se emparejan
           en orden, la primera gemela nuestra con la primera de la ficha. */
        if (!lineas) return { fila: null, faltaContexto: true };
        const gemelas = lineas
          .filter((l) => entero(l.valor_unitario) === nuestro && (Number(l.cantidad) || 0) === cantidad)
          .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
        const k = linea.id != null ? gemelas.findIndex((l) => l.id === linea.id) : -1;
        const par = k >= 0 && gemelas.length === cands.length ? positivo(cands[k]?.precio_ganador) : null;
        return par != null ? perdida(entero(par), ganador, 'aproximado') : perdida(null, ganador, 'sin_dato');
      }

      /* 2) Por cantidad: al postular se suele ajustar el precio en Mercado
         Público sin tocar la cotización. Vale lo que se ofertó allá. */
      const mismaCantidad = items.filter((m) => {
        const p = positivo(m?.nuestro_precio);
        return p != null && Number(m?.nuestra_cantidad) === cantidad && p / nuestro >= 0.5 && p / nuestro <= 2;
      });
      if (mismaCantidad.length) {
        if (!lineas) return { fila: null, faltaContexto: true };
        // Un ítem de la ficha cuyo precio es el de OTRA línea nuestra es de esa
        // línea, no de esta; y si quedan menos ítems libres que líneas nuestras
        // sin calce con esa cantidad, no se sabe cuál es cuál.
        const nuestrosPrecios = new Set(lineas.map((l) => entero(l.valor_unitario)));
        const libres = mismaCantidad.filter((m) => !nuestrosPrecios.has(entero(m.nuestro_precio)));
        const preciosFicha = new Set(items.map((m) => entero(m?.nuestro_precio)));
        const sinCalce = lineas.filter((l) => (Number(l.cantidad) || 0) === cantidad && !preciosFicha.has(entero(l.valor_unitario)));
        const ofertados = new Set(libres.map((m) => entero(m.nuestro_precio)));
        const r = libres.length && ofertados.size === 1 && sinCalce.length <= libres.length ? resolverCandidatos(libres) : null;
        if (r) return perdida(r.precio, ganador, 'aproximado', entero(r.item.nuestro_precio));
        return perdida(null, ganador, 'sin_dato');
      }

      // 3) Una sola línea en la ficha que no es la nuestra: ¿se cotizó por el total?
      if (items.length === 1 && Number(items[0]?.nuestra_cantidad) <= 1) {
        if (!lineas) return { fila: null, faltaContexto: true };
        const estimado = estimarPorTotal(linea, lineas, items[0], positivo(items[0]?.nuestro_precio));
        if (estimado != null) return perdida(estimado, ganador, 'estimado');
      }
      return perdida(null, ganador, 'sin_dato');
    }
    // Proceso sin resolver en la ficha: manda el estado de la cotización.
    return interno === 'perdida' ? perdida(null, null, 'sin_dato') : nada;
  }

  /* ── Licitación (solo lo adjudicado) ── */
  if (ficha && tipo === 'licitacion' && items.length) {
    const mismaCantidad = items.filter((m) => {
      const p = positivo(m?.precio_ganador);
      return p != null && Number(m?.cantidad_ganador) === cantidad && p / nuestro >= 0.25 && p / nuestro <= 4;
    });
    // Lo que nos adjudicaron a nosotros, a nuestro precio: calce seguro.
    if (mismaCantidad.some((m) => m?.ganado_por_nosotros === true && entero(m?.precio_ganador) === nuestro)) return ganada();
    if (mismaCantidad.length) {
      const r = resolverCandidatos(mismaCantidad);
      if (r) {
        const nuestra = mismaCantidad.every((m) => m?.ganado_por_nosotros === true);
        return nuestra
          ? { fila: { ...base, precio_adjudicado: r.precio, ganador: NOSOTROS, resultado: 'ganada', calce: 'aproximado', atipico: false }, faltaContexto: false }
          : perdida(r.precio, r.item?.ganador_nombre || ficha.ganador_nombre || null, 'aproximado');
      }
    }
    if (items.length === 1 && Number(items[0]?.cantidad_ganador) <= 1 && items[0]?.ganado_por_nosotros !== true) {
      if (!lineas) return { fila: null, faltaContexto: true };
      const estimado = estimarPorTotal(linea, lineas, items[0], null);
      if (estimado != null) return perdida(estimado, items[0]?.ganador_nombre || ficha.ganador_nombre || null, 'estimado');
    }
    // Adjudicada sin nada para nosotros: perdimos, sin saber el precio de la línea.
    if (ficha.ganamos === false) return perdida(null, ficha.ganador_nombre || null, 'sin_dato');
    // Nos adjudicaron parte y esta línea no se reconoce: no se afirma nada.
    return nada;
  }

  /* ── Sin ficha (o ficha sin resultado): el estado de la cotización ── */
  if (ficha?.ganamos === false && ficha.participamos !== false) return perdida(null, ficha.ganador_nombre || null, 'sin_dato');
  if (interno === 'ganada') return ganada();
  if (interno === 'perdida') return perdida(null, ficha?.ganador_nombre || null, 'sin_dato');
  return nada;
}

/* Una cotización re-cotizada (o su alternativa) repite el mismo proceso: queda
   una fila por proceso, cantidad y precios; la de la cotización más nueva. */
export function sinRepetidas(filas: FilaAdjudicacion[]): FilaAdjudicacion[] {
  const vistas = new Map<string, FilaAdjudicacion>();
  for (const f of filas) {
    const clave = f.codigo_mp
      ? `${f.codigo_mp}|${f.cantidad}|${f.nuestro_precio}|${f.precio_adjudicado ?? ''}|${f.resultado}`
      : `lic:${f.licitacion_id}|${f.cantidad}|${f.nuestro_precio}`;
    const previa = vistas.get(clave);
    if (!previa || f.licitacion_id > previa.licitacion_id) vistas.set(clave, f);
  }
  return [...vistas.values()].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.licitacion_id - a.licitacion_id);
}
