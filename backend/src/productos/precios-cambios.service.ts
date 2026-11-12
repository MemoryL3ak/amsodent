import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { esRolAdmin, permisosEfectivos } from '../auth/permisos';

/* ── Alerta de actualización de precio de producto (2026-11-05) ──────────────
   Pedido de Ariel: "agregar alerta de actualización de precio producto".
   Cada vez que cambia el costo o una lista de precios de un producto (al
   editarlo, en una carga masiva o al deshacer una carga) queda una fila en
   `productos_precio_cambios` (antes → después, quién y cuándo) y, si cambió
   una LISTA de precios, un aviso en la campana de todo el equipo:
   «Precio actualizado: SKU — producto · Lista 1 $25.126 → $26.000».
   · El costo se registra en el historial, pero no se avisa (es reservado).
   · Los avisos se agrupan: mientras alguien tiene uno sin leer de las últimas
     3 horas, se le actualiza ese en vez de sumarle otro (una tarde corrigiendo
     precios no deja 40 avisos, deja uno que dice cuántos productos cambiaron).
   · Quien hizo el cambio no se avisa a sí mismo.
   El aviso abre Productos filtrado por «Precio actualizado: últimos 7 días».
   Sin la migración 20261105_productos_precio_cambios no hay historial, pero
   el aviso sale igual. Nunca frena el guardado del producto. */

export const CAMPOS_PRECIO = ['costo', 'lista1', 'lista2', 'lista3'] as const;
export type CampoPrecio = (typeof CAMPOS_PRECIO)[number];
export const NOMBRE_CAMPO: Record<CampoPrecio, string> = { costo: 'Costo', lista1: 'Lista 1', lista2: 'Lista 2', lista3: 'Lista 3' };
export type CambioPrecio = { producto_id: number; sku: string | null; nombre: string | null; campo: CampoPrecio; anterior: number | null; nuevo: number | null };
export type OrigenCambio = 'edicion' | 'carga_masiva' | 'reversion';

const num = (v: any): number | null => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pesos = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
const AGRUPAR_MS = 3 * 3600 * 1000;
const MAX_EN_AVISO = 30;

/* Qué precios cambian al aplicar `despues` sobre `antes`. Un campo ausente en
   `despues` no cuenta; un precio vacío equivale a 0 (igual que cambioDePrecio). */
export function cambiosDePrecio(antes: Record<string, any> | null, despues: Record<string, any> | null, producto: { id: any; sku?: any; nombre?: any }): CambioPrecio[] {
  const lista: CambioPrecio[] = [];
  for (const campo of CAMPOS_PRECIO) {
    if (despues?.[campo] === undefined || despues?.[campo] === null) continue;
    const nuevo = num(despues[campo]) ?? 0;
    const anterior = num(antes?.[campo]) ?? 0;
    if (nuevo === anterior) continue;
    lista.push({ producto_id: Number(producto.id), sku: String(producto.sku ?? '').trim() || null, nombre: String(producto.nombre ?? '').trim() || null, campo, anterior: num(antes?.[campo]), nuevo });
  }
  return lista;
}

/* Texto del aviso para un grupo de cambios de LISTA (sin el costo). */
export function mensajeDeCambios(productos: { sku: string | null; nombre: string | null; cambios: { campo: CampoPrecio; anterior: number | null; nuevo: number | null }[] }[]): string {
  if (productos.length === 1) {
    const p = productos[0];
    const detalle = p.cambios.map((c) => `${NOMBRE_CAMPO[c.campo]} ${pesos(c.anterior)} → ${pesos(c.nuevo)}`).join(' · ');
    return `Precio actualizado: ${[p.sku, p.nombre].filter(Boolean).join(' — ') || 'producto'} · ${detalle}`;
  }
  const nombres = productos.slice(0, 4).map((p) => p.sku || p.nombre || 'producto');
  return `${productos.length} productos cambiaron de precio: ${nombres.join(', ')}${productos.length > 4 ? ` y ${productos.length - 4} más` : ''}.`;
}

