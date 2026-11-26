import {
  LimitadorAperturas, MINUTOS_ENTRE_AVISOS, TIPO_MAILING_APERTURA, avisoApertura, baseApiPublica, baseDesdePeticion, conPixelApertura, decidirAvisoApertura,
  esBaseLocal, esTokenApertura, pixelApertura, tramoDeApertura,
} from './mailing-aperturas';
import { MailingsService } from '../mailings/mailings.service';

const TOKEN = 'a3f1c2d4e5b60718293a4b5c6d7e8f90';

describe('Píxel de apertura', () => {
  it('va al final del correo, con el token de su destinatario', () => {
    const html = conPixelApertura('<table><tr><td>Hola</td></tr></table>', 'https://api.cl/api/', TOKEN);
    expect(html).toBe(`<table><tr><td>Hola</td></tr></table>${pixelApertura('https://api.cl/api', TOKEN)}`);
    expect(html).toContain(`<img src="https://api.cl/api/mailings/track/open?t=${TOKEN}" width="1" height="1"`);
    expect(html.match(/track\/open/g)).toHaveLength(1);
  });

  it('en un documento completo queda dentro del cuerpo', () => {
    const html = conPixelApertura('<html><body><p>Hola</p></BODY></html>', 'https://api.cl/api', TOKEN);
    expect(html).toMatch(/<p>Hola<\/p><img src="https:\/\/api\.cl\/api\/mailings\/track\/open\?t=[a-f0-9]{32}"[^>]*\/><\/BODY><\/html>$/);
  });

  it('sin dirección del servidor o sin token el correo queda tal cual', () => {
    expect(conPixelApertura('<p>Hola</p>', '', TOKEN)).toBe('<p>Hola</p>');
    expect(conPixelApertura('<p>Hola</p>', null, TOKEN)).toBe('<p>Hola</p>');
    expect(conPixelApertura('<p>Hola</p>', 'https://api.cl/api', '')).toBe('<p>Hola</p>');
  });

  it('reconoce los tokens (16 bytes en hexadecimal) y descarta lo demás sin ir a la base', () => {
    expect(esTokenApertura(TOKEN)).toBe(true);
    for (const malo of ['', 'abc', TOKEN.toUpperCase(), `${TOKEN}0`, `${TOKEN.slice(0, 31)}g`, "' or 1=1 --", null, undefined, 123, [TOKEN]]) expect(esTokenApertura(malo)).toBe(false);
  });
});

describe('Dirección pública del servidor para el píxel', () => {
  it('distingue una dirección que solo existe en este computador', () => {
    for (const local of ['', null, 'http://localhost:3001/api', 'http://127.0.0.1:3001/api', 'http://192.168.1.20:3001/api', 'http://backend:3001/api', 'no es url']) expect(esBaseLocal(local as any)).toBe(true);
    for (const publica of ['https://amsodent-production.up.railway.app/api', 'http://api.amsodent.cl/api']) expect(esBaseLocal(publica)).toBe(false);
  });

  it('manda PUBLIC_API_URL; si falta, la dirección de la petición; después Railway; al final localhost', () => {
    expect(baseApiPublica({ PUBLIC_API_URL: 'https://api.cl/api/' }, 'https://otra.cl/api')).toBe('https://api.cl/api');
    expect(baseApiPublica({}, 'https://back.up.railway.app/api')).toBe('https://back.up.railway.app/api');
    expect(baseApiPublica({ RAILWAY_PUBLIC_DOMAIN: 'back.up.railway.app' }, null)).toBe('https://back.up.railway.app/api');
    // Una variable que apunta a localhost no le gana a una dirección pública.
    expect(baseApiPublica({ PUBLIC_API_URL: 'http://localhost:3001/api' }, 'https://back.up.railway.app/api')).toBe('https://back.up.railway.app/api');
    expect(baseApiPublica({ PORT: '4000' }, null)).toBe('http://localhost:4000/api');
    expect(baseApiPublica({}, 'http://localhost:3001/api')).toBe('http://localhost:3001/api');
  });

  it('saca la dirección de la petición (detrás del proxy de Railway) y no acepta cabeceras raras', () => {
    expect(baseDesdePeticion({ headers: { host: 'back.up.railway.app', 'x-forwarded-proto': 'https' }, protocol: 'http' })).toBe('https://back.up.railway.app/api');
    expect(baseDesdePeticion({ headers: { host: 'localhost:3001' }, protocol: 'http' })).toBe('http://localhost:3001/api');
    expect(baseDesdePeticion({ headers: { host: 'malo.cl/"><img src=x>' } })).toBeNull();
    expect(baseDesdePeticion({ headers: {} })).toBeNull();
    expect(baseDesdePeticion(null)).toBeNull();
  });
});

