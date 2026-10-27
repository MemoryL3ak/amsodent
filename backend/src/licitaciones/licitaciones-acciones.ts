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
  accion: string; // aprobacion | reversion | estado | motivo | edicion | documento | producto | guardado | items | creacion | otro
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
      detalle = 'Quedó en «Pendiente Aprobación Peso»: hay productos sin peso y se avisó a los administradores';
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


/* Ediciones de los productos de la cotización (registro HTTP: PUT
   /api/productos/:id). Explican, por ejemplo, cuándo y quién completó el peso
   que tenía la cotización en «Pendiente Aprobación Peso». */
export type ProductoCotizacion = { id: number; nombre: string; sku: string | null; peso: number | null };
export const pesoTexto = (kg: any) => {
  const n = Number(kg);
  if (!(n > 0)) return 'sin peso';
  const k = `${n.toLocaleString('es-CL', { maximumFractionDigits: 4 })} kg`;
  return n < 1 ? `${k} = ${(n * 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} g` : k;
};
export const nombreProducto = (p: { nombre?: string | null; sku?: string | null }) => `«${String(p?.nombre || p?.sku || 'producto').trim()}»`;

export function accionesDeProductos(
  logs: { created_at: string; ruta: string; status: number | null; usuario_email: string | null }[],
  productos: ProductoCotizacion[],
): Accion[] {
  const porRuta = new Map(productos.map((p) => [`/api/productos/${p.id}`, p]));
  return (logs || [])
    .filter((l) => porRuta.has(l.ruta) && !(Number(l.status) >= 400))
    .map((l) => {
      const p = porRuta.get(l.ruta)!;
      return {
        fecha: l.created_at,
        accion: 'producto',
        detalle: `Editó el producto ${nombreProducto(p)} de esta cotización (hoy pesa ${pesoTexto(p.peso)})`,
        email: String(l.usuario_email || '').toLowerCase() || null,
        origen: 'acceso' as const,
      };
    });
}

