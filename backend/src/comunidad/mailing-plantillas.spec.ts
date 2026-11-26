import { validarContenido } from './comunidad-mailing';
import { CLAVES_PLANTILLA, MAX_PRODUCTOS, catalogoPlantillas, htmlPlantilla, leerDatosPlantilla, nombreDePlantilla, plantillaUsaNombre, validarPlantilla } from './mailing-plantillas';

describe('Plantillas de campaña del mailing', () => {
  const LOGO = 'https://app.cl/logo-amsodent.png';
  const catalogo = catalogoPlantillas({ appUrl: 'https://app.cl', logoUrl: LOGO, anio: 2026 });
  const marco = { logoUrl: LOGO, urlBaja: 'https://app.cl/comunidad/baja?c=x&f=y', anio: 2026 };

  // Un formulario lleno «de verdad» para cada plantilla: todos sus campos con texto reconocible.
  const lleno = (clave: string, con: (campo: any) => any = () => undefined): Record<string, any> => {
    const p = catalogo.find((x) => x.clave === clave)!;
    return Object.fromEntries(p.campos.map((c) => {
      const propio = con(c);
      if (propio !== undefined) return [c.clave, propio];
      if (c.tipo === 'url') return [c.clave, `https://sitio.cl/${c.clave}`];
      if (c.tipo === 'lineas') return [c.clave, `Primera de ${c.clave}\n\n  Segunda de ${c.clave}  `];
      if (c.tipo === 'productos') return [c.clave, [{ nombre: 'Producto Uno', descripcion: 'Descripción uno', precio: '$1.000', imagen: 'https://sitio.cl/uno.jpg', enlace: 'sitio.cl/uno' }]];
      if (c.tipo === 'parrafo') return [c.clave, `Hola {nombre}:\n\nTexto de ${c.clave}.`];
      return [c.clave, `Valor de ${c.clave}`];
    }));
  };

  it('trae los seis tipos pedidos, en orden, cada uno con sus campos y su miniatura', () => {
    expect(catalogo.map((p) => p.clave)).toEqual(['presentacion_plataforma', 'productos_nuevos', 'lanzamiento_marca', 'workshop', 'hands_on', 'descuentos']);
    expect(CLAVES_PLANTILLA).toEqual(catalogo.map((p) => p.clave));
    expect(catalogo.map((p) => p.nombre)).toEqual([
      'Presentación de la plataforma', 'Presentación de productos nuevos', 'Lanzamiento de marca', 'Invitación a workshop', 'Invitación a hands-on', 'Campaña de descuentos',
    ]);
    const claves = (c: string) => catalogo.find((p) => p.clave === c)!.campos.map((x) => x.clave);
    for (const actividad of ['workshop', 'hands_on']) expect(claves(actividad)).toEqual(expect.arrayContaining(['actividad', 'fecha', 'hora', 'lugar', 'cupos', 'boton_url']));
    expect(claves('productos_nuevos')).toContain('productos');
    expect(claves('descuentos')).toEqual(expect.arrayContaining(['oferta', 'vigencia', 'codigo']));
    expect(claves('lanzamiento_marca')).toEqual(expect.arrayContaining(['marca', 'texto', 'boton_url']));
    for (const p of catalogo) {
      expect(p.asunto.length).toBeGreaterThan(5);
      expect(p.html_ejemplo).toContain(LOGO);
      expect(p.html_ejemplo).toContain('width="600"');
    }
  });

  it('el formulario parte con la redacción general, pero sin fechas, lugares, precios, códigos ni enlaces inventados', () => {
    for (const p of catalogo) {
      for (const c of p.campos) {
        if (c.tipo === 'url') expect(p.inicial[c.clave]).toBe('');
        if (c.tipo === 'productos') expect(p.inicial[c.clave]).toEqual([]);
      }
      expect(String(p.inicial.texto)).toContain('{nombre}');
    }
    const w = catalogo.find((p) => p.clave === 'workshop')!;
    expect([w.inicial.actividad, w.inicial.fecha, w.inicial.hora, w.inicial.lugar, w.inicial.cupos]).toEqual(['', '', '', '', '']);
    const d = catalogo.find((p) => p.clave === 'descuentos')!;
    expect([d.inicial.oferta, d.inicial.vigencia, d.inicial.codigo]).toEqual(['', '', '']);
    // Por eso una plantilla recién elegida todavía no se puede enviar: dice qué falta.
    expect(validarPlantilla('workshop', w.inicial).problemas).toEqual([
      'Falta completar «Nombre de la actividad».', 'Falta completar «Fecha».', 'Falta completar «Lugar».', 'Falta completar «Link de inscripción».',
    ]);
    expect(validarPlantilla('productos_nuevos', catalogo.find((p) => p.clave === 'productos_nuevos')!.inicial).problemas).toEqual(['Agrega al menos un producto.', 'Falta completar «Link del botón».']);
  });

  it.each(['presentacion_plataforma', 'productos_nuevos', 'lanzamiento_marca', 'workshop', 'hands_on', 'descuentos'])('%s: arma el correo completo sin dejar marcadores ni huecos', (clave) => {
    const v = validarPlantilla(clave, lleno(clave));
    expect(v.problemas).toEqual([]);
    const html = htmlPlantilla(clave, v.datos, { nombre: 'Ana' }, { ...marco, conImagen: true, imagenUrl: 'https://sitio.cl/flyer' });
    // Nada sin reemplazar.
    expect(html).not.toMatch(/\{\s*nombre\s*\}/i);
    expect(html).not.toMatch(/undefined|\[object |NaN|\{\{|\}\}|\$\{/);
    expect(html).not.toMatch(/>\s*null\s*</);
    expect(html).toContain('Hola Ana:');
    // Todo lo escrito aparece.
    const p = catalogo.find((x) => x.clave === clave)!;
    for (const c of p.campos) {
      if (c.tipo === 'texto') expect(html).toContain(`Valor de ${c.clave}`);
      if (c.tipo === 'parrafo') expect(html).toContain(`Texto de ${c.clave}.`);
      if (c.tipo === 'lineas') { expect(html).toContain(`Primera de ${c.clave}`); expect(html).toContain(`Segunda de ${c.clave}`); }
      if (c.tipo === 'url') expect(html).toContain(`https://sitio.cl/${c.clave}`);
      if (c.tipo === 'productos') { expect(html).toContain('Producto Uno'); expect(html).toContain('$1.000'); expect(html).toContain('src="https://sitio.cl/uno.jpg"'); expect(html).toContain('href="https://sitio.cl/uno"'); }
    }
    // Marco: logo propio, botón con su link, imagen adjunta pinchable y baja.
    expect(html).toContain(`<img src="${LOGO}" alt="AMSODENT"`);
    expect(html).toContain('href="https://sitio.cl/boton_url"');
    expect(html).toContain('cid:imagen-comunidad');
    expect(html).toContain('<a href="https://sitio.cl/flyer" target="_blank" style="text-decoration:none;"><img');
    expect(html).toContain('date de baja aquí');
    expect(html).toContain('href="https://app.cl/comunidad/baja?c=x&amp;f=y"');
    // Correo «a la antigua»: tablas y estilos en línea; sin scripts, hojas de estilo ni fuentes de afuera.
    expect(html).toContain('<table role="presentation" width="600"');
    expect(html).not.toMatch(/<script|<style|<link|@import|@font-face|javascript:|\son[a-z]+=/i);
    expect(html).not.toContain('amsodentmedical.cl');
  });

  it.each(CLAVES_PLANTILLA)('%s: lo que escribe la persona sale escapado, en todos los campos', (clave) => {
    const malo = '<script>alert(1)</script> "comillas" & <b>negrita</b>';
    const v = validarPlantilla(clave, lleno(clave, (c) => (c.tipo === 'texto' || c.tipo === 'parrafo' || c.tipo === 'lineas' ? malo : c.tipo === 'productos' ? [{ nombre: malo, descripcion: malo, precio: malo, imagen: 'https://sitio.cl/a.jpg?x="><script>', enlace: '' }] : undefined)));
    const html = htmlPlantilla(clave, v.datos, { nombre: '<img src=x onerror=alert(1)>' }, marco);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>negrita');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/"comillas"/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;comillas&quot; &amp; &lt;b&gt;negrita&lt;/b&gt;');
  });

  it('los enlaces solo pueden ser direcciones web: lo demás se rechaza y no llega al correo', () => {
    const v = validarPlantilla('workshop', lleno('workshop', (c) => (c.clave === 'boton_url' ? 'javascript:alert(1)' : undefined)));
    expect(v.problemas).toEqual(['«Link de inscripción» no es una dirección web válida.']);
    const html = htmlPlantilla('workshop', v.datos, { nombre: 'Ana' }, marco);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Valor de boton_texto'); // sin link no hay botón en el correo real
    // Una dirección sin https:// se completa.
    expect(validarPlantilla('workshop', lleno('workshop', (c) => (c.clave === 'boton_url' ? 'amsodent.cl/inscripcion' : undefined))).datos.boton_url).toBe('https://amsodent.cl/inscripcion');
    const p = validarPlantilla('productos_nuevos', lleno('productos_nuevos', (c) => (c.tipo === 'productos' ? [{ nombre: 'Uno', imagen: 'data:image/png;base64,AAAA', enlace: 'ftp://x.cl/a' }] : undefined)));
    expect(p.problemas).toEqual(['La imagen del producto 1 no es una dirección web válida.', 'El link del producto 1 no es una dirección web válida.']);
    expect(p.datos.productos[0]).toMatchObject({ nombre: 'Uno', imagen: null, enlace: null });
  });

  it('productos: las tarjetas en blanco no cuentan, el nombre es obligatorio y hay un tope', () => {
    const con = (productos: any[]) => validarPlantilla('productos_nuevos', lleno('productos_nuevos', (c) => (c.tipo === 'productos' ? productos : undefined)));
    expect(con([{ nombre: '  ' }, { nombre: 'Resina', precio: ' $9.990 ' }, {}]).datos.productos).toEqual([{ nombre: 'Resina', descripcion: '', precio: '$9.990', imagen: null, enlace: null }]);
    expect(con([{ nombre: '', precio: '$1' }]).problemas).toEqual(['Al producto 1 le falta el nombre.']);
    expect(con([]).problemas).toEqual(['Agrega al menos un producto.']);
    expect(con(Array.from({ length: 20 }, (_, i) => ({ nombre: `P${i}` }))).datos.productos).toHaveLength(MAX_PRODUCTOS);
    // Un producto sin imagen ni precio no deja celdas vacías ni imágenes rotas.
    const html = htmlPlantilla('productos_nuevos', con([{ nombre: 'Solo nombre' }]).datos, { nombre: 'Ana' }, marco);
    expect(html).toContain('Solo nombre');
    expect(html).not.toContain('Ver producto');
    expect(html.match(/<img /g)).toHaveLength(1); // solo el logo
  });

  it('lo opcional que queda vacío simplemente no se dibuja', () => {
    const v = validarPlantilla('descuentos', { oferta: '20 % de descuento', boton_texto: 'Ver', boton_url: 'a.cl', texto: 'Hola {nombre}:\n\nAprovecha.' });
    expect(v.problemas).toEqual([]);
    const html = htmlPlantilla('descuentos', v.datos, { nombre: '' }, { logoUrl: LOGO, urlBaja: null });
    expect(html).toContain('20 % de descuento');
    expect(html).not.toContain('Tu código');
    expect(html).toContain('Hola:'); // sin nombre el saludo no queda cojo
    expect(html).not.toMatch(/\{\s*nombre\s*\}/i);
    expect(html).toContain('responde este mensaje con la palabra BAJA');
    expect(html).not.toContain('cid:');
    const taller = validarPlantilla('workshop', lleno('workshop', (c) => (['hora', 'cupos', 'relator'].includes(c.clave) ? '' : undefined)));
    const htmlTaller = htmlPlantilla('workshop', taller.datos, { nombre: 'Ana' }, marco);
    expect(htmlTaller).toContain('>Fecha<');
    expect(htmlTaller).toContain('>Lugar<');
    expect(htmlTaller).not.toContain('>Hora<');
    expect(htmlTaller).not.toContain('>Cupos<');
  });

  it('{nombre} se reemplaza en cualquier texto, no solo en el mensaje', () => {
    const v = validarPlantilla('presentacion_plataforma', { titulo: '{nombre}, conoce la plataforma', texto: 'Hola { Nombre }.', beneficios: 'Pensado para {nombre}', boton_texto: 'Entrar', boton_url: 'a.cl' });
    expect(plantillaUsaNombre(v.datos)).toBe(true);
    expect(plantillaUsaNombre({ texto: 'Hola.' })).toBe(false);
    const html = htmlPlantilla('presentacion_plataforma', v.datos, { nombre: 'Luis' }, marco);
    expect(html).toContain('Luis, conoce la plataforma');
    expect(html).toContain('Hola Luis.');
    expect(html).toContain('Pensado para Luis');
    expect(htmlPlantilla('presentacion_plataforma', v.datos, { nombre: '' }, marco)).not.toMatch(/\{\s*nombre\s*\}/i);
  });

  it('la vista previa (borrador) muestra el botón aunque falte su link; el correo real no', () => {
    const v = validarPlantilla('hands_on', { actividad: 'Hands-on de carillas', boton_texto: 'Reservar mi cupo' });
    expect(v.problemas).toEqual(['Falta completar «Fecha».', 'Falta completar «Lugar».', 'Falta completar «Link de inscripción».']);
    expect(htmlPlantilla('hands_on', v.datos, { nombre: 'Ana' }, { ...marco, borrador: true })).toContain('<a href="#" target="_blank"');
    expect(htmlPlantilla('hands_on', v.datos, { nombre: 'Ana' }, marco)).not.toContain('Reservar mi cupo');
  });

  it('los datos llegan como objeto o como JSON (formulario multipart), y una plantilla desconocida se rechaza', () => {
    expect(leerDatosPlantilla('{"oferta":"10 %"}')).toEqual({ oferta: '10 %' });
    expect(leerDatosPlantilla({ oferta: '10 %' })).toEqual({ oferta: '10 %' });
    expect(leerDatosPlantilla('no es json')).toEqual({});
    expect(leerDatosPlantilla('[1,2]')).toEqual({});
    expect(leerDatosPlantilla(null)).toEqual({});
    expect(validarPlantilla('descuentos', '{"oferta":"10 %","boton_texto":"Ver","boton_url":"a.cl"}').problemas).toEqual([]);
    const mala = validarPlantilla('no_existe', {});
    expect(mala.clave).toBeNull();
    expect(mala.problemas).toEqual(['Esa plantilla no existe: elige una de la galería.']);
    expect(htmlPlantilla('no_existe', {}, { nombre: 'Ana' }, marco)).toBe('');
    expect(nombreDePlantilla('hands_on')).toBe('Invitación a hands-on');
    expect(nombreDePlantilla('')).toBeNull();
  });

  it('con plantilla, el correo solo necesita el asunto (el mensaje libre no se pide)', () => {
    expect(validarContenido({ asunto: 'Workshop', mensaje: '' }, { conPlantilla: true }).problemas).toEqual([]);
    expect(validarContenido({ asunto: '', mensaje: 'x', boton_texto: 'Ver' }, { conPlantilla: true }).problemas).toEqual(['Escribe el asunto del correo.']);
    expect(validarContenido({ asunto: 'Workshop', con_imagen: true, imagen_url: 'javascript:x' }, { conPlantilla: true }).problemas[0]).toMatch(/de la imagen no es una dirección web válida/);
    // Sin plantilla sigue como siempre.
    expect(validarContenido({ asunto: 'Promo', mensaje: '' }).problemas).toEqual(['Escribe el mensaje (o adjunta una imagen).']);
  });
});