describe('Avisos de apertura a quien envió (regla de agrupación)', () => {
  const ahora = new Date('2026-11-26T15:00:00Z');
  const hace = (min: number) => new Date(ahora.getTime() - min * 60000).toISOString();

  it('la primera apertura del envío crea el aviso', () => {
    expect(decidirAvisoApertura({ abiertos: 1, enviados: 80, previo: null, ahora })).toBe('crear');
    expect(decidirAvisoApertura({ abiertos: 0, enviados: 80, previo: null, ahora })).toBe('nada');
  });

  it('mientras el aviso siga sin leer no se crea otro: se reescribe el mismo', () => {
    const previo = { abiertos: 1, leida: false, creado_at: hace(1) };
    expect(decidirAvisoApertura({ abiertos: 2, enviados: 80, previo, ahora })).toBe('actualizar');
    expect(decidirAvisoApertura({ abiertos: 79, enviados: 80, previo, ahora })).toBe('actualizar');
    // Sin aperturas nuevas no hay nada que escribir.
    expect(decidirAvisoApertura({ abiertos: 1, enviados: 80, previo, ahora })).toBe('nada');
  });

  it('ya leído: uno nuevo solo al cruzar un tramo (25, 50, 75 %) y pasada una hora', () => {
    const previo = { abiertos: 5, leida: true, creado_at: hace(MINUTOS_ENTRE_AVISOS + 5) };
    expect(decidirAvisoApertura({ abiertos: 19, enviados: 80, previo, ahora })).toBe('nada'); // 24 %: mismo tramo
    expect(decidirAvisoApertura({ abiertos: 20, enviados: 80, previo, ahora })).toBe('crear'); // 25 %
    expect(decidirAvisoApertura({ abiertos: 20, enviados: 80, previo: { ...previo, creado_at: hace(10) }, ahora })).toBe('nada'); // muy seguido
    const enElTramo50 = { abiertos: 41, leida: true, creado_at: hace(600) };
    expect(decidirAvisoApertura({ abiertos: 59, enviados: 80, previo: enElTramo50, ahora })).toBe('nada');
    expect(decidirAvisoApertura({ abiertos: 60, enviados: 80, previo: enElTramo50, ahora })).toBe('crear');
    // Pasado el 75 % ya no quedan tramos: no hay más avisos.
    expect(decidirAvisoApertura({ abiertos: 80, enviados: 80, previo: { abiertos: 60, leida: true, creado_at: hace(600) }, ahora })).toBe('nada');
  });

  it('un envío nunca genera más de 4 avisos, aunque se lean todos al instante', () => {
    let previo: any = null;
    let avisos = 0;
    let reloj = ahora.getTime();
    for (let abiertos = 1; abiertos <= 500; abiertos++) {
      reloj += 2 * 60 * 60000; // dos horas entre aperturas: el tiempo nunca es el freno
      const decision = decidirAvisoApertura({ abiertos, enviados: 500, previo, ahora: new Date(reloj) });
      expect(decision).not.toBe('actualizar');
      if (decision === 'crear') { avisos++; previo = { abiertos, leida: true, creado_at: new Date(reloj).toISOString() }; }
    }
    expect(avisos).toBe(4);
    expect(tramoDeApertura(124, 500)).toBe(0);
    expect(tramoDeApertura(125, 500)).toBe(1);
    expect(tramoDeApertura(500, 500)).toBe(3);
    expect(tramoDeApertura(3, 0)).toBe(3);
  });

  it('redacta el aviso para quien envió y lo lleva al seguimiento', () => {
    const envio = { id: 12, asunto: 'Workshop de estética', total: 80, enviados: 80, creado_por: ' Ana@Amsodent.cl ', origen: 'comunidad' };
    expect(avisoApertura(envio, 1)).toEqual({
      destinatario: 'ana@amsodent.cl',
      mensaje: '1 persona abrió tu correo «Workshop de estética» (de 80 enviados).',
      link: '/comunidad-registros?vista=mailing&envio=12',
      metadata: { envio_id: 12, asunto: 'Workshop de estética', abiertos: 1, enviados: 80, porcentaje: 1, origen: 'comunidad' },
    });
    expect(avisoApertura(envio, 12)?.mensaje).toBe('12 personas abrieron tu correo «Workshop de estética»: 15 % de los 80 enviados.');
    // Mientras el envío sigue saliendo `enviados` va atrasado: el porcentaje nunca pasa de 100.
    expect(avisoApertura({ ...envio, enviados: 0, total: 0 }, 3)?.metadata).toMatchObject({ enviados: 3, porcentaje: 100 });
    expect(avisoApertura({ ...envio, enviados: 0 }, 3)?.metadata).toMatchObject({ enviados: 80, porcentaje: 4 });
    expect(avisoApertura({ ...envio, origen: null }, 2)?.link).toBe('/comunicaciones');
    // Sin autor conocido o sin aperturas no hay a quién ni qué avisar.
    expect(avisoApertura({ ...envio, creado_por: null }, 5)).toBeNull();
    expect(avisoApertura(envio, 0)).toBeNull();
  });
});

