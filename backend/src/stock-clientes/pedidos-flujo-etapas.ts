/* ── Etapas del pedido del portal (2026-09-16, ampliado 2026-11-09) ─────────
   Lo que un pedido puede ser y cómo se mueve entre etapas, sin tocar la base
   de datos: así se prueba solo y el servicio lo usa como única fuente.

   Camino feliz:
     pendiente_aprobacion → aprobado_cliente → en_revision
                          → validado_plataforma → pagado

   · pendiente_aprobacion  lo armó un asistente; espera al administrador de la
                           cuenta del cliente.
   · aprobado_cliente      el cliente aprobó; nadie de Amsodent lo tomó aún.
   · en_revision           Amsodent ya actuó sobre el pedido (quién y cuándo:
                           la primera acción, crear la cotización u observar;
                           no hay botón «Tomar»). El cliente ve la cotización
                           en su portal y su aceptación es pagar (o pedir
                           cambios).
   · observado             parada lateral: Amsodent necesita una respuesta del
                           cliente antes de seguir (sin stock, reemplazo, dato
                           que falta). El cliente acepta → en_revision, o
                           modifica el pedido → aprobado_cliente.
   · validado_plataforma   existencias confirmadas y link de pago emitido.
   · pagado                Webpay o crédito confirmaron el pago. Cierra.
   · rechazado             Amsodent lo rechazó con motivo. Cierra.
   · cancelado             se canceló desde el estado comercial. Cierra.

   La reversa («volver atrás») vale en cualquier etapa abierta y deshace lo
   que produjo la etapa que se abandona.

   (2026-11-09, tarde) Se retiró la etapa `cotizacion_enviada` y, con ella, el botón
   «Validar cotización» del cliente: dejaba constancia de su conformidad pero
   no movía el pedido, así que el cliente creía haber avanzado y nadie lo
   veía. Vincular la cotización ahora deja el pedido en revisión. */

export type FlujoEstado =
  | 'pendiente_aprobacion'
  | 'aprobado_cliente'
  | 'en_revision'
  | 'observado'
  | 'validado_plataforma'
  | 'pagado'
  | 'rechazado'
  | 'cancelado';

/** El camino feliz, en orden. `observado` no está: es una parada lateral. */
export const CAMINO: FlujoEstado[] = [
  'pendiente_aprobacion',
  'aprobado_cliente',
  'en_revision',
  'validado_plataforma',
  'pagado',
];

export const TODOS: FlujoEstado[] = [...CAMINO, 'observado', 'rechazado', 'cancelado'];

export const CERRADOS: FlujoEstado[] = ['pagado', 'rechazado', 'cancelado'];

/** Etapas retiradas y la que las reemplaza. Un pedido que todavía tenga una
    guardada (antes de correr 20261109_pedidos_sin_cotizacion_enviada) se trata como si ya
    estuviera en la nueva. */
export const ETAPAS_RETIRADAS: Record<string, FlujoEstado> = {
  cotizacion_enviada: 'en_revision',
};

/** La etapa vigente de un pedido; sin etapa, el comienzo del camino. */
export function normalizarEtapa(e: string | null | undefined): FlujoEstado {
  const s = String(e || 'pendiente_aprobacion');
  return ETAPAS_RETIRADAS[s] || (s as FlujoEstado);
}

/** Desde dónde Amsodent puede confirmar existencias y emitir el pago. */
export const ESTADOS_VALIDABLES: FlujoEstado[] = [
  'aprobado_cliente',
  'en_revision',
  'observado',
  'validado_plataforma', // revalidar: cambió una cantidad o un precio
];

/** Desde dónde Amsodent puede dejarle una observación al cliente. */
export const ESTADOS_OBSERVABLES: FlujoEstado[] = ['aprobado_cliente', 'en_revision'];

/** Desde dónde vincular una cotización deja el pedido «en revisión» (a nombre
    de quien la creó si nadie lo había tomado). En otra etapa no lo mueve. */
export const ESTADOS_COTIZABLES: FlujoEstado[] = ['aprobado_cliente', 'en_revision'];

