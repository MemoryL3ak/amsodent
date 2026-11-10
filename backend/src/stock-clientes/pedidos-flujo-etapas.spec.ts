import {
  CAMINO,
  CERRADOS,
  ESTADOS_OBSERVABLES,
  ESTADOS_VALIDABLES,
  LIMPIEZA_MODIFICACION,
  TODOS,
  columnaFaltante,
  esCerrado,
  estadoAlReabrir,
  etapaAnterior,
  etiquetaEstado,
} from './pedidos-flujo-etapas';

/* Etapas del pedido del portal (2026-11-09): el camino feliz con sus paradas
   intermedias, la reversa y la reapertura. */

describe('etapas', () => {
  it('el camino feliz va del envío al pago pasando por revisión y cotización', () => {
    expect(CAMINO).toEqual([
      'pendiente_aprobacion',
      'aprobado_cliente',
      'en_revision',
      'cotizacion_enviada',
      'validado_plataforma',
      'pagado',
    ]);
    expect(TODOS).toHaveLength(9);
  });

  it('solo pagado, rechazado y cancelado cierran el pedido', () => {
    expect(CERRADOS).toEqual(['pagado', 'rechazado', 'cancelado']);
    expect(esCerrado('pagado')).toBe(true);
    expect(esCerrado('observado')).toBe(false);
    expect(esCerrado(null)).toBe(false);
  });

  it('se puede validar desde cualquier etapa de Amsodent, incluso con una observación abierta', () => {
    for (const e of ['aprobado_cliente', 'en_revision', 'cotizacion_enviada', 'observado', 'validado_plataforma']) {
      expect(ESTADOS_VALIDABLES).toContain(e);
    }
    expect(ESTADOS_VALIDABLES).not.toContain('pendiente_aprobacion');
    expect(ESTADOS_VALIDABLES).not.toContain('pagado');
  });

  it('una observación no se abre sobre un pedido ya validado ni cerrado', () => {
    expect(ESTADOS_OBSERVABLES).not.toContain('validado_plataforma');
    expect(ESTADOS_OBSERVABLES).not.toContain('pagado');
    expect(ESTADOS_OBSERVABLES).toContain('cotizacion_enviada');
  });

  it('toda etapa tiene etiqueta y las desconocidas vuelven tal cual', () => {
    for (const e of TODOS) expect(etiquetaEstado(e)).not.toBe(e);
    expect(etiquetaEstado('loquesea')).toBe('loquesea');
  });
});

describe('etapaAnterior', () => {
  it('desde validado vuelve a la cotización si la hay, o a revisión, y limpia la validación', () => {
    const conCot = etapaAnterior({ flujo_estado: 'validado_plataforma', licitacion_id: 55 });
    expect(conCot?.destino).toBe('cotizacion_enviada');
    expect(conCot?.limpieza).toMatchObject({ validado_at: null, monto_total: null, pago_link: null, disponibilidad: null });

    const sinCot = etapaAnterior({ flujo_estado: 'validado_plataforma', licitacion_id: null });
    expect(sinCot?.destino).toBe('en_revision');
  });

  it('cada etapa intermedia retrocede una y borra solo lo suyo', () => {
    expect(etapaAnterior({ flujo_estado: 'cotizacion_enviada' })).toEqual({
      destino: 'en_revision',
      limpieza: { cotizacion_enviada_at: null, cotizacion_enviada_por: null },
    });
    const obs = etapaAnterior({ flujo_estado: 'observado' });
    expect(obs?.destino).toBe('en_revision');
    expect(Object.keys(obs!.limpieza)).toEqual(
      expect.arrayContaining(['observacion_at', 'observacion_texto', 'observacion_respondida_at']),
    );
    expect(etapaAnterior({ flujo_estado: 'en_revision' })).toEqual({
      destino: 'aprobado_cliente',
      limpieza: { revision_iniciada_at: null, revision_por: null },
    });
    expect(etapaAnterior({ flujo_estado: 'aprobado_cliente' })).toEqual({
      destino: 'pendiente_aprobacion',
      limpieza: { aprobado_cliente_at: null, aprobado_cliente_por: null },
    });
  });

  it('no hay paso atrás desde la primera etapa ni desde un pedido cerrado', () => {
    expect(etapaAnterior({ flujo_estado: 'pendiente_aprobacion' })).toBeNull();
    expect(etapaAnterior({ flujo_estado: null })).toBeNull();
    for (const e of CERRADOS) expect(etapaAnterior({ flujo_estado: e })).toBeNull();
  });
});

describe('modificación del cliente', () => {
  it('borra lo que Amsodent había avanzado pero no la aprobación', () => {
    expect(LIMPIEZA_MODIFICACION).toMatchObject({
      revision_iniciada_at: null,
      cotizacion_enviada_at: null,
      observacion_texto: null,
      validado_at: null,
      monto_total: null,
    });
    expect(LIMPIEZA_MODIFICACION).not.toHaveProperty('aprobado_cliente_at');
    expect(LIMPIEZA_MODIFICACION).not.toHaveProperty('licitacion_id');
  });
});

describe('estadoAlReabrir', () => {
  it('vuelve a la última etapa alcanzada según las marcas del pedido', () => {
    expect(estadoAlReabrir({})).toBe('pendiente_aprobacion');
    expect(estadoAlReabrir({ aprobado_cliente_at: 'x' })).toBe('aprobado_cliente');
    expect(estadoAlReabrir({ aprobado_cliente_at: 'x', revision_iniciada_at: 'x' })).toBe('en_revision');
    expect(estadoAlReabrir({ aprobado_cliente_at: 'x', licitacion_id: 9 })).toBe('cotizacion_enviada');
    expect(estadoAlReabrir({ aprobado_cliente_at: 'x', licitacion_id: 9, validado_at: 'x' })).toBe('validado_plataforma');
  });
});

describe('columnaFaltante', () => {
  it('reconoce el error de PostgREST al actualizar y el de Postgres al leer', () => {
    expect(columnaFaltante("Could not find the 'revision_por' column of 'stock_solicitudes_cotizacion' in the schema cache")).toBe('revision_por');
    expect(columnaFaltante('column stock_solicitudes_cotizacion.observacion_texto does not exist')).toBe('observacion_texto');
    expect(columnaFaltante('column "rechazo_motivo" does not exist')).toBe('rechazo_motivo');
  });
  it('otros errores no son una columna faltante', () => {
    expect(columnaFaltante('new row violates check constraint "stock_solicitudes_flujo_chk"')).toBeNull();
    expect(columnaFaltante('')).toBeNull();
  });
});
