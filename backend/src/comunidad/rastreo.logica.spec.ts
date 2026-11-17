import {
  claveRegion,
  contactosDe,
  correosEn,
  descifrarCfEmail,
  enlaceContacto,
  esCelularChile,
  lugarAResultado,
  regionParaBuscar,
  sitioSeLee,
  telefonoE164,
  telefonoLegible,
  urlPublica,
  whatsappsEn,
} from './rastreo.logica';

const lugar = (extra: any = {}) => ({
  id: 'ChIJ1',
  displayName: { text: 'Clínica Dental  Odontodent San Bernardo' },
  formattedAddress: 'Barros Arana 587, San Bernardo, Región Metropolitana',
  internationalPhoneNumber: '+56 9 8302 8442',
  websiteUri: 'https://www.odontodent.cl/',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  businessStatus: 'OPERATIONAL',
  rating: 4.5,
  userRatingCount: 117,
  primaryType: 'dentist',
  types: ['dentist', 'dental_clinic'],
  addressComponents: [
    { longText: 'San Bernardo', types: ['locality', 'political'] },
    { longText: 'San Bernardo', types: ['administrative_area_level_3', 'political'] },
    { longText: 'Región Metropolitana', types: ['administrative_area_level_1', 'political'] },
  ],
  ...extra,
});

describe('rastreo de clínicas: lugares de Google Maps', () => {
  it('arma la fila con nombre, teléfono, página, dirección, comuna y región', () => {
    const r = lugarAResultado(lugar(), { region: 'Metropolitana de Santiago', comuna: 'San Bernardo' })!;
    expect(r).toMatchObject({
      place_id: 'ChIJ1', nombre: 'Clínica Dental Odontodent San Bernardo', telefono: '+56983028442', sitio_web: 'https://www.odontodent.cl/',
      direccion: 'Barros Arana 587, San Bernardo, Región Metropolitana', comuna: 'San Bernardo', region: 'Metropolitana de Santiago', en_comuna: true,
      nota: 4.5, resenas: 117, rubro: 'Dentista',
    });
    // El celular de Maps se propone como WhatsApp, marcado como «del teléfono».
    expect(r).toMatchObject({ whatsapp: '+56983028442', whatsapp_origen: 'telefono' });
  });

  it('marca las de comunas vecinas y descarta las cerradas para siempre', () => {
    const vecina = lugarAResultado(lugar({ addressComponents: [{ longText: 'El Bosque', types: ['administrative_area_level_3'] }, { longText: 'Región Metropolitana', types: ['administrative_area_level_1'] }] }), { region: 'Metropolitana de Santiago', comuna: 'San Bernardo' })!;
    expect(vecina).toMatchObject({ en_comuna: false, comuna: 'El Bosque', region: 'Metropolitana de Santiago' });
    expect(lugarAResultado(lugar({ businessStatus: 'CLOSED_PERMANENTLY' }), { region: 'x', comuna: 'San Bernardo' })).toBeNull();
    expect(lugarAResultado(lugar({ businessStatus: 'CLOSED_TEMPORARILY' }), { region: 'x', comuna: 'San Bernardo' })!.cerrado_temporal).toBe(true);
  });

  it('distingue las clínicas dentales de hospitales y centros médicos', () => {
    const b = { region: 'Metropolitana de Santiago', comuna: 'San Bernardo' };
    expect(lugarAResultado(lugar(), b)!.dental).toBe(true);
    // Sin rubro dental en Google, manda el nombre.
    expect(lugarAResultado(lugar({ displayName: { text: 'Centro Odontológico 12 de Febrero' }, primaryType: 'health', types: ['health'] }), b)!.dental).toBe(true);
    expect(lugarAResultado(lugar({ displayName: { text: 'Dentimagen Sucursal San Bernardo' }, primaryType: 'medical_clinic', types: ['medical_clinic'] }), b)!.dental).toBe(true);
    for (const nombre of ['CESFAM Dr. Raúl Cuevas', 'IntegraMédica Plaza Sur', 'Hospital Parroquial de San Bernardo', 'Centro Médico Presidente']) {
      expect(lugarAResultado(lugar({ displayName: { text: nombre }, primaryType: 'hospital', types: ['hospital', 'health'] }), b)!.dental).toBe(false);
    }
  });

  it('un fijo no se propone como WhatsApp; la comuna se compara sin tildes', () => {
    const r = lugarAResultado(lugar({ internationalPhoneNumber: '+56 2 2859 1531', addressComponents: [{ longText: 'Ñuñoa', types: ['locality'] }] }), { region: 'Metropolitana de Santiago', comuna: 'Nunoa' })!;
    expect(r).toMatchObject({ telefono: '+56228591531', whatsapp: '', whatsapp_origen: '', en_comuna: true });
  });

  it('reconoce la misma región escrita de varias formas', () => {
    expect(claveRegion('Región Metropolitana')).toBe(claveRegion('Metropolitana de Santiago'));
    expect(claveRegion('Bío Bío')).toBe(claveRegion('Biobío'));
    expect(claveRegion("Libertador General Bernardo O'Higgins")).toBe(claveRegion("O'Higgins"));
    expect(claveRegion('Araucanía')).toBe(claveRegion('La Araucanía'));
    expect(regionParaBuscar('Metropolitana de Santiago')).toBe('Región Metropolitana');
    expect(regionParaBuscar('Valparaíso')).toBe('Región de Valparaíso');
  });
});

