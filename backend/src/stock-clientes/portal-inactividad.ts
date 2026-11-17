/* ── Usuarios del portal del cliente sin iniciar sesión (2026-11-17) ─────────
   Pedido de Ariel: «notificación indicando si un usuario no ha iniciado sesión
   del portal cliente en 5 días» y «del listado de usuarios, descartar todos
   los que están desactivados».

   Quién cuenta como «usuario del portal»:
     · cada persona creada dentro del RUT (portal_usuarios) que esté ACTIVA;
     · la cuenta principal del RUT, solo cuando el RUT no tiene personas
       activas (si las tiene, la principal casi nunca se usa y sería ruido).
   Quién se descarta: los usuarios desactivados y todo lo que cuelga de una
   cuenta deshabilitada o con el acceso expirado (no pueden entrar: no tiene
   sentido avisar que no entran).

   Desde cuándo se cuentan los días: el último ingreso de la persona o, si es
   posterior (o nunca entró), el momento desde el que pudo entrar —cuando se
   creó su usuario o cuando se habilitó por última vez la cuenta—. Así una
   cuenta recién re-habilitada no aparece «inactiva hace 40 días» al minuto.

   Aquí solo está la lógica (sin base de datos) para poder probarla. */

export const DIAS_INACTIVIDAD_PORTAL = (() => {
  const n = Number(process.env.PORTAL_INACTIVIDAD_DIAS);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 5;
})();

export interface CuentaPortal {
  rut: string;
  razon_social?: string | null;
  email?: string | null;
  acceso_habilitado?: boolean | null;
  acceso_expira?: string | null;
  acceso_habilitado_en?: string | null;
  ultimo_acceso?: string | null;
  /** Vendedor dueño de la cartera del cliente (correo), si tiene. */
  vendedor?: string | null;
}

export interface UsuarioPortal {
  id: number;
  rut: string;
  email?: string | null;
  nombre?: string | null;
  rol?: string | null;
  activo?: boolean | null;
  ultimo_acceso?: string | null;
  created_at?: string | null;
}

export interface PersonaInactiva {
  rut: string;
  razon_social: string;
  /** null = la cuenta principal del RUT. */
  usuario_id: number | null;
  email: string;
  nombre: string;
  rol: 'admin' | 'asistente';
  ultimo_acceso: string | null;
  /** Nunca ha entrado desde que puede hacerlo (usuario nuevo o cuenta re-habilitada). */
  sin_ingresar: boolean;
  /** Desde cuándo se cuentan los días (ISO). */
  desde: string;
  dias: number;
  vendedor: string | null;
  /** Identifica esta racha de inactividad: cambia cuando la persona vuelve a entrar. */
  clave: string;
}

const ms = (iso: any): number | null => {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  return Number.isFinite(t) ? t : null;
};
const DIA = 86400000;

/** ¿La cuenta del RUT deja entrar hoy? (habilitada y sin expirar) */
export function cuentaVigente(c: CuentaPortal, ahora: number): boolean {
  if (!c?.acceso_habilitado) return false;
  const expira = ms(c.acceso_expira);
  return expira == null || expira >= ahora;
}

/**
 * Personas del portal que llevan `dias` días o más sin iniciar sesión.
 * `normalizar` deja el RUT en la forma en que se comparan cuentas y usuarios.
 */
