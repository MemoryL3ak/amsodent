import { ClientesService } from './clientes.service';

/* (2026-11-27) «¿Cómo se puede ver quién creó un cliente?»: el servidor deja
   el correo de la sesión en clientes.creado_por. Supabase simulado: guarda lo
   que se intentó insertar/actualizar y puede fingir que la columna no existe. */
function supabaseFalso(opciones: { sinColumna?: string } = {}) {
  const inserts: Record<string, any>[] = [];
  const updates: Record<string, any>[] = [];
  const responder = (fila: Record<string, any>) => {
    const falta = opciones.sinColumna;
    if (falta && falta in fila) {
      return { data: null, error: { code: 'PGRST204', message: `Could not find the '${falta}' column of 'clientes' in the schema cache` } };
    }
    return { data: { id: 1, ...fila }, error: null };
  };
  const cadena = (fila: Record<string, any>) => {
    const c: any = { eq: () => c, select: () => c, single: async () => responder(fila) };
    return c;
  };
  const client = {
    from: () => ({
      insert: (filas: Record<string, any>[]) => { inserts.push({ ...filas[0] }); return cadena(filas[0]); },
      update: (patch: Record<string, any>) => { updates.push({ ...patch }); return cadena(patch); },
    }),
  };
  return { servicio: new ClientesService({ getClient: () => client } as any), inserts, updates };
}

const BASE = {
  rut: '76.111.222-3', nombre: 'Clínica Prueba', region: 'Metropolitana', comuna: 'Santiago',
  direccion: 'Av. Uno 123', contacto: 'Ana', email: 'ana@clinica.cl',
};

describe('ClientesService · quién creó el cliente', () => {
  it('guarda el correo de la sesión en minúscula', async () => {
    const { servicio, inserts } = supabaseFalso();
    const creado: any = await servicio.create({ ...BASE }, '  Sandy.Martinez@Amsodent.cl ', 'u1');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].creado_por).toBe('sandy.martinez@amsodent.cl');
    expect(creado.creado_por).toBe('sandy.martinez@amsodent.cl');
  });

  it('ignora el creado_por que venga en el cuerpo', async () => {
    const { servicio, inserts } = supabaseFalso();
    await servicio.create({ ...BASE, creado_por: 'otro@amsodent.cl' } as any, 'eva@amsodent.cl', 'u1');
    expect(inserts[0].creado_por).toBe('eva@amsodent.cl');
    const sinSesion = supabaseFalso();
    await sinSesion.servicio.create({ ...BASE, creado_por: 'otro@amsodent.cl' } as any, '', null);
    expect(sinSesion.inserts[0].creado_por).toBeNull();
  });

  it('si la columna aún no existe, crea el cliente igual', async () => {
    const { servicio, inserts } = supabaseFalso({ sinColumna: 'creado_por' });
    const creado: any = await servicio.create({ ...BASE }, 'eva@amsodent.cl', 'u1');
    expect(inserts).toHaveLength(2);
    expect('creado_por' in inserts[1]).toBe(false);
    expect(creado.nombre).toBe('Clínica Prueba');
  });

  it('la creación rápida (bitácora) también lo registra y tolera la columna faltante', async () => {
    const ok = supabaseFalso();
    await ok.servicio.crearRapido({ nombre: 'Dr. Rápido' }, 'Benja@Amsodent.cl');
    expect(ok.inserts[0].creado_por).toBe('benja@amsodent.cl');
    expect(ok.inserts[0].transitorio).toBe(true);

    const sin = supabaseFalso({ sinColumna: 'creado_por' });
    const creado: any = await sin.servicio.crearRapido({ nombre: 'Dr. Rápido' }, 'benja@amsodent.cl');
    expect(sin.inserts).toHaveLength(2);
    expect('creado_por' in sin.inserts[1]).toBe(false);
    expect(sin.inserts[1].transitorio).toBe(true);
    expect(creado.nombre).toBe('Dr. Rápido');
  });

  it('al editar no se puede cambiar quién lo creó', async () => {
    const { servicio, updates } = supabaseFalso();
    await servicio.update(1, { nombre: 'Otro nombre', creado_por: 'intruso@amsodent.cl' }, 'u1');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ nombre: 'Otro nombre' });
  });
});
