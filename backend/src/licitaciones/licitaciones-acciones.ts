/* (2026-10-27, pedido de Ariel) Historial de acciones de una cotización:
   quién hizo qué y cuándo. Lo ven los administradores en Historial →
   Acciones (DetalleLicitacion). Se registra en licitaciones_acciones
   (migración 20261027) desde licitaciones.service: guardados que cambian
   datos, aprobaciones, cambios de estado y documentos. Lo anterior a la
   tabla (o todo, si falta la migración) se arma con el registro HTTP del
   monitor (monitor_logs, 30 días), que dice quién llamó a qué ruta pero no
   qué cambió.
   Origen: la 6270 se aprobó a las 09:35:14 y un guardado de la vendedora con
   el estado viejo la devolvió a «Pendiente Aprobación Peso» a las 09:36:05;
   solo se supo leyendo ese registro. Funciones puras: sin base de datos. */

export type Accion = {
  fecha: string;
  accion: string; // aprobacion | estado | edicion | documento | guardado | items | creacion | otro
  detalle: string;
  email: string | null;
  persona?: string | null;
  // registro: licitaciones_acciones (con el detalle); acceso: monitor_logs (sin el detalle de qué cambió).
  origen: 'registro' | 'acceso';
};

type TipoCampo = 'monto' | 'fecha' | 'si_no' | 'largo';
/* Campos de la cotización que se anotan cuando un guardado los cambia. El
   estado y la aprobación de margen van aparte (son la acción principal). */
export const CAMPOS_ACCION: Record<string, { nombre: string; tipo?: TipoCampo }> = {
  id_licitacion: { nombre: 'ID' },
  nombre: { nombre: 'nombre' },
  fecha_hora_cierre: { nombre: 'cierre', tipo: 'fecha' },
  monto: { nombre: 'monto', tipo: 'monto' },
  lista_precios: { nombre: 'lista de precios' },
  rut_entidad: { nombre: 'RUT' },
  nombre_entidad: { nombre: 'entidad' },
  tipo_cliente: { nombre: 'tipo de cotización' },
  tipo_compra: { nombre: 'tipo de compra' },
  region: { nombre: 'región' },
  comuna: { nombre: 'comuna' },
  direccion: { nombre: 'dirección' },
  contacto: { nombre: 'contacto' },
  email: { nombre: 'correo del contacto' },
  telefono: { nombre: 'teléfono' },
  condicion_venta: { nombre: 'condición de venta' },
  total_con_iva: { nombre: 'total', tipo: 'monto' },
  flete_estimado: { nombre: 'flete', tipo: 'monto' },
  flete_por_pagar: { nombre: 'flete por pagar', tipo: 'si_no' },
  retiro_en_local: { nombre: 'entrega en local', tipo: 'si_no' },
  estado_envio: { nombre: 'estado del envío' },
  estado_entrega: { nombre: 'estado de entrega' },
  ciclo_cerrado: { nombre: 'ciclo cerrado', tipo: 'si_no' },
  observaciones: { nombre: 'observaciones', tipo: 'largo' },
  motivo_perdida: { nombre: 'motivo de pérdida' },
  motivo_descarte: { nombre: 'motivo de descarte' },
};

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const normalizar = (v: any, tipo?: TipoCampo) => {
  if (tipo === 'monto') return Math.round(Number(v) || 0);
  if (tipo === 'si_no') return v === true;
  if (tipo === 'fecha') return String(v ?? '').slice(0, 16).replace('T', ' ');
  return String(v ?? '').replace(/\s+/g, ' ').trim();
};
const mostrar = (v: any, tipo?: TipoCampo) => {
  if (tipo === 'monto') return clp(v);
  if (tipo === 'si_no') return v ? 'sí' : 'no';
  const s = String(v);
  if (!s) return '(vacío)';
  return s.length > 40 ? `«${s.slice(0, 39)}…»` : `«${s}»`;
};

