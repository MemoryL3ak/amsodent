import {
  ACCIONES,
  CATEGORIAS,
  ESTADOS,
  LIMITE_PORTAL_24H,
  correoValido,
  documentoCalzaConAccion,
  esAbierta,
  esAccion,
  esCategoria,
  esCierre,
  esEstado,
  formatearRut,
  gestionesParaCliente,
  limpiarProductos,
  mensajeAvisoCliente,
  mensajeAvisoNueva,
  normalizarRut,
  puedeTransicionar,
  puedeVer,
  sinTabla,
  solicitudParaCliente,
  superaLimite,
  tipoAfectadoDe,
  validarNueva,
  veTodas,
  vendedorAlCrear,
  vendedorPropuesto,
  visibleCliente,
  visibleClientePorDefecto,
} from './postventa.reglas';

describe('Postventa: catálogos', () => {
  it('trae las 8 categorías del pedido, en su orden', () => {
    expect(CATEGORIAS.map((c) => c.nombre)).toEqual([
      'Productos en mal estado',
      'Fecha de vencimiento',
      'Producto no corresponde',
      'Faltan cantidades',
      'Sobran cantidades',
      'Cambio a petición del cliente',
      'Gestión de apelación de multa',
      'Otros',
    ]);
  });

  it('valida categoría, estado y acción por su clave', () => {
    expect(esCategoria('faltan_cantidades')).toBe(true);
    expect(esCategoria('Faltan cantidades')).toBe(false);
    expect(esCategoria(undefined)).toBe(false);
    expect(ESTADOS.map((e) => e.clave)).toEqual(['ingresada', 'en_gestion', 'resuelta', 'rechazada']);
    expect(esEstado('en_gestion')).toBe(true);
    expect(esEstado('cerrada')).toBe(false);
    expect(ACCIONES.map((a) => a.clave)).toEqual(['nota_credito', 'factura', 'guia_despacho']);
    expect(esAccion('nota_credito')).toBe(true);
    expect(esAccion('comentario')).toBe(false);
  });
});

describe('Postventa: RUT y correo', () => {
  it('normaliza el RUT a dígitos y k minúscula', () => {
    expect(normalizarRut('76.123.456-K')).toBe('76123456k');
    expect(normalizarRut(' 12345678-5 ')).toBe('123456785');
    expect(normalizarRut(null)).toBe('');
  });

  it('formatea el RUT para mostrar', () => {
    expect(formatearRut('76123456k')).toBe('76.123.456-K');
    expect(formatearRut('9.876.543-2')).toBe('9.876.543-2');
    expect(formatearRut('')).toBe('');
  });

  it('acepta solo correos con forma de correo, en minúsculas', () => {
    expect(correoValido(' Ventas@AmsodentMedical.cl ')).toBe('ventas@amsodentmedical.cl');
    expect(correoValido('sin-arroba')).toBeNull();
    expect(correoValido('a@b.cl,otro')).toBeNull();
    expect(correoValido('a"b@c.cl')).toBeNull();
    expect(correoValido(null)).toBeNull();
  });
});

describe('Postventa: transiciones de estado', () => {
  it('ingresada se toma o se cierra', () => {
    expect(puedeTransicionar('ingresada', 'en_gestion')).toBe(true);
    expect(puedeTransicionar('ingresada', 'resuelta')).toBe(true);
    expect(puedeTransicionar('ingresada', 'rechazada')).toBe(true);
  });

  it('en gestión solo se cierra', () => {
    expect(puedeTransicionar('en_gestion', 'resuelta')).toBe(true);
    expect(puedeTransicionar('en_gestion', 'rechazada')).toBe(true);
    expect(puedeTransicionar('en_gestion', 'ingresada')).toBe(false);
  });

  it('una cerrada solo se reabre a en gestión', () => {
    expect(puedeTransicionar('resuelta', 'en_gestion')).toBe(true);
    expect(puedeTransicionar('rechazada', 'en_gestion')).toBe(true);
    expect(puedeTransicionar('resuelta', 'rechazada')).toBe(false);
    expect(puedeTransicionar('rechazada', 'ingresada')).toBe(false);
  });

  it('no hay transición al mismo estado ni con estados desconocidos', () => {
    expect(puedeTransicionar('en_gestion', 'en_gestion')).toBe(false);
    expect(puedeTransicionar('ingresada', 'archivada')).toBe(false);
    expect(puedeTransicionar(undefined, 'resuelta')).toBe(false);
  });

  it('distingue abiertas de cerradas', () => {
    expect(esAbierta('ingresada')).toBe(true);
    expect(esAbierta('en_gestion')).toBe(true);
    expect(esAbierta('resuelta')).toBe(false);
    expect(esCierre('rechazada')).toBe(true);
    expect(esCierre('en_gestion')).toBe(false);
  });
});

