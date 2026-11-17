import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { correTareasDeFondo, MOTIVO_SIN_FONDO } from '../rol-proceso';
import { esRolAdmin } from '../auth/permisos';
import { StockClientesService } from './stock-clientes.service';
import { DIAS_INACTIVIDAD_PORTAL, PersonaInactiva, mensajeInactividad } from './portal-inactividad';

/* ============================================================================
   Aviso de usuarios del portal sin iniciar sesión (2026-11-17)
   ----------------------------------------------------------------------------
   Pedido de Ariel: «notificación indicando si un usuario no ha iniciado sesión
   del portal cliente en 5 días».

   Una vez al día (09:00 de Chile) busca las personas del portal —activas, de
   cuentas habilitadas y vigentes— que cumplieron 5 días o más sin entrar y
   deja UN aviso en la campana por destinatario, con todas las que le tocan:

     · los administradores reciben todas;
     · el vendedor dueño de la cartera del cliente recibe las de sus clientes.

   Cada persona se avisa una sola vez por racha de inactividad: el dedupe se
   lee de los avisos anteriores (tipo portal_sin_ingreso → metadata.claves). Si
   la persona vuelve a entrar y más adelante deja de hacerlo, se avisa de nuevo.
   Si el proceso estuvo caído el día justo, se avisa al día siguiente que corra.

   Interruptores (mismo patrón que los otros crones):
     PORTAL_INACTIVIDAD_AVISO=off   → apagado (ej. backend local de desarrollo)
     PORTAL_INACTIVIDAD_HORAS=9     → hora(s) de Chile en que revisa
     PORTAL_INACTIVIDAD_DIAS=5      → días sin entrar para avisar
============================================================================ */

const ZONA = 'America/Santiago';
const HORAS = String(process.env.PORTAL_INACTIVIDAD_HORAS || '9')
  .split(',')
  .map((h) => Number(String(h).trim()))
  .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
export const TIPO_AVISO_INACTIVIDAD = 'portal_sin_ingreso';
export const LINK_AVISO_INACTIVIDAD = '/portal-accesos?tab=inactivos';

const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

@Injectable()
export class PortalInactividadCron implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PortalInactividadCron');
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private ultima = '';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly stockClientes: StockClientesService,
  ) {}

  onModuleInit() {
    if (!correTareasDeFondo()) {
      this.log.log(`Aviso de inactividad del portal: no corre en este proceso (${MOTIVO_SIN_FONDO}).`);
      return;
    }
    if (String(process.env.PORTAL_INACTIVIDAD_AVISO || '').toLowerCase() === 'off') {
      this.log.log('Aviso de inactividad del portal DESACTIVADO (PORTAL_INACTIVIDAD_AVISO=off).');
      return;
    }
    if (!HORAS.length) {
      this.log.warn('PORTAL_INACTIVIDAD_HORAS no tiene horas válidas: no se programó el aviso de inactividad del portal.');
      return;
    }
    this.log.log(`Aviso de inactividad del portal activo: ${HORAS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' y ')} (${ZONA}), a los ${DIAS_INACTIVIDAD_PORTAL} días sin entrar.`);
    this.timer = setInterval(() => void this.revisar(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private ahoraEnChile() {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const v = (t: string) => partes.find((p) => p.type === t)?.value || '';
    return { hora: Number(v('hour')) % 24, minuto: Number(v('minute')) };
  }

  private async revisar() {
    if (this.corriendo) return;
    const { hora, minuto } = this.ahoraEnChile();
    if (!HORAS.includes(hora) || minuto > 4) return;
    const marca = `${hoyEnChile()}@${hora}`;
    if (this.ultima === marca) return;
    this.ultima = marca;
    this.corriendo = true;
    try {
      const r = await this.avisar();
      if (r.avisos) this.log.log(`Inactividad del portal: ${r.personas} persona(s) nuevas, ${r.avisos} aviso(s) creados.`);
    } catch (e: any) {
      this.log.warn(`Aviso de inactividad del portal falló: ${e?.message || e}`);
    } finally {
      this.corriendo = false;
    }
  }

  private async administradores(): Promise<string[]> {
    const { data } = await this.supabase.getClient().from('profiles').select('email, rol');
    const lista = ((data || []) as any[])
      .filter((p) => esRolAdmin(String(p?.rol || '').trim().toLowerCase()))
      .map((p) => String(p?.email || '').trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
    return [...new Set(lista)];
  }

  /* Crea los avisos que correspondan. `simular` no escribe nada: devuelve lo
     que se avisaría (para probar). Público para poder llamarlo desde un banco. */
  async avisar(simular = false): Promise<{ personas: number; avisos: number; filas: any[] }> {
    const db = this.supabase.getClient();
    const { personas } = await this.stockClientes.usuariosInactivosPortal(DIAS_INACTIVIDAD_PORTAL);
    if (!personas.length) return { personas: 0, avisos: 0, filas: [] };

    // Rachas ya avisadas (último año).
    const desde = new Date(Date.now() - 370 * 86400000).toISOString();
    const { data: previos, error } = await db
      .from('notificaciones')
      .select('metadata')
      .eq('tipo', TIPO_AVISO_INACTIVIDAD)
      .gte('creado_at', desde)
      .range(0, 4999);
    if (error) throw new Error(error.message);
    const avisadas = new Set<string>();
    for (const n of (previos || []) as any[]) for (const c of Array.isArray(n?.metadata?.claves) ? n.metadata.claves : []) avisadas.add(String(c));

    const nuevas: PersonaInactiva[] = personas.filter((p) => !avisadas.has(p.clave));
    if (!nuevas.length) return { personas: 0, avisos: 0, filas: [] };

    const admins = await this.administradores();
    // Destinatario → las personas que le tocan (admin: todas; dueño de cartera: las suyas).
    const porDestinatario = new Map<string, PersonaInactiva[]>();
    for (const a of admins) porDestinatario.set(a, [...nuevas]);
    for (const p of nuevas) {
      const v = String(p.vendedor || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(v) || admins.includes(v)) continue;
      porDestinatario.set(v, [...(porDestinatario.get(v) || []), p]);
    }
    const filas = [...porDestinatario.entries()].map(([user_email, lista]) => ({
      user_email,
      tipo: TIPO_AVISO_INACTIVIDAD,
      mensaje: mensajeInactividad(lista, DIAS_INACTIVIDAD_PORTAL),
      // La pestaña «Sin iniciar sesión» es de Acceso Portal Clientes (administradores);
      // el vendedor dueño de la cartera va a sus clientes.
      link: admins.includes(user_email) ? LINK_AVISO_INACTIVIDAD : '/mis-clientes',
      metadata: {
        dias: DIAS_INACTIVIDAD_PORTAL,
        claves: lista.map((p) => p.clave),
        personas: lista.slice(0, 40).map((p) => ({ rut: p.rut, razon_social: p.razon_social, usuario_id: p.usuario_id, email: p.email, nombre: p.nombre, dias: p.dias, sin_ingresar: p.sin_ingresar })),
      },
    }));
    if (simular || !filas.length) return { personas: nuevas.length, avisos: filas.length, filas };
    const { error: errInsert } = await db.from('notificaciones').insert(filas);
    if (errInsert) throw new Error(errInsert.message);
    return { personas: nuevas.length, avisos: filas.length, filas };
  }
}