describe('rastreo de clínicas: teléfonos', () => {
  it('deja los teléfonos chilenos en formato internacional', () => {
    expect(telefonoE164('9 8302 8442')).toBe('+56983028442');
    expect(telefonoE164('+56 9 8302 8442')).toBe('+56983028442');
    expect(telefonoE164('(2) 2859 1531')).toBe('+56228591531');
    expect(telefonoE164('83028442')).toBe('+56983028442');
    expect(telefonoE164('123')).toBe('');
    expect(esCelularChile('+56983028442')).toBe(true);
    expect(esCelularChile('+56228591531')).toBe(false);
    expect(telefonoLegible('+56983028442')).toBe('+56 9 8302 8442');
  });
});

describe('rastreo de clínicas: correo y WhatsApp de la página web', () => {
  it('saca los correos de mailto, del texto y de Cloudflare, sin basura', () => {
    const html = `
      <a href="mailto:Contacto@Sonrisa.cl?subject=Hola">Escríbenos</a>
      <p>Agenda: reservas&#64;sonrisa.cl o sonrisa.dental@gmail.com</p>
      <img src="logo@2x.png"> <script>dsn="https://abc123abc123abc123abc123abc1@o1.ingest.sentry.io/1"</script>
      <span>usuario@ejemplo.com</span> <a data-cfemail="${cifrar('info@sonrisa.cl')}">[email&#160;protected]</a>`;
    const correos = correosEn(html, 'www.sonrisa.cl');
    expect(correos).toContain('contacto@sonrisa.cl');
    expect(correos).toContain('reservas@sonrisa.cl');
    expect(correos).toContain('info@sonrisa.cl');
    expect(correos).toContain('sonrisa.dental@gmail.com');
    expect(correos.some((c) => /png|sentry|ejemplo/.test(c))).toBe(false);
    // Los del dominio de la clínica van antes que el Gmail.
    expect(correos.indexOf('sonrisa.dental@gmail.com')).toBeGreaterThan(correos.indexOf('contacto@sonrisa.cl'));
  });

  it('descifra el correo protegido por Cloudflare', () => {
    expect(descifrarCfEmail(cifrar('hola@clinica.cl'))).toBe('hola@clinica.cl');
    expect(descifrarCfEmail('zz')).toBe('');
  });

  it('saca el WhatsApp de los enlaces wa.me y api.whatsapp.com', () => {
    const html = '<a href="https://wa.me/56912345678?text=Hola">WhatsApp</a> <a href="https://api.whatsapp.com/send?phone=%2B56987654321&text=x">otro</a> <a href="https://wa.me/56912345678">repetido</a>';
    expect(whatsappsEn(html)).toEqual(['+56912345678', '+56987654321']);
    expect(whatsappsEn('https://wa.me/+56 9 1111 2222')).toEqual(['+56911112222']);
    expect(whatsappsEn('<p>Llámanos al 9 1234 5678</p>')).toEqual([]);
  });

  it('encuentra la página de contacto del mismo sitio', () => {
    const base = new URL('https://www.sonrisa.cl/');
    const html = '<a href="/servicios">Servicios</a><a href="https://otra.cl/contacto">x</a><a href="/contacto/">Contacto</a>';
    expect(enlaceContacto(html, base)).toBe('https://www.sonrisa.cl/contacto/');
    expect(enlaceContacto('<a href="/nosotros">Nosotros</a>', base)).toBeNull();
  });

  it('junta lo leído en varias páginas', () => {
    const c = contactosDe(['<a href="https://wa.me/56911112222">wsp</a>', '<a href="mailto:hola@sonrisa.cl">hola</a>'], 'sonrisa.cl');
    expect(c).toEqual({ correos: ['hola@sonrisa.cl'], whatsapps: ['+56911112222'] });
  });

  it('solo lee páginas públicas y propias', () => {
    expect(urlPublica('https://www.sonrisa.cl/')).not.toBeNull();
    for (const mala of ['ftp://x.cl', 'http://localhost:3000', 'http://192.168.1.10/', 'http://[::1]/', 'javascript:alert(1)', 'http://intranet', 'nada']) {
      expect(urlPublica(mala)).toBeNull();
    }
    expect(sitioSeLee(new URL('https://www.sonrisa.cl/'))).toBe(true);
    for (const red of ['https://www.instagram.com/sonrisa', 'https://facebook.com/sonrisa', 'https://wa.me/56911112222', 'https://linktr.ee/sonrisa']) {
      expect(sitioSeLee(new URL(red))).toBe(false);
    }
  });
});

/* Cifrado de Cloudflare (para armar el caso de prueba): llave + cada byte XOR llave. */
function cifrar(correo: string, llave = 0x5a): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return hex(llave) + [...correo].map((ch) => hex(ch.charCodeAt(0) ^ llave)).join('');
}