describe('Postventa: quién ve qué', () => {
  const admin = { email: 'admin@a.cl', esAdmin: true, permisos: [] };
  const jefe = { email: 'jefe@a.cl', esAdmin: false, permisos: ['postventa', 'cotizaciones_todas'] };
  const ana = { email: 'ana@a.cl', esAdmin: false, permisos: ['postventa'] };
  const sol = { vendedor_email: 'ana@a.cl', creada_por: 'luis@a.cl', origen: 'plataforma' };

  it('admin y «ver todas las cotizaciones» ven todas', () => {
    expect(veTodas(admin)).toBe(true);
    expect(veTodas(jefe)).toBe(true);
    expect(veTodas(ana)).toBe(false);
    expect(puedeVer({ vendedor_email: 'otro@a.cl', creada_por: 'otro@a.cl' }, admin)).toBe(true);
    expect(puedeVer({ vendedor_email: 'otro@a.cl', creada_por: 'otro@a.cl' }, jefe)).toBe(true);
  });

  it('un vendedor ve las que tiene a cargo y las que registró', () => {
    expect(puedeVer(sol, ana)).toBe(true);
    expect(puedeVer(sol, { email: 'LUIS@a.cl', esAdmin: false, permisos: ['postventa'] })).toBe(true);
    expect(puedeVer(sol, { email: 'pedro@a.cl', esAdmin: false, permisos: ['postventa'] })).toBe(false);
  });

  it('una solicitud sin responsable no la ve un vendedor cualquiera', () => {
    expect(puedeVer({ vendedor_email: null, creada_por: null }, ana)).toBe(false);
    expect(puedeVer({ vendedor_email: null, creada_por: null }, { email: '', esAdmin: false, permisos: [] })).toBe(false);
  });

  it('el «creada_por» de una solicitud del portal es del cliente: no da acceso', () => {
    const delPortal = { vendedor_email: 'luis@a.cl', creada_por: 'ana@a.cl', origen: 'portal' };
    expect(puedeVer(delPortal, ana)).toBe(false);
    expect(puedeVer(delPortal, { email: 'luis@a.cl', esAdmin: false, permisos: [] })).toBe(true);
  });
});