@Injectable()
export class PreciosCambiosService {
  private readonly logger = new Logger(PreciosCambiosService.name);

  /* (2026-11-12) Quien quiera enterarse de que hay cambios nuevos en el
     historial (el envío al Google Sheet de precios) se anota aquí. */
  private readonly oyentes: (() => void)[] = [];

  constructor(private supabase: SupabaseService) {}

  alRegistrar(fn: () => void) {
    this.oyentes.push(fn);
  }

  private get db() {
    return this.supabase.getClient();
  }

  /* ¿Puede ver el costo? Admin o perfil con «ver_costos» (misma regla que la ficha del producto). */
  async puedeVerCostos(userId: string): Promise<boolean> {
    if (!userId) return false;
    const { data: perfil } = await this.db.from('profiles').select('rol, permission_profile_id').eq('id', userId).maybeSingle();
    const rol = String((perfil as any)?.rol || '').trim().toLowerCase();
    if (esRolAdmin(rol)) return true;
    let permisosPerfil: any = null;
    if ((perfil as any)?.permission_profile_id) {
      const { data: asignado } = await this.db.from('permission_profiles').select('permisos').eq('id', (perfil as any).permission_profile_id).maybeSingle();
      permisosPerfil = (asignado as any)?.permisos ?? null;
    }
    return permisosEfectivos(rol, permisosPerfil).includes('ver_costos');
  }

  /* Guarda el historial y deja el aviso. Nunca lanza. */
  async registrar(cambios: CambioPrecio[], meta: { usuario?: string | null; origen: OrigenCambio; carga_id?: number | null }): Promise<void> {
    if (!cambios.length) return;
    const usuario = String(meta.usuario || '').trim().toLowerCase() || null;
    try {
      for (let i = 0; i < cambios.length; i += 500) {
        const { error } = await this.db.from('productos_precio_cambios').insert(
          cambios.slice(i, i + 500).map((c) => ({ ...c, origen: meta.origen, carga_id: meta.carga_id ?? null, usuario_email: usuario })),
        );
        if (error) {
          if (!/does not exist|schema cache|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) this.logger.warn(`Historial de precios: ${error.message}`);
          break;
        }
      }
    } catch (e: any) {
      this.logger.warn(`Historial de precios: ${e?.message || e}`);
    }
    // Cada fila del historial nace pendiente de enviar al Google Sheet de precios.
    for (const fn of this.oyentes) {
      try {
        fn();
      } catch {
        /* el envío al Sheet nunca frena el guardado */
      }
    }
    try {
      await this.avisar(cambios, usuario, meta.origen);
    } catch (e: any) {
      this.logger.warn(`Aviso de cambio de precio: ${e?.message || e}`);
    }
  }

  private async avisar(cambios: CambioPrecio[], usuario: string | null, origen: OrigenCambio) {
    // Solo las listas de precios: el costo no se difunde.
    const porProducto = new Map<number, { id: number; sku: string | null; nombre: string | null; cambios: { campo: CampoPrecio; anterior: number | null; nuevo: number | null }[] }>();
    for (const c of cambios) {
      if (c.campo === 'costo') continue;
      const p = porProducto.get(c.producto_id) || { id: c.producto_id, sku: c.sku, nombre: c.nombre, cambios: [] };
      p.cambios.push({ campo: c.campo, anterior: c.anterior, nuevo: c.nuevo });
      porProducto.set(c.producto_id, p);
    }
    const nuevos = [...porProducto.values()];
    if (!nuevos.length) return;

    const { data: perfiles } = await this.db.from('profiles').select('email');
    const destinatarios = [...new Set(((perfiles || []) as any[]).map((p) => String(p?.email || '').trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e) && e !== usuario))];
    if (!destinatarios.length) return;

