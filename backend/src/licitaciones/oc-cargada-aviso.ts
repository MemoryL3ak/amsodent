/* (2026-11-04) Aviso al dueño de la cotización cuando OTRA persona carga una
   orden de compra. Pedido de Ariel: «notificación automática (correo o
   ventana flotante en la plataforma) dirigida al ejecutivo o dueño de la
   cotización cada vez que otro usuario cargue una Orden de Compra».
   Dueño = vendedor_correo o, si no hay, creado_por (el mismo criterio que los
   demás avisos al vendedor). Si quien carga es el propio dueño, o no se sabe
   quién cargó (cargas sin sesión), no hay aviso: la regla es «otro usuario».
   Esta parte es pura para poder probarla sin base de datos. */

export const TIPO_OC_CARGADA = 'oc_cargada';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const correo = (v: unknown) =>
  (typeof v === 'string' ? v : '').trim().toLowerCase();

export type LicitacionDueno = {
  id: number;
  id_licitacion?: string | null;
  nombre?: string | null;
  nombre_entidad?: string | null;
  vendedor_correo?: string | null;
  vendedor_nombre?: string | null;
  creado_por?: string | null;
};

export type OcCargada = {
  documentoId: number;
  numero?: string | null;
  monto?: number | string | null; // neto, tal como se guarda en licitacion_documentos
  fechaOc?: string | null; // YYYY-MM-DD
};

export type AvisoOcCargada = {
  destinatario: string;
  mensaje: string;
  link: string;
  metadata: {
    licitacion_id: number;
    id_licitacion: string | null;
    documento_id: number;
    numero: string | null;
    monto: number | null;
    fecha_oc: string | null;
    cliente: string;
    cargado_por: string;
    cargado_por_nombre: string;
  };
};

export const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

/** 2026-11-04 → 04-11-2026 (como se lee en Chile). */
export function fechaCorta(iso?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function duenoDeCotizacion(
  lic: Pick<LicitacionDueno, 'vendedor_correo' | 'creado_por'>,
): string | null {
  const d = correo(lic.vendedor_correo) || correo(lic.creado_por);
  return RE_EMAIL.test(d) ? d : null;
}

export function avisoOcCargada(
  lic: LicitacionDueno,
  doc: OcCargada,
  cargadoPor: string | null | undefined,
  cargadoPorNombre?: string | null,
): AvisoOcCargada | null {
  const dueno = duenoDeCotizacion(lic);
  const quienCorreo = correo(cargadoPor);
  if (!dueno || !quienCorreo || quienCorreo === dueno) return null;

  const quien = String(cargadoPorNombre || '').trim() || quienCorreo;
  const cliente = String(lic.nombre_entidad || '').trim() || 'el cliente';
  const idCot = String(lic.id_licitacion || '').trim() || String(lic.id);
  const numero = String(doc.numero || '').trim();
  const montoNum = Number(doc.monto);
  const monto = Number.isFinite(montoNum) && montoNum > 0 ? montoNum : null;
  const mensaje =
    `${quien} cargó la orden de compra${numero ? ` N° ${numero}` : ''}` +
    `${monto ? ` (${clp(monto)} neto)` : ''} de ${cliente} en tu cotización ${idCot}.`;

  return {
    destinatario: dueno,
    mensaje,
    link: `/detalle/${lic.id}`,
    metadata: {
      licitacion_id: lic.id,
      id_licitacion: String(lic.id_licitacion || '').trim() || null,
      documento_id: doc.documentoId,
      numero: numero || null,
      monto,
      fecha_oc: /^\d{4}-\d{2}-\d{2}/.test(String(doc.fechaOc || ''))
        ? String(doc.fechaOc).slice(0, 10)
        : null,
      cliente,
      cargado_por: quienCorreo,
      cargado_por_nombre: quien,
    },
  };
}