describe('Freno contra abuso del píxel', () => {
  it('el mismo token no vuelve a contar antes de 20 segundos', () => {
    const l = new LimitadorAperturas();
    expect(l.permitir('1.1.1.1', TOKEN, 0)).toBe(true);
    expect(l.permitir('1.1.1.1', TOKEN, 5_000)).toBe(false);
    expect(l.permitir('2.2.2.2', TOKEN, 19_999)).toBe(false);
    expect(l.permitir('1.1.1.1', TOKEN, 20_000)).toBe(true);
  });

  it('una misma IP tiene un tope por minuto, que se renueva', () => {
    const l = new LimitadorAperturas({ porMinutoIp: 3 });
    const token = (i: number) => i.toString(16).padStart(32, '0');
    expect([0, 1, 2, 3, 4].map((i) => l.permitir('9.9.9.9', token(i), 1000 + i))).toEqual([true, true, true, false, false]);
    expect(l.permitir('8.8.8.8', token(50), 1010)).toBe(true); // otra IP no se ve afectada
    expect(l.permitir('9.9.9.9', token(60), 61_001)).toBe(true); // pasó el minuto
  });

  it('no crece sin límite aunque lleguen miles de tokens distintos', () => {
    const l = new LimitadorAperturas({ maxEntradas: 100, porMinutoIp: 1_000_000 });
    for (let i = 0; i < 5000; i++) l.permitir(`10.0.0.${i % 7}`, i.toString(16).padStart(32, '0'), i);
    expect((l as any).porToken.size + (l as any).porIp.size).toBeLessThanOrEqual(100);
  });
});