const partesChile = (iso: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
const horaChile = (iso: string) => { const p = partesChile(iso); return `${p.hour}:${p.minute}`; };
const fechaHoraChile = (iso: string) => { const p = partesChile(iso); return `${p.day}-${p.month}-${p.year} a las ${p.hour}:${p.minute}`; };
const quien = (a: Accion) => a.persona || a.email || 'el sistema';
// Antes de este arreglo (despliegue de 2026-10-27 13:23 UTC) guardar desde una
// pantalla abierta antes de la aprobación devolvía la cotización a pendiente.
const ARREGLO_ESTADO_VIEJO = '2026-10-27T13:23:00Z';

export type ResumenAcciones = { tono: 'alerta' | 'info'; puntos: string[] };

/* (2026-10-27) «No se entiende nada este historial… no ayuda a determinar la
   razón» (Ariel). Además de la lista, se explica en palabras y con datos:
   estado actual, por qué quedó pendiente (qué producto no tenía peso y quién
   lo completó), quién aprobó, por qué volvió a pendiente (desde qué pantalla
   se guardó: `lecturas` son las aperturas de la cotización, GET
   /api/licitaciones/:id) y qué falta. Recibe las acciones ordenadas y con
   nombres; marca como `reversion` el guardado que deshizo una aprobación. */
export function explicarAcciones(
  acciones: Accion[],
  estadoActual: string | null,
  ctx?: { lecturas?: { created_at: string; usuario_email: string | null }[] },
): { acciones: Accion[]; resumen: ResumenAcciones | null } {
  const t = (s: string) => new Date(s).getTime();
  let aprobacion: Accion | null = null;
  let pendiente = false;
  let entradaPeso: Accion | null = null;
  let deshecha: { aprobacion: Accion; por: Accion; abierta: string | null } | null = null;

  for (const a of acciones) {
    if (a.accion === 'aprobacion') {
      aprobacion = a;
      pendiente = false;
      deshecha = null;
      continue;
    }
    if (a.accion === 'motivo') {
      if (!entradaPeso) entradaPeso = a;
      continue;
    }
    if (a.accion !== 'estado') continue;
    const m = a.detalle.match(/(?:→|en) «(Pendiente Aprobación(?: Peso)?)»/);
    if (!m) {
      if (/→ «/.test(a.detalle)) pendiente = false; // pasó a un estado que no es pendiente
      continue;
    }
    if (m[1] === 'Pendiente Aprobación Peso' && !entradaPeso && !aprobacion) entradaPeso = a;
    if (aprobacion && !pendiente) {
      // ¿Desde qué pantalla guardó? La última vez que abrió la cotización antes de guardar.
      const abierta =
        (ctx?.lecturas || [])
          .filter((l) => String(l.usuario_email || '').toLowerCase() === a.email && t(l.created_at) <= t(a.fecha))
          .map((l) => l.created_at)
          .sort()
          .pop() || null;
      const vieja = abierta && t(abierta) < t(aprobacion.fecha) ? abierta : null;
      a.accion = 'reversion';
      a.detalle = vieja
        ? `Guardó desde la pantalla que abrió a las ${horaChile(vieja)}, antes de la aprobación, que todavía decía «${m[1]}»: ese estado quedó encima y se deshizo la aprobación de ${quien(aprobacion)} de las ${horaChile(aprobacion.fecha)}`
        : `Al guardar, la cotización volvió a «${m[1]}»: se deshizo la aprobación de ${quien(aprobacion)} de las ${horaChile(aprobacion.fecha)}`;
      deshecha = { aprobacion, por: a, abierta: vieja };
    } else if (pendiente && a.origen === 'acceso' && a.detalle.startsWith('Guardó')) {
      a.detalle = `Guardó la cotización; siguió en «${m[1]}»`;
    }
    pendiente = true;
  }

  const estado = String(estadoActual || '').trim();
  if (!estado) return { acciones, resumen: null };
  const puntos: string[] = [`Estado actual: «${estado}».`];

  // Por qué quedó esperando aprobación por peso.
  if (entradaPeso) {
    const cuando = entradaPeso.accion === 'motivo' || !acciones.some((a) => a.accion === 'creacion' && t(entradaPeso!.fecha) - t(a.fecha) <= 120_000)
      ? `el ${fechaHoraChile(entradaPeso.fecha)}`
      : `al crearla (${fechaHoraChile(entradaPeso.fecha)})`;
    const editados = acciones.filter((a) => a.accion === 'producto' && t(a.fecha) >= t(entradaPeso!.fecha) && (!aprobacion || t(a.fecha) <= t(aprobacion.fecha) + 600_000));
    if (entradaPeso.accion === 'motivo') {
      puntos.push(`Por qué quedó en peso: ${entradaPeso.detalle.replace(/^Quedó en «Pendiente Aprobación Peso» porque /, '')} (${fechaHoraChile(entradaPeso.fecha)}).`);
    } else if (editados.length) {
      const e = editados[0];
      const prod = (e.detalle.match(/producto («[^»]+»)/) || [])[1] || 'un producto';
      const pesoHoy = (e.detalle.match(/hoy pesa ([^)]+)\)$/) || [])[1] || '';
      puntos.push(
        `Por qué quedó en peso: ${cuando} algún producto no tenía peso. El sistema de entonces no anotó cuál, pero después ${quien(e)} editó ${prod} ` +
          `(${fechaHoraChile(e.fecha)}${pesoHoy ? `; hoy pesa ${pesoHoy}` : ''}), así que lo más probable es que fuera ese.`,
      );
    } else {
      puntos.push(`Por qué quedó en peso: ${cuando} algún producto de la cotización no tenía peso registrado.`);
    }
  }

  if (aprobacion) puntos.push(`${quien(aprobacion)} la aprobó el ${fechaHoraChile(aprobacion.fecha)}.`);

  if (deshecha) {
    const { por, abierta } = deshecha;
    const m = por.detalle.match(/«(Pendiente Aprobación(?: Peso)?)»/);
    const pend = m ? m[1] : 'pendiente';
    puntos.push(
      abierta
        ? `Por qué volvió a pendiente: ${quien(por)} tenía la cotización abierta desde las ${horaChile(abierta)}, antes de la aprobación, y la guardó a las ${horaChile(por.fecha)} desde esa misma pantalla. La pantalla todavía decía «${pend}», y al guardar ese estado quedó encima de la aprobación.`
        : `Por qué volvió a pendiente: ${quien(por)} guardó la cotización a las ${horaChile(por.fecha)} y volvió a quedar en «${pend}».`,
    );
    if (t(por.fecha) < t(ARREGLO_ESTADO_VIEJO)) puntos.push('Esto ya está corregido desde el 27-10-2026: al guardar, la pantalla lee el estado actual y no deshace una aprobación.');
  }

  const pendienteHoy = estado.startsWith('Pendiente Aprobación');
  if (pendienteHoy) {
    const boton = estado === 'Pendiente Aprobación Peso' ? '«Aprobar peso»' : '«Aprobar»';
    puntos.push(deshecha ? `Falta: aprobarla otra vez con ${boton}.` : `Falta: que un administrador la apruebe con ${boton}.`);
  }
  return { acciones, resumen: { tono: deshecha && pendienteHoy ? 'alerta' : 'info', puntos } };
}