export function esCerrado(e: string | null | undefined): boolean {
  return CERRADOS.includes(String(e || '') as FlujoEstado);
}

export function etiquetaEstado(e: string): string {
  return (
    {
      pendiente_aprobacion: 'Pendiente de aprobación del cliente',
      aprobado_cliente: 'Aprobado por el cliente',
      en_revision: 'En revisión',
      observado: 'Observado',
      validado_plataforma: 'Validado y por pagar',
      pagado: 'Pagado',
      rechazado: 'Rechazado',
      cancelado: 'Cancelado',
    } as Record<string, string>
  )[e] || e;
}

/* Columnas que produce cada etapa. Al deshacerla se borran, para que no
   queden datos de una validación o una observación que ya no valen. */
const NULOS = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, null]));
export const COLS_APROBACION = ['aprobado_cliente_at', 'aprobado_cliente_por'];
export const COLS_REVISION = ['revision_iniciada_at', 'revision_por'];
export const COLS_OBSERVACION = [
  'observacion_at',
  'observacion_por',
  'observacion_texto',
  'observacion_respondida_at',
  'observacion_respondida_por',
  'observacion_respuesta',
];
export const COLS_VALIDACION = [
  'validado_at',
  'validado_por',
  'disponibilidad',
  'pago_link',
  'pago_estado',
  'pago_monto',
  'monto_total',
];

/** Un paso atrás: a dónde vuelve el pedido y qué se limpia. `null` si no se
    puede (primera etapa o pedido cerrado). */
export function etapaAnterior(pedido: {
  flujo_estado?: string | null;
}): { destino: FlujoEstado; limpieza: Record<string, null> } | null {
  const actual = normalizarEtapa(pedido?.flujo_estado);
  switch (actual) {
    case 'validado_plataforma':
      // Vuelve a manos de quien lo revisaba; la cotización, si la hay, sigue
      // vinculada y el cliente la sigue viendo.
      return { destino: 'en_revision', limpieza: NULOS(COLS_VALIDACION) };
    case 'observado':
      return { destino: 'en_revision', limpieza: NULOS(COLS_OBSERVACION) };
    case 'en_revision':
      return { destino: 'aprobado_cliente', limpieza: NULOS(COLS_REVISION) };
    case 'aprobado_cliente':
      return { destino: 'pendiente_aprobacion', limpieza: NULOS(COLS_APROBACION) };
    default:
      return null;
  }
}

/** Cuando el cliente modifica el pedido vuelve a «aprobado_cliente» y lo que
    Amsodent había avanzado (revisión, observación, validación) deja de valer.
    La cotización vinculada se conserva: se corrige. */
export const LIMPIEZA_MODIFICACION: Record<string, null> = NULOS([
  ...COLS_REVISION,
  ...COLS_OBSERVACION,
  ...COLS_VALIDACION,
]);

/** A qué etapa vuelve un pedido cancelado cuando el estado comercial deja de
    ser «cancelada»: la última que había alcanzado según sus marcas. */
export function estadoAlReabrir(pedido: {
  aprobado_cliente_at?: string | null;
  revision_iniciada_at?: string | null;
  licitacion_id?: number | string | null;
  validado_at?: string | null;
}): FlujoEstado {
  if (!pedido?.aprobado_cliente_at) return 'pendiente_aprobacion';
  if (pedido.validado_at) return 'validado_plataforma';
  // Crear la cotización es revisar el pedido, aunque nadie lo haya «tomado».
  if (pedido.revision_iniciada_at || pedido.licitacion_id) return 'en_revision';
  return 'aprobado_cliente';
}

/** Nombre de la columna que falta cuando Supabase rechaza un UPDATE o un
    SELECT por una migración sin aplicar; null si el error es otro. */
export function columnaFaltante(mensaje: string): string | null {
  const msg = String(mensaje || '');
  const m =
    /Could not find the '(\w+)' column/.exec(msg) ||
    /column (?:"?\w+"?\.)?"?(\w+)"? does not exist/.exec(msg);
  return m ? m[1] : null;
}