    // Avisos sin leer de las últimas horas: se actualizan en vez de sumar otro.
    const desde = new Date(Date.now() - AGRUPAR_MS).toISOString();
    const { data: abiertos } = await this.db
      .from('notificaciones')
      .select('id, user_email, metadata')
      .eq('tipo', 'precio_actualizado')
      .is('leida_at', null)
      .gte('creado_at', desde)
      .range(0, 999);
    const abiertoDe = new Map<string, any>();
    for (const n of (abiertos || []) as any[]) {
      const email = String(n?.user_email || '').toLowerCase();
      if (!abiertoDe.has(email)) abiertoDe.set(email, n);
    }

    const armar = (previos: any[]) => {
      // Lo nuevo reemplaza al mismo producto que ya venía en el aviso; su «anterior» es el del primer cambio.
      const mapa = new Map<number, any>();
      for (const p of previos) if (p?.id != null) mapa.set(Number(p.id), p);
      for (const p of nuevos) {
        const ya = mapa.get(p.id);
        if (!ya) { mapa.set(p.id, p); continue; }
        const campos = new Map<string, any>((ya.cambios || []).map((c: any) => [c.campo, c]));
        for (const c of p.cambios) campos.set(c.campo, { campo: c.campo, anterior: campos.get(c.campo)?.anterior ?? c.anterior, nuevo: c.nuevo });
        mapa.set(p.id, { ...ya, sku: p.sku, nombre: p.nombre, cambios: [...campos.values()].filter((c: any) => c.anterior !== c.nuevo) });
      }
      const productos = [...mapa.values()].filter((p) => (p.cambios || []).length);
      return {
        mensaje: mensajeDeCambios(productos),
        metadata: { total: productos.length, productos: productos.slice(0, MAX_EN_AVISO), origen, por: usuario },
      };
    };

    const insertar: any[] = [];
    for (const email of destinatarios) {
      const abierto = abiertoDe.get(email);
      if (abierto) {
        const previos = Array.isArray(abierto.metadata?.productos) ? abierto.metadata.productos : [];
        const { mensaje, metadata } = armar(previos);
        const { error } = await this.db.from('notificaciones').update({ mensaje, metadata }).eq('id', abierto.id);
        if (error) this.logger.warn(`Aviso de precio (actualizar ${abierto.id}): ${error.message}`);
      } else {
        const { mensaje, metadata } = armar([]);
        insertar.push({ user_email: email, tipo: 'precio_actualizado', mensaje, link: '/productos?precio=7', metadata });
      }
    }
    if (insertar.length) {
      const { error } = await this.db.from('notificaciones').insert(insertar);
      if (error) this.logger.warn(`Aviso de precio: ${error.message}`);
    }
  }

  /* Cambios recientes (para resaltar en Productos el «antes → después»). El
     costo solo viaja si quien consulta puede verlo. */
  async recientes(dias: number, verCostos: boolean) {
    const d = Math.max(1, Math.min(Number(dias) || 30, 90));
    const desde = new Date(Date.now() - d * 86400000).toISOString();
    let q = this.db
      .from('productos_precio_cambios')
      .select('id, producto_id, sku, campo, anterior, nuevo, origen, usuario_email, created_at')
      .gte('created_at', desde);
    if (!verCostos) q = q.neq('campo', 'costo');
    const { data, error } = await q.order('created_at', { ascending: false }).range(0, 4999);
    if (error) return { listo: false, cambios: [] };
    return { listo: true, cambios: data || [] };
  }

  /* Historial de un producto (ficha de edición). */
  async deProducto(productoId: number, verCostos: boolean) {
    let q = this.db
      .from('productos_precio_cambios')
      .select('id, campo, anterior, nuevo, origen, usuario_email, created_at')
      .eq('producto_id', productoId);
    if (!verCostos) q = q.neq('campo', 'costo');
    const { data, error } = await q.order('created_at', { ascending: false }).limit(40);
    if (error) return { listo: false, cambios: [] };
    return { listo: true, cambios: data || [] };
  }
}