export function personasInactivas(
  cuentas: CuentaPortal[],
  usuarios: UsuarioPortal[],
  ahora: number,
  dias: number = DIAS_INACTIVIDAD_PORTAL,
  normalizar: (rut: any) => string = (r) => String(r ?? ''),
): PersonaInactiva[] {
  const porRut = new Map<string, UsuarioPortal[]>();
  for (const u of usuarios || []) {
    if (u?.activo === false) continue; // desactivados: fuera
    const k = normalizar(u?.rut);
    if (!k) continue;
    const lista = porRut.get(k) || [];
    lista.push(u);
    porRut.set(k, lista);
  }

  const out: PersonaInactiva[] = [];
  for (const c of cuentas || []) {
    if (!cuentaVigente(c, ahora)) continue; // deshabilitadas y expiradas: fuera
    const rut = normalizar(c.rut);
    if (!rut) continue;
    const habilitada = ms(c.acceso_habilitado_en);
    const razon = String(c.razon_social || '').trim() || rut;
    const vendedor = String(c.vendedor || '').trim().toLowerCase() || null;

    const evaluar = (p: { usuario_id: number | null; email: string; nombre: string; rol: 'admin' | 'asistente'; ultimo: number | null; creado: number | null; ultimoIso: string | null }) => {
      // Desde cuándo pudo entrar: creación del usuario o última habilitación de la cuenta, lo más reciente.
      const pudo = Math.max(p.creado ?? 0, habilitada ?? 0) || null;
      const sinIngresar = p.ultimo == null || (pudo != null && p.ultimo < pudo);
      const desde = sinIngresar ? pudo ?? p.ultimo : p.ultimo;
      if (desde == null) return; // sin ninguna fecha no se puede afirmar nada
      const n = Math.floor((ahora - desde) / DIA);
      if (n < dias) return;
      out.push({
        rut, razon_social: razon, usuario_id: p.usuario_id, email: p.email, nombre: p.nombre, rol: p.rol,
        ultimo_acceso: p.ultimoIso, sin_ingresar: sinIngresar, desde: new Date(desde).toISOString(), dias: n, vendedor,
        clave: `${rut}|${p.usuario_id ?? 'principal'}|${new Date(desde).toISOString()}`,
      });
    };

    const personas = porRut.get(rut) || [];
    if (personas.length) {
      for (const u of personas) {
        evaluar({
          usuario_id: Number(u.id), email: String(u.email || '').trim().toLowerCase(), nombre: String(u.nombre || '').trim(),
          rol: u.rol === 'asistente' ? 'asistente' : 'admin', ultimo: ms(u.ultimo_acceso), creado: ms(u.created_at), ultimoIso: u.ultimo_acceso || null,
        });
      }
    } else {
      evaluar({
        usuario_id: null, email: String(c.email || '').trim().toLowerCase(), nombre: 'Cuenta principal', rol: 'admin',
        ultimo: ms(c.ultimo_acceso), creado: null, ultimoIso: c.ultimo_acceso || null,
      });
    }
  }
  // Los que llevan más tiempo, primero; dentro de lo mismo, por cliente.
  return out.sort((a, b) => b.dias - a.dias || a.razon_social.localeCompare(b.razon_social, 'es', { sensitivity: 'base' }) || a.email.localeCompare(b.email));
}

/** «Ana Pérez (Clínica X, 7 días)» / «cuenta principal de Clínica X (nunca ha entrado, 6 días)». */
export function etiquetaPersona(p: PersonaInactiva): string {
  const quien = p.usuario_id == null ? `cuenta principal de ${p.razon_social}` : `${p.nombre || p.email || 'usuario'} (${p.razon_social})`;
  return `${quien}: ${p.sin_ingresar ? 'nunca ha entrado, ' : ''}${p.dias} día${p.dias === 1 ? '' : 's'}`;
}

/** Texto del aviso de la campana para un grupo de personas. */
export function mensajeInactividad(personas: PersonaInactiva[], dias: number = DIAS_INACTIVIDAD_PORTAL, max = 5): string {
  const n = personas.length;
  if (!n) return '';
  const lista = personas.slice(0, max).map(etiquetaPersona).join(' · ');
  const resto = n > max ? ` · y ${n - max} más` : '';
  return n === 1
    ? `Portal del cliente: ${etiquetaPersona(personas[0])} sin iniciar sesión (aviso a los ${dias} días).`
    : `Portal del cliente: ${n} usuarios llevan ${dias} días o más sin iniciar sesión — ${lista}${resto}.`;
}