/* Lo que cambió un guardado (PUT de la cotización), comparando la fila previa
   con lo enviado. null si no cambió nada que valga la pena anotar. */
export function accionDeGuardado(
  prev: Record<string, any> | null,
  body: Record<string, any>,
  aprobada: boolean,
): { accion: string; detalle: string; cambios: Record<string, [any, any]> } | null {
  if (!prev) return null;
  const partes: string[] = [];
  const cambios: Record<string, [any, any]> = {};
  let accion = 'edicion';

  const estadoAntes = prev.estado ?? null;
  if (body.estado !== undefined && body.estado !== estadoAntes) {
    cambios.estado = [estadoAntes, body.estado];
    if (aprobada) {
      accion = 'aprobacion';
      partes.push(`Aprobó la cotización: «${estadoAntes || '—'}» → «${body.estado}»`);
    } else {
      accion = 'estado';
      partes.push(`Cambió el estado: «${estadoAntes || '—'}» → «${body.estado}»`);
    }
  }
  if (body.margen_aprobado === true && prev.margen_aprobado !== true) {
    cambios.margen_aprobado = [false, true];
    if (!aprobada) {
      accion = 'aprobacion';
      partes.push('Aprobó el margen');
    }
  }

  const editados: string[] = [];
  for (const [campo, def] of Object.entries(CAMPOS_ACCION)) {
    if (!(campo in body)) continue;
    const antes = normalizar(prev[campo], def.tipo);
    const despues = normalizar(body[campo], def.tipo);
    if (antes === despues) continue;
    cambios[campo] = [prev[campo] ?? null, body[campo] ?? null];
    editados.push(def.tipo === 'largo' ? def.nombre : `${def.nombre} ${mostrar(antes, def.tipo)} → ${mostrar(despues, def.tipo)}`);
  }
  if (editados.length) partes.push(`Editó ${editados.join(', ')}`);

  if (!partes.length) return null;
  return { accion, detalle: partes.join(' · '), cambios };
}

// Cómo se nombra cada documento en una acción («Cargó la orden de compra N° …»).
const NOMBRE_DOC: Record<string, string> = {
  orden_compra: 'la orden de compra',
  guia_despacho: 'la guía de despacho',
  factura: 'la factura',
  factura_boleta: 'la factura / boleta',
  comprobante_pago: 'un comprobante de pago',
  webpay: 'un pago Webpay',
  efectivo: 'un pago en efectivo',
  nota_credito: 'la nota de crédito',
  nota_debito: 'la nota de débito',
  devolucion: 'una devolución',
  multa: 'una multa',
  info_despacho: 'la información de despacho',
  cierre_forzado: 'el cierre forzado',
  boleta_garantia: 'la boleta de garantía',
};

export function nombreDocumento(d: { tipo?: string | null; numero?: any; monto?: any }): string {
  const tipo = String(d?.tipo || '');
  const base = NOMBRE_DOC[tipo] || `el documento «${tipo || 's/tipo'}»`;
  const num = String(d?.numero ?? '').trim();
  const partes = [base];
  if (num) partes.push(tipo === 'cierre_forzado' ? `(motivo: ${num.slice(0, 80)})` : `N° ${num.slice(0, 40)}`);
  if (Number(d?.monto) > 0) partes.push(`por ${clp(Number(d.monto))} neto`);
  return partes.join(' ');
}

// Edición de un documento: solo número, monto y tipo (lo demás tiene sus propios rastros).
export function accionDeDocumentoEditado(prev: Record<string, any> | null, body: Record<string, any>): string | null {
  if (!prev) return null;
  const partes: string[] = [];
  if ('numero' in body && normalizar(body.numero) !== normalizar(prev.numero)) {
    partes.push(`N° ${mostrar(normalizar(prev.numero))} → ${mostrar(normalizar(body.numero))}`);
  }
  if ('monto' in body && normalizar(body.monto, 'monto') !== normalizar(prev.monto, 'monto')) {
    partes.push(`monto ${clp(Number(prev.monto) || 0)} → ${clp(Number(body.monto) || 0)}`);
  }
  if ('tipo' in body && body.tipo && body.tipo !== prev.tipo) partes.push(`tipo «${prev.tipo}» → «${body.tipo}»`);
  if (!partes.length) return null;
  return `Editó ${nombreDocumento({ tipo: prev.tipo })}: ${partes.join(', ')}`;
}