/* ── El servicio, con una base de mentira en memoria ── */
function baseFalsa(tablas: Record<string, any[]>, opciones: { sinContador?: boolean } = {}) {
  const from = (tabla: string) => {
    const q: any = { filtros: [] as ((f: any) => boolean)[], accion: 'select', cols: '', cuenta: false };
    const valor = (f: any, col: string) => (col.includes('->>') ? String(f[col.split('->>')[0]]?.[col.split('->>')[1]] ?? '') : f[col]);
    const filas = () => (tablas[tabla] || []).filter((f) => q.filtros.every((fn: any) => fn(f)));
    const ejecutar = async () => {
      if (opciones.sinContador && tabla === 'mailings_destinatarios' && (/aperturas/.test(q.cols) || q.cambios?.aperturas !== undefined)) {
        return { data: null, error: { code: '42703', message: 'column mailings_destinatarios.aperturas does not exist' } };
      }
      if (q.accion === 'insert') {
        for (const r of q.rows) tablas[tabla].push({ id: tablas[tabla].length + 1, leida_at: null, creado_at: new Date().toISOString(), ...r });
        return { data: null, error: null };
      }
      if (q.accion === 'update') {
        for (const f of filas()) Object.assign(f, q.cambios);
        return { data: null, error: null };
      }
      const r = [...filas()].reverse(); // «order id desc»
      return q.cuenta ? { data: null, count: r.length, error: null } : { data: r.slice(0, q.tope ?? r.length), error: null };
    };
    const api: any = {
      select: (cols: string, o?: any) => { if (q.accion === 'select') { q.cols = cols; q.cuenta = !!o?.count; } return api; },
      eq: (col: string, v: any) => { q.filtros.push((f: any) => String(valor(f, col)) === String(v)); return api; },
      not: (col: string) => { q.filtros.push((f: any) => f[col] != null); return api; },
      order: () => api,
      limit: (n: number) => { q.tope = n; return api; },
      insert: (rows: any[]) => { q.accion = 'insert'; q.rows = rows; return api; },
      update: (c: any) => { q.accion = 'update'; q.cambios = c; return api; },
      maybeSingle: () => ejecutar().then((r: any) => ({ ...r, data: r.data?.[0] ?? null })),
      then: (ok: any, mal: any) => ejecutar().then(ok, mal),
    };
    return api;
  };
  return { getClient: () => ({ from }) } as any;
}

