import { MODULOS, permisosEfectivos, soloVeProductos } from './permisos';

// (2026-11-26) Permiso «productos_ver»: ver el catálogo sin crear ni editar.
describe('productos en solo lectura (productos_ver)', () => {
  it('el permiso existe en el catálogo de módulos', () => {
    expect(MODULOS).toContain('productos_ver');
  });

  it('solo ver: tiene productos_ver y nada que deje trabajar el catálogo', () => {
    const sala = permisosEfectivos('ventas', ['venta_directa', 'cotizaciones', 'productos_ver']);
    expect(soloVeProductos('ventas', sala)).toBe(true);
  });

  it('con «productos», «crear_productos» o «editar_productos» ya no es solo lectura', () => {
    for (const extra of ['productos', 'crear_productos', 'editar_productos']) {
      expect(soloVeProductos('ventas', ['productos_ver', extra])).toBe(false);
    }
  });

  it('el admin nunca queda en solo lectura (recibe todos los módulos)', () => {
    expect(soloVeProductos('admin', permisosEfectivos('admin', null))).toBe(false);
    expect(soloVeProductos('Administrador', ['productos_ver'])).toBe(false);
  });

  it('un vendedor sin perfil (permisos del rol) no es solo lectura', () => {
    expect(soloVeProductos('ventas', permisosEfectivos('ventas', null))).toBe(false);
  });

  it('sin productos_ver no aplica', () => {
    expect(soloVeProductos('ventas', ['venta_directa'])).toBe(false);
    expect(soloVeProductos('ventas', undefined as any)).toBe(false);
  });
});