/* Registro HTTP del monitor → acciones, para lo que no está en la tabla.
   Una aprobación se reconoce por su aviso «cotización aprobada» (se crea
   segundos ANTES de que el monitor anote la respuesta), y quedar en peso por
   el POST notificar-peso que hace la pantalla justo después de guardar. */
export function accionesDesdeRegistro(
  licId: number,
  logs: { created_at: string; metodo: string; ruta: string; status: number | null; usuario_email: string | null }[],
  aprobaciones: { creado_at: string; aprobador_email: string | null }[],
  creacion: { fecha: string | null; email: string | null },
): Accion[] {
  const base = `/api/licitaciones/${licId}`;
  const t = (s: string) => new Date(s).getTime();
  const propios = (logs || [])
    .filter((l) => l.ruta === base || String(l.ruta || '').startsWith(`${base}/`))
    .sort((a, b) => t(a.created_at) - t(b.created_at));
  const usados = new Set<number>();
  const out: Accion[] = [];
  let creacionVista = false;

  propios.forEach((l, i) => {
    if (usados.has(i)) return;
    const email = String(l.usuario_email || '').toLowerCase() || null;
    const sub = l.ruta.slice(base.length); // '', '/items', '/notificar-peso', …
    const rechazo = Number(l.status) >= 400 ? ` — rechazado (${l.status})` : '';
    let accion = 'otro';
    let detalle = `${l.metodo} ${l.ruta.replace(/^\/api/, '')}`;

    if (l.metodo === 'PUT' && sub === '') {
      accion = 'guardado';
      detalle = 'Guardó la cotización';
      const aprobo = aprobaciones.some(
        (a) => String(a.aprobador_email || '').toLowerCase() === email && t(a.creado_at) - t(l.created_at) <= 5_000 && t(l.created_at) - t(a.creado_at) <= 30_000,
      );
      // ¿La pantalla avisó «quedó en peso» justo después de este guardado?
      const j = propios.findIndex(
        (x, k) => k > i && !usados.has(k) && x.metodo === 'POST' && x.ruta === `${base}/notificar-peso` && String(x.usuario_email || '').toLowerCase() === email && t(x.created_at) - t(l.created_at) <= 15_000,
      );
      if (aprobo) {
        accion = 'aprobacion';
        detalle = 'Aprobó la cotización';
      } else if (j >= 0) {
        usados.add(j);
        accion = 'estado';
        detalle = 'Guardó la cotización y quedó en «Pendiente Aprobación Peso»';
      }
    } else if (l.metodo === 'POST' && sub === '/notificar-peso') {
      accion = 'estado';
      detalle = 'Quedó en «Pendiente Aprobación Peso» (aviso a los administradores)';
    } else if (l.metodo === 'POST' && sub === '/items') {
      const alCrear = !creacionVista && creacion.fecha && Math.abs(t(l.created_at) - t(creacion.fecha)) <= 120_000;
      accion = alCrear ? 'creacion' : 'items';
      detalle = alCrear ? 'Creó la cotización con sus ítems' : 'Agregó ítems';
      if (alCrear) creacionVista = true;
    } else if (l.metodo === 'PUT' && sub === '/items') {
      accion = 'items';
      detalle = 'Actualizó los ítems';
    } else if (l.metodo === 'DELETE' && sub === '') {
      accion = 'otro';
      detalle = 'Eliminó la cotización';
    }
    out.push({ fecha: l.created_at, accion, detalle: detalle + rechazo, email, origen: 'acceso' });
  });
  return out;
}