describe('Postventa: vendedor responsable', () => {
  it('propone el vendedor de la cotización, luego quien la creó, luego el de la cartera', () => {
    expect(vendedorPropuesto({ vendedorCotizacion: 'V@a.cl', creadorCotizacion: 'c@a.cl', vendedorCartera: 'k@a.cl' })).toBe('v@a.cl');
    expect(vendedorPropuesto({ vendedorCotizacion: '', creadorCotizacion: 'c@a.cl', vendedorCartera: 'k@a.cl' })).toBe('c@a.cl');
    expect(vendedorPropuesto({ vendedorCartera: 'k@a.cl' })).toBe('k@a.cl');
    expect(vendedorPropuesto({ vendedorCotizacion: 'sin correo' })).toBeNull();
  });

  it('solo un administrador puede elegir otro responsable', () => {
    expect(vendedorAlCrear({ propuesto: 'v@a.cl', pedido: 'otro@a.cl', esAdmin: true, creador: 'adm@a.cl', origen: 'plataforma' })).toBe('otro@a.cl');
    expect(vendedorAlCrear({ propuesto: 'v@a.cl', pedido: 'otro@a.cl', esAdmin: false, creador: 'ana@a.cl', origen: 'plataforma' })).toBe('v@a.cl');
    expect(vendedorAlCrear({ propuesto: 'v@a.cl', pedido: 'no es correo', esAdmin: true, creador: 'adm@a.cl', origen: 'plataforma' })).toBe('v@a.cl');
  });

  it('sin propuesta: en la plataforma queda quien la registra; en el portal, sin asignar', () => {
    expect(vendedorAlCrear({ propuesto: null, esAdmin: false, creador: 'Ana@a.cl', origen: 'plataforma' })).toBe('ana@a.cl');
    expect(vendedorAlCrear({ propuesto: null, esAdmin: false, creador: 'cliente@clinica.cl', origen: 'portal' })).toBeNull();
  });
});

describe('Postventa: productos afectados', () => {
  it('descarta filas vacías y normaliza la cantidad', () => {
    expect(
      limpiarProductos([
        { sku: ' AB-1 ', nombre: '  Resina   A2 ', cantidad: '3' },
        { sku: '', nombre: '', cantidad: 5 },
        { nombre: 'Guantes', cantidad: '2,5' },
        { sku: 'X9', cantidad: 0 },
        null,
        'texto',
      ]),
    ).toEqual([
      { sku: 'AB-1', nombre: 'Resina A2', cantidad: 3 },
      { sku: null, nombre: 'Guantes', cantidad: 2.5 },
      { sku: 'X9', nombre: 'X9', cantidad: null },
    ]);
  });

  it('acepta «producto» como nombre y tolera lo que no es una lista', () => {
    expect(limpiarProductos([{ producto: 'Fresa', cantidad: 1 }])).toEqual([{ sku: null, nombre: 'Fresa', cantidad: 1 }]);
    expect(limpiarProductos(undefined)).toEqual([]);
    expect(limpiarProductos({ sku: 'A' })).toEqual([]);
  });

  it('corta en 50 productos', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => ({ sku: `S${i}`, nombre: `P${i}`, cantidad: 1 }));
    expect(limpiarProductos(muchos)).toHaveLength(50);
  });
});

describe('Postventa: validación de una solicitud nueva', () => {
  const base = { categoria: 'producto_mal_estado', descripcion: 'Llegó la caja rota' };

  it('exige categoría válida y descripción', () => {
    expect(validarNueva({ ...base, categoria: 'inventada' })).toEqual({ error: 'Elige la categoría de la solicitud.' });
    expect(validarNueva({ ...base, descripcion: '  ok ' })).toHaveProperty('error');
    expect(validarNueva({ ...base, descripcion: 'x'.repeat(2001) })).toHaveProperty('error');
    expect(validarNueva(null)).toHaveProperty('error');
  });

  it('deja los datos limpios', () => {
    const r: any = validarNueva({ ...base, descripcion: '  Llegó la caja rota  ', licitacion_id: '12', documento_id: 7, productos: [{ sku: 'A', cantidad: 2 }], pedido_id: 'x' });
    expect(r.datos).toEqual({
      categoria: 'producto_mal_estado',
      descripcion: 'Llegó la caja rota',
      productos: [{ sku: 'A', nombre: 'A', cantidad: 2 }],
      licitacion_id: 12,
      documento_id: 7,
      documento_tipo: null,
      documento_numero: null,
      pedido_id: null,
    });
  });

  it('un número de documento escrito a mano necesita su tipo', () => {
    expect(validarNueva({ ...base, documento_numero: '1234' })).toEqual({ error: 'Indica si el documento afectado es una factura o una guía.' });
    const r: any = validarNueva({ ...base, documento_numero: ' 1234 ', documento_tipo: 'guia_despacho' });
    expect(r.datos.documento_tipo).toBe('guia_despacho');
    expect(r.datos.documento_numero).toBe('1234');
  });

  it('sin documento no guarda un tipo suelto', () => {
    const r: any = validarNueva({ ...base, documento_tipo: 'factura' });
    expect(r.datos.documento_tipo).toBeNull();
  });
});

