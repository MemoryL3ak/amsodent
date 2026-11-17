import { cuentaVigente, mensajeInactividad, personasInactivas } from './portal-inactividad';

const DIA = 86400000;
const AHORA = new Date('2026-11-17T12:00:00Z').getTime();
const hace = (dias: number) => new Date(AHORA - dias * DIA).toISOString();
const cuenta = (extra: any = {}) => ({ rut: '76111111K', razon_social: 'Clínica Uno', email: 'principal@uno.cl', acceso_habilitado: true, acceso_expira: null, acceso_habilitado_en: hace(60), ultimo_acceso: hace(1), ...extra });
const usuario = (extra: any = {}) => ({ id: 1, rut: '76111111K', email: 'ana@uno.cl', nombre: 'Ana', rol: 'asistente', activo: true, ultimo_acceso: hace(1), created_at: hace(50), ...extra });

describe('usuarios del portal sin iniciar sesión', () => {
  it('avisa a los 5 días sin entrar y no antes', () => {
    const r = personasInactivas([cuenta()], [usuario({ id: 1, ultimo_acceso: hace(4.9) }), usuario({ id: 2, email: 'beto@uno.cl', ultimo_acceso: hace(5.1) })], AHORA, 5);
    expect(r.map((p) => p.usuario_id)).toEqual([2]);
    expect(r[0].dias).toBe(5);
    expect(r[0].sin_ingresar).toBe(false);
  });

  it('descarta a los usuarios desactivados', () => {
    const r = personasInactivas([cuenta()], [usuario({ id: 1, activo: false, ultimo_acceso: hace(40) }), usuario({ id: 2, email: 'b@uno.cl', ultimo_acceso: hace(9) })], AHORA, 5);
    expect(r.map((p) => p.usuario_id)).toEqual([2]);
  });

  it('descarta las cuentas deshabilitadas y las expiradas', () => {
    const lejos = [usuario({ ultimo_acceso: hace(30) })];
    expect(personasInactivas([cuenta({ acceso_habilitado: false })], lejos, AHORA, 5)).toEqual([]);
    expect(personasInactivas([cuenta({ acceso_expira: hace(2) })], lejos, AHORA, 5)).toEqual([]);
    expect(cuentaVigente(cuenta({ acceso_expira: new Date(AHORA + DIA).toISOString() }), AHORA)).toBe(true);
  });

  it('quien nunca entró cuenta desde que pudo entrar (creación del usuario o habilitación)', () => {
    const r = personasInactivas([cuenta({ acceso_habilitado_en: hace(60) })], [usuario({ ultimo_acceso: null, created_at: hace(7) })], AHORA, 5);
    expect(r).toHaveLength(1);
    expect(r[0].sin_ingresar).toBe(true);
    expect(r[0].dias).toBe(7);
  });

  it('una cuenta re-habilitada hace poco no aparece inactiva por su ingreso antiguo', () => {
    const r = personasInactivas([cuenta({ acceso_habilitado_en: hace(2) })], [usuario({ ultimo_acceso: hace(40) })], AHORA, 5);
    expect(r).toEqual([]);
    const despues = personasInactivas([cuenta({ acceso_habilitado_en: hace(6) })], [usuario({ ultimo_acceso: hace(40) })], AHORA, 5);
    expect(despues[0]).toMatchObject({ sin_ingresar: true, dias: 6 });
  });

  it('la cuenta principal solo cuenta si el RUT no tiene personas activas', () => {
    const sinUsuarios = personasInactivas([cuenta({ ultimo_acceso: hace(8) })], [], AHORA, 5);
    expect(sinUsuarios[0]).toMatchObject({ usuario_id: null, nombre: 'Cuenta principal', dias: 8 });
    const conUsuarios = personasInactivas([cuenta({ ultimo_acceso: hace(8) })], [usuario({ ultimo_acceso: hace(1) })], AHORA, 5);
    expect(conUsuarios).toEqual([]);
    const soloDesactivados = personasInactivas([cuenta({ ultimo_acceso: hace(8) })], [usuario({ activo: false })], AHORA, 5);
    expect(soloDesactivados.map((p) => p.usuario_id)).toEqual([null]);
  });

  it('la clave cambia cuando la persona vuelve a entrar (se avisa de nuevo en la racha siguiente)', () => {
    const a = personasInactivas([cuenta()], [usuario({ ultimo_acceso: hace(9) })], AHORA, 5)[0];
    const mismo = personasInactivas([cuenta()], [usuario({ ultimo_acceso: hace(9) })], AHORA + DIA, 5)[0];
    const otra = personasInactivas([cuenta()], [usuario({ ultimo_acceso: hace(6) })], AHORA + 3 * DIA, 5)[0];
    expect(mismo.clave).toBe(a.clave);
    expect(otra.clave).not.toBe(a.clave);
  });

  it('arma el mensaje con el detalle y resume cuando son muchos', () => {
    const personas = personasInactivas(
      [cuenta()],
      [1, 2, 3, 4, 5, 6, 7].map((i) => usuario({ id: i, email: `p${i}@uno.cl`, nombre: `Persona ${i}`, ultimo_acceso: hace(5 + i) })),
      AHORA,
      5,
    );
    const m = mensajeInactividad(personas, 5);
    expect(m).toContain('7 usuarios llevan 5 días o más sin iniciar sesión');
    expect(m).toContain('Persona 7 (Clínica Uno): 12 días');
    expect(m).toContain('y 2 más');
    expect(mensajeInactividad(personas.slice(0, 1), 5)).toContain('Persona 7 (Clínica Uno): 12 días sin iniciar sesión');
  });
});
