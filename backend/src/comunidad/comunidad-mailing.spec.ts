import { elegirDestinatarios, enlaceBaja, estadoDeEnvio, htmlMailing, leerEnlaceBaja, nombreParaSaludo, personalizar, validarContenido } from './comunidad-mailing';

describe('Mailing a la Comunidad', () => {
  const fila = (ref: string, correo: string, extra: Record<string, any> = {}): any => ({ ref, correo, nombre: 'Ana María', fuente: 'comunidad', perfil: 'dentista', categoria: 'doctor_particular', ...extra });
  const filas = [
    fila('comunidad:1', 'ana@x.cl', { categoria: 'estudiante' }),
    fila('sorteo:2', 'LUIS@x.cl ', { nombre: 'LUIS SOTO' }),
    fila('evento:3', '', { nombre: 'Sin Correo' }),
    fila('comunidad:4', 'no-es-correo', { nombre: 'Malo' }),
    fila('comunidad:5', 'contacto@clinica.cl', { nombre: 'Clínica Sonrisa', fuente: 'rastreo', perfil: 'clinica', categoria: 'cliente_rastreado' }),
    fila('comunidad:6', 'contacto@clinica.cl', { nombre: 'Clínica Sonrisa Sucursal', fuente: 'rastreo', perfil: 'clinica', categoria: 'cliente_rastreado' }),
    fila('comunidad:7', 'baja@x.cl', { nombre: 'Pedro' }),
    fila('evento:8', 'contacto@clinica.cl', { nombre: 'carla rojas' }),
  ];

  it('le llega una vez a cada correo válido y dice por qué no a los demás', () => {
    const r = elegirDestinatarios(filas, null, ['BAJA@x.cl']);
    expect(r.filas).toBe(8);
    expect(r.destinatarios.map((d) => d.correo)).toEqual(['ana@x.cl', 'luis@x.cl', 'contacto@clinica.cl']);
    expect(r.excluidos).toEqual({ sin_correo: 1, correo_invalido: 1, repetidos: 2, de_baja: 1, no_encontradas: 0 });
    // Si una persona y una clínica comparten correo, el saludo es para la persona.
    expect(r.destinatarios[2].nombre).toBe('Carla');
    expect(r.por_categoria).toEqual([{ clave: 'estudiante', nombre: 'Estudiante', n: 1 }, { clave: 'doctor_particular', nombre: 'Doctor Particular', n: 2 }]);
  });

  it('respeta las filas elegidas y avisa de las que ya no existen', () => {
    const r = elegirDestinatarios(filas, ['comunidad:1', 'comunidad:5', 'sorteo:999'], []);
    expect(r.destinatarios.map((d) => d.correo)).toEqual(['ana@x.cl', 'contacto@clinica.cl']);
    expect(r.destinatarios[1].nombre).toBe('Clínica Sonrisa');
    expect(r.excluidos.no_encontradas).toBe(1);
  });

  it('saluda por el primer nombre y arregla mayúsculas', () => {
    expect(nombreParaSaludo({ nombre: 'ana maría pérez', fuente: 'sorteo', perfil: 'dentista' } as any)).toBe('Ana');
    expect(nombreParaSaludo({ nombre: 'LUIS SOTO', fuente: 'evento', perfil: 'dentista' } as any)).toBe('Luis');
    expect(nombreParaSaludo({ nombre: 'McKenzie Soto', fuente: 'comunidad', perfil: 'dentista' } as any)).toBe('McKenzie');
    expect(nombreParaSaludo({ nombre: 'Clínica Dental Fenix', fuente: 'rastreo', perfil: 'clinica' } as any)).toBe('Clínica Dental Fenix');
    expect(nombreParaSaludo({ nombre: '', fuente: 'sorteo', perfil: null } as any)).toBe('');
  });

  it('personaliza el mensaje y no deja el saludo cojo cuando falta el nombre', () => {
    expect(personalizar('Hola {nombre}:\nTe invitamos, { Nombre }.', 'Ana')).toBe('Hola Ana:\nTe invitamos, Ana.');
    expect(personalizar('Hola {nombre}:\n{nombre}, te invitamos.', '')).toBe('Hola:\nte invitamos.');
  });

  it('valida el contenido: asunto, mensaje o imagen, y el botón con su link', () => {
    expect(validarContenido({ asunto: '', mensaje: '' }).problemas).toEqual(['Escribe el asunto del correo.', 'Escribe el mensaje (o adjunta una imagen).']);
    expect(validarContenido({ asunto: 'Promo', mensaje: '', con_imagen: 'true' }).problemas).toEqual([]);
    expect(validarContenido({ asunto: 'Promo', mensaje: 'Hola', boton_texto: 'Ver' }).problemas).toEqual(['El botón necesita su link.']);
    expect(validarContenido({ asunto: 'Promo', mensaje: 'Hola', boton_url: 'amsodentmedical.cl' }).problemas).toEqual(['Escribe el texto del botón (o borra su link).']);
    expect(validarContenido({ asunto: 'Promo', mensaje: 'Hola', boton_texto: 'Ver', boton_url: 'javascript:alert(1)' }).problemas[0]).toMatch(/no es una dirección web válida/);
    const ok = validarContenido({ asunto: '  Promo   de  noviembre ', mensaje: 'Hola', boton_texto: 'Ver ofertas', boton_url: 'amsodentmedical.cl/ofertas' });
    expect(ok.problemas).toEqual([]);
    expect(ok.contenido).toMatchObject({ asunto: 'Promo de noviembre', boton_url: 'https://amsodentmedical.cl/ofertas' });
  });

  it('arma el correo con el saludo, el botón, la imagen y el enlace de baja, sin dejar pasar HTML', () => {
    const { contenido } = validarContenido({ asunto: 'Promo', mensaje: 'Hola {nombre}:\n\n<script>x</script> Mira https://amsodentmedical.cl/ofertas.', boton_texto: 'Ver', boton_url: 'https://a.cl/?a=1&b=2', con_imagen: true, imagen_url: 'a.cl' });
    const html = htmlMailing(contenido, { nombre: 'Ana' }, { logoUrl: 'https://app/logo.png', urlBaja: 'https://app/comunidad/baja?c=x&f=y', anio: 2026 });
    expect(html).toContain('Hola Ana:');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<a href="https://amsodentmedical.cl/ofertas" target="_blank"');
    expect(html).toContain('href="https://a.cl/?a=1&amp;b=2"');
    expect(html).toContain('cid:imagen-comunidad');
    expect(html).toContain('<a href="https://a.cl/" target="_blank" style="text-decoration:none;"><img');
    expect(html).toContain('date de baja aquí');
    const sinBaja = htmlMailing(contenido, { nombre: '' }, { logoUrl: 'l', urlBaja: null });
    expect(sinBaja).toContain('responde este mensaje con la palabra BAJA');
    expect(sinBaja).toContain('Hola:');
  });

  it('el enlace de baja solo sirve para el correo que lo recibió', () => {
    const url = enlaceBaja('https://app.cl/', 'Ana@X.cl', 'secreto');
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://app.cl/comunidad/baja?c=')).toBe(true);
    expect(leerEnlaceBaja(q.get('c'), q.get('f'), 'secreto')).toBe('ana@x.cl');
    expect(leerEnlaceBaja(q.get('c'), q.get('f'), 'otro-secreto')).toBeNull();
    const otro = new URL(enlaceBaja('https://app.cl', 'luis@x.cl', 'secreto')).searchParams;
    expect(leerEnlaceBaja(otro.get('c'), q.get('f'), 'secreto')).toBeNull();
    expect(leerEnlaceBaja('', '', 'secreto')).toBeNull();
    expect(leerEnlaceBaja('%%%', 'abc', 'secreto')).toBeNull();
  });

  it('resume cómo va un envío', () => {
    const d = [{ enviado_at: 'x', abierto_at: 'y' }, { enviado_at: 'x' }, { fallo: '550' }, {}];
    expect(estadoDeEnvio(4, d, true)).toEqual({ enviados: 2, fallidos: 1, abiertos: 1, pendientes: 1, estado: 'enviando' });
    expect(estadoDeEnvio(4, d, false).estado).toBe('interrumpido');
    expect(estadoDeEnvio(3, d.slice(0, 3), false).estado).toBe('terminado');
    expect(estadoDeEnvio(1, [{ fallo: 'x' }], false).estado).toBe('fallido');
  });
});