describe('Postventa: documentos y acciones', () => {
  it('traduce el tipo guardado al tipo del documento afectado', () => {
    expect(tipoAfectadoDe('factura')).toBe('factura');
    expect(tipoAfectadoDe('factura_boleta')).toBe('factura');
    expect(tipoAfectadoDe('guia_despacho')).toBe('guia_despacho');
    expect(tipoAfectadoDe('nota_credito')).toBeNull();
    expect(tipoAfectadoDe('orden_compra')).toBeNull();
  });

  it('cada acción acepta solo su tipo de documento', () => {
    expect(documentoCalzaConAccion('nota_credito', 'nota_credito')).toBe(true);
    expect(documentoCalzaConAccion('nota_credito', 'factura')).toBe(false);
    expect(documentoCalzaConAccion('factura', 'factura')).toBe(true);
    expect(documentoCalzaConAccion('factura', 'factura_boleta')).toBe(true);
    expect(documentoCalzaConAccion('factura', 'guia_despacho')).toBe(false);
    expect(documentoCalzaConAccion('guia_despacho', 'guia_despacho')).toBe(true);
    expect(documentoCalzaConAccion('comentario', 'factura')).toBe(false);
  });
});

describe('Postventa: lo que ve el cliente', () => {
  it('los comentarios son internos salvo que se marquen; el resto se muestra', () => {
    expect(visibleClientePorDefecto('comentario')).toBe(false);
    expect(visibleClientePorDefecto('cambio_estado')).toBe(true);
    expect(visibleClientePorDefecto('nota_credito')).toBe(true);
    expect(visibleCliente('comentario')).toBe(false);
    expect(visibleCliente('comentario', true)).toBe(true);
    expect(visibleCliente('comentario', 'true')).toBe(false);
    expect(visibleCliente('guia_despacho', false)).toBe(true);
  });

  const gestiones = [
    { id: 1, tipo: 'comentario', detalle: 'Nota interna: cliente difícil', visible_cliente: false, usuario_email: 'ana@a.cl', created_at: '2026-11-26T10:00:00Z' },
    { id: 2, tipo: 'cambio_estado', detalle: 'La solicitud pasó a «En gestión».', estado_nuevo: 'en_gestion', visible_cliente: true, usuario_email: 'ana@a.cl', created_at: '2026-11-26T10:05:00Z' },
    { id: 3, tipo: 'comentario', detalle: 'Mañana retiramos la caja.', visible_cliente: true, usuario_email: 'ana@a.cl', created_at: '2026-11-26T11:00:00Z' },
    { id: 4, tipo: 'nota_credito', detalle: null, documento_numero: '182', visible_cliente: true, usuario_email: 'ana@a.cl', created_at: '2026-11-26T12:00:00Z' },
    { id: 5, tipo: 'factura', detalle: 'pendiente', visible_cliente: 'true', usuario_email: 'ana@a.cl' },
  ];

  it('entrega solo las gestiones visibles y sin quién las hizo', () => {
    const vistas = gestionesParaCliente(gestiones);
    expect(vistas.map((g) => g.id)).toEqual([2, 3, 4]);
    expect(vistas[1]).toEqual({ id: 3, tipo: 'comentario', titulo: 'Mensaje de Amsodent', detalle: 'Mañana retiramos la caja.', documento_numero: null, fecha: '2026-11-26T11:00:00Z' });
    expect(vistas[2].titulo).toBe('Emisión de nota de crédito');
    expect(JSON.stringify(vistas)).not.toContain('ana@a.cl');
    expect(JSON.stringify(vistas)).not.toContain('cliente difícil');
    expect(gestionesParaCliente(null as any)).toEqual([]);
  });

  it('la solicitud del cliente no trae responsable ni datos internos', () => {
    const sol = {
      id: 9, created_at: '2026-11-26T09:00:00Z', categoria: 'faltan_cantidades', descripcion: 'Faltan 2 cajas', estado: 'en_gestion',
      vendedor_email: 'ana@a.cl', creada_por: 'cliente@clinica.cl', creada_por_nombre: 'Marta', cliente_rut: '76123456k', tomada_por: 'ana@a.cl',
      resolucion: 'borrador interno', cerrada_at: null, productos: [{ sku: 'A', nombre: 'Guantes', cantidad: 2 }], documento_tipo: 'factura', documento_numero: '500',
    };
    const vista: any = solicitudParaCliente(sol, gestiones);
    expect(vista.categoria_nombre).toBe('Faltan cantidades');
    expect(vista.estado_nombre).toBe('En gestión');
    expect(vista.gestiones).toHaveLength(3);
    expect(vista).not.toHaveProperty('vendedor_email');
    expect(vista).not.toHaveProperty('tomada_por');
    expect(vista).not.toHaveProperty('creada_por');
    // La resolución solo se muestra cuando la solicitud está cerrada.
    expect(vista.resolucion).toBeNull();
    expect((solicitudParaCliente({ ...sol, estado: 'rechazada', resolucion: 'Fuera de plazo' }, []) as any).resolucion).toBe('Fuera de plazo');
  });
});