describe('MailingsService: registrar aperturas y avisar', () => {
  const tablasNuevas = (conContador = true) => ({
    mailings_envios: [{ id: 7, asunto: 'Workshop de estética', total: 4, enviados: 4, creado_por: 'ana@amsodent.cl', origen: 'comunidad' }],
    mailings_destinatarios: [0, 1, 2, 3].map((i) => ({ id: i + 1, envio_id: 7, email: `p${i}@x.cl`, token: `${i}`.repeat(32), abierto_at: null, user_agent: null, ...(conContador ? { aperturas: 0, ultima_apertura_at: null } : {}) })),
    notificaciones: [] as any[],
  });
  const servicio = (tablas: any, opciones: { sinContador?: boolean } = {}) => {
    const s = new MailingsService(baseFalsa(tablas, opciones), { registrar: () => undefined } as any);
    const programar = jest.spyOn(s as any, 'programarAvisoApertura').mockImplementation(() => undefined);
    return { s, programar };
  };

  it('la primera carga anota la apertura y pide el aviso; las siguientes solo suman', async () => {
    const tablas = tablasNuevas();
    const { s, programar } = servicio(tablas);
    await s.registrarApertura('0'.repeat(32), 'GoogleImageProxy');
    const d = tablas.mailings_destinatarios[0] as any;
    expect(d.abierto_at).toBeTruthy();
    expect(d).toMatchObject({ aperturas: 1, user_agent: 'GoogleImageProxy' });
    expect(programar).toHaveBeenCalledTimes(1);
    expect(programar).toHaveBeenCalledWith(7);
    const primera = d.abierto_at;
    await s.registrarApertura('0'.repeat(32), 'Otro');
    expect(d).toMatchObject({ aperturas: 2, abierto_at: primera, user_agent: 'GoogleImageProxy' });
    expect(d.ultima_apertura_at).toBeTruthy();
    expect(programar).toHaveBeenCalledTimes(1); // volver a abrir no avisa de nuevo
  });

  it('sin la migración 20261126 sigue anotando la primera apertura (sin contador) y no falla', async () => {
    const tablas = tablasNuevas(false);
    const { s, programar } = servicio(tablas, { sinContador: true });
    await expect(s.registrarApertura('1'.repeat(32), 'UA')).resolves.toBeUndefined();
    const d = tablas.mailings_destinatarios[1] as any;
    expect(d.abierto_at).toBeTruthy();
    expect(d.aperturas).toBeUndefined();
    expect(programar).toHaveBeenCalledTimes(1);
    const primera = d.abierto_at;
    await s.registrarApertura('1'.repeat(32), 'UA');
    expect(d.abierto_at).toBe(primera);
  });

  it('un token que no existe, mal formado o una base caída nunca hacen fallar el píxel', async () => {
    const tablas = tablasNuevas();
    const { s, programar } = servicio(tablas);
    await expect(s.registrarApertura('f'.repeat(32))).resolves.toBeUndefined();
    await expect(s.registrarApertura('<script>')).resolves.toBeUndefined();
    await expect(s.registrarApertura(undefined as any)).resolves.toBeUndefined();
    const rota = new MailingsService({ getClient: () => { throw new Error('sin conexión'); } } as any, { registrar: () => undefined } as any);
    await expect(rota.registrarApertura('0'.repeat(32))).resolves.toBeUndefined();
    expect(programar).not.toHaveBeenCalled();
    expect(tablas.mailings_destinatarios.every((d: any) => !d.abierto_at)).toBe(true);
  });

  it('un aviso por envío que se va actualizando; al leerlo, uno nuevo solo por tramo', async () => {
    const tablas = tablasNuevas();
    const { s } = servicio(tablas);
    const abrir = (i: number) => { (tablas.mailings_destinatarios[i] as any).abierto_at = new Date().toISOString(); };
    expect(await s.avisarAperturas(7)).toBe('nada'); // nadie ha abierto

    abrir(0);
    expect(await s.avisarAperturas(7)).toBe('crear');
    expect(tablas.notificaciones).toHaveLength(1);
    expect(tablas.notificaciones[0]).toMatchObject({
      user_email: 'ana@amsodent.cl', tipo: TIPO_MAILING_APERTURA, link: '/comunidad-registros?vista=mailing&envio=7',
      mensaje: '1 persona abrió tu correo «Workshop de estética» (de 4 enviados).',
    });
    expect(await s.avisarAperturas(7)).toBe('nada'); // sin aperturas nuevas

    abrir(1);
    expect(await s.avisarAperturas(7)).toBe('actualizar'); // sin leer: el mismo aviso, al día
    expect(tablas.notificaciones).toHaveLength(1);
    expect(tablas.notificaciones[0].mensaje).toBe('2 personas abrieron tu correo «Workshop de estética»: 50 % de los 4 enviados.');
    expect(tablas.notificaciones[0].leida_at).toBeNull();

    tablas.notificaciones[0].leida_at = new Date().toISOString(); // lo leyó
    abrir(2);
    expect(await s.avisarAperturas(7)).toBe('nada'); // cruzó el 75 %, pero hace menos de una hora
    tablas.notificaciones[0].creado_at = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(await s.avisarAperturas(7)).toBe('crear');
    expect(tablas.notificaciones).toHaveLength(2);
    expect(tablas.notificaciones[1].metadata).toMatchObject({ envio_id: 7, abiertos: 3, enviados: 4, porcentaje: 75 });
  });

  it('un envío sin autor conocido no avisa a nadie', async () => {
    const tablas = tablasNuevas();
    (tablas.mailings_envios[0] as any).creado_por = null;
    (tablas.mailings_destinatarios[0] as any).abierto_at = new Date().toISOString();
    expect(await servicio(tablas).s.avisarAperturas(7)).toBe('nada');
    expect(await servicio(tablas).s.avisarAperturas(999)).toBe('nada');
    expect(tablas.notificaciones).toHaveLength(0);
  });
});