describe('Postventa: tope del portal y avisos', () => {
  it('corta al llegar al tope de 24 horas', () => {
    expect(superaLimite(LIMITE_PORTAL_24H - 1)).toBe(false);
    expect(superaLimite(LIMITE_PORTAL_24H)).toBe(true);
    expect(superaLimite(3, 3)).toBe(true);
  });

  it('arma el aviso al vendedor', () => {
    expect(mensajeAvisoNueva({ id: 5, categoria: 'otros', cliente_nombre: 'Clínica Sur', origen: 'plataforma' })).toBe('Solicitud de postventa N° 5 de Clínica Sur: Otros.');
    expect(mensajeAvisoNueva({ id: 6, categoria: 'apelacion_multa', cliente_rut: '76123456k', origen: 'portal' })).toBe(
      'Solicitud de postventa N° 6 de 76.123.456-K: Gestión de apelación de multa (enviada desde el portal del cliente).',
    );
  });

  it('arma el aviso al cliente según lo que pasó', () => {
    expect(mensajeAvisoCliente({ id: 5, tipo: 'cambio_estado', estado: 'en_gestion' })).toContain('en gestión');
    expect(mensajeAvisoCliente({ id: 5, tipo: 'cambio_estado', estado: 'resuelta' })).toContain('resuelta');
    expect(mensajeAvisoCliente({ id: 5, tipo: 'cambio_estado', estado: 'rechazada' })).toContain('rechazada');
    expect(mensajeAvisoCliente({ id: 5, tipo: 'comentario' })).toBe('Amsodent respondió tu solicitud de postventa N° 5.');
    expect(mensajeAvisoCliente({ id: 5, tipo: 'nota_credito', documento_numero: '182' })).toBe('Emitimos una nota de crédito N° 182 por tu solicitud de postventa N° 5.');
    expect(mensajeAvisoCliente({ id: 5, tipo: 'guia_despacho' })).toBe('Emitimos una guía de despacho por tu solicitud de postventa N° 5.');
  });

  it('reconoce el error de tabla sin migrar', () => {
    expect(sinTabla({ code: 'PGRST205', message: "Could not find the table 'public.postventa_solicitudes' in the schema cache" })).toBe(true);
    expect(sinTabla({ code: '42P01', message: 'relation "public.postventa_gestiones" does not exist' })).toBe(true);
    expect(sinTabla({ code: '23514', message: 'new row violates check constraint' })).toBe(false);
    expect(sinTabla(null)).toBe(false);
  });
});
