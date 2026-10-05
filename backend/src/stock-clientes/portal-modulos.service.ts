import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ── Módulos del portal por cliente (2026-10-05) ─────────────────────────────
   Pedido de Ariel: "habilitar o deshabilitar módulos por cliente, por ejemplo
   habilitar Showroom pero desactivar Ofertas". Cada RUT del portal tiene en
   `stock_clientes_portal.modulos` (jsonb) qué secciones ve. Sin dato = todo
   habilitado (así estaban todos hasta hoy).
   · Resumen y Usuarios no se apagan (Usuarios lo decide el rol).
   · Mis cotizaciones queda encendida si el cliente puede pedir desde alguna
     sección (Stock, Ofertas, Showroom o Explorador): ahí llega el pedido.
   · Apagar el Explorador no apaga el carrito: el cliente sigue pidiendo desde
     Showroom/Ofertas/Stock y su carrito aparece como "Mi pedido".
   · El servidor también lo exige: una sección apagada no entrega sus datos y,
     si Ofertas está apagada, un pedido no lleva precio de oferta. */

export const MODULOS_PORTAL: { clave: string; nombre: string; detalle: string; pide: boolean }[] = [
  { clave: 'declaracion', nombre: 'Gestión de Stock', detalle: 'Inventario del cliente, declaraciones y sucursales.', pide: true },
  { clave: 'solicitudes', nombre: 'Mis cotizaciones', detalle: 'Pedidos, cotizaciones, aprobación y pago.', pide: false },
  { clave: 'ofertas', nombre: 'Ofertas', detalle: 'Ofertas especiales vigentes y sus precios.', pide: true },
  { clave: 'showroom', nombre: 'Showroom', detalle: 'Catálogo de venta al público con precio sugerido.', pide: true },
  { clave: 'explorador', nombre: 'Explorador de precios', detalle: 'Comparador de precios de otras tiendas dentales.', pide: true },
  { clave: 'actividad', nombre: 'Actividad', detalle: 'Línea de tiempo de los pedidos de la cuenta.', pide: false },
];
const CLAVES = MODULOS_PORTAL.map((m) => m.clave);
export type ModulosPortal = Record<string, boolean>;

const normalizarRut = (v: any) => String(v ?? '').toLowerCase().replace(/[^0-9k]/g, '');
const MIGRACION = 'Falta aplicar la migración 20261006_portal_modulos.sql en Supabase (módulos del portal por cliente).';
const faltaColumna = (e: any) => /modulos/.test(String(e?.message || '')) && /column|schema cache/i.test(String(e?.message || ''));

/* Lo guardado → el mapa completo, con las reglas aplicadas. */
export function normalizarModulos(crudo: any): ModulosPortal {
  const fuente = crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? crudo : {};
  const m: ModulosPortal = {};
  for (const c of CLAVES) m[c] = fuente[c] !== false;
  if (MODULOS_PORTAL.some((x) => x.pide && m[x.clave])) m.solicitudes = true;
  return m;
}

// Origen del pedido (carrito) → módulo del que salió.
export const MODULO_DE_ORIGEN: Record<string, string> = { stock: 'declaracion', explorador: 'explorador', showroom: 'showroom', ofertas: 'ofertas' };

@Injectable()
export class PortalModulosService {
  private readonly logger = new Logger(PortalModulosService.name);
  private cache = new Map<string, { en: number; modulos: ModulosPortal }>();

  constructor(private supabase: SupabaseService) {}

  /* Módulos de un RUT (30 s en memoria: el portal los consulta en cada pedido de datos). */
  async de(rut: string): Promise<ModulosPortal> {
    const r = normalizarRut(rut);
    const c = this.cache.get(r);
    if (c && Date.now() - c.en < 30_000) return c.modulos;
    let modulos = normalizarModulos(null);
    try {
      const { data, error } = await this.supabase.getClient().from('stock_clientes_portal').select('modulos').eq('rut', r).maybeSingle();
      if (!error) modulos = normalizarModulos((data as any)?.modulos);
      else if (!faltaColumna(error)) this.logger.warn(`No se pudieron leer los módulos del portal de ${r}: ${error.message}`);
    } catch (e: any) {
      this.logger.warn(`No se pudieron leer los módulos del portal de ${r}: ${e?.message || e}`);
    }
    this.cache.set(r, { en: Date.now(), modulos });
    return modulos;
  }

  async habilitado(rut: string, clave: string) {
    return (await this.de(rut))[clave] !== false;
  }

  /* Corta el pedido de datos de una sección apagada. */
  async exigir(rut: string, clave: string) {
    if (await this.habilitado(rut, clave)) return;
    const nombre = MODULOS_PORTAL.find((m) => m.clave === clave)?.nombre || clave;
    throw new ForbiddenException(`La sección «${nombre}» no está habilitada para tu cuenta. Consulta con tu ejecutivo de Amsodent.`);
  }

  /* Lado Amsodent: guarda los módulos de un RUT con acceso al portal. */
  async guardar(rut: string, entrada: any, adminEmail: string | null) {
    const r = normalizarRut(rut);
    if (!r) throw new BadRequestException('Indica el RUT del cliente.');
    const crudo: Record<string, boolean> = {};
    for (const c of CLAVES) if (entrada && typeof entrada[c] === 'boolean') crudo[c] = entrada[c];
    const modulos = normalizarModulos(crudo);
    const db = this.supabase.getClient();
    const { data: fila, error: errFila } = await db.from('stock_clientes_portal').select('rut').eq('rut', r).maybeSingle();
    if (errFila) throw new BadRequestException(errFila.message);
    if (!fila) throw new BadRequestException('Ese cliente no tiene acceso al portal: habilítalo primero.');
    const { error } = await db.from('stock_clientes_portal').update({ modulos, updated_at: new Date().toISOString() }).eq('rut', r);
    if (error) throw new BadRequestException(faltaColumna(error) ? MIGRACION : error.message);
    this.cache.delete(r);
    const apagados = MODULOS_PORTAL.filter((m) => !modulos[m.clave]).map((m) => m.nombre);
    this.logger.log(`Módulos del portal de ${r} por ${adminEmail || 'plataforma'}: ${apagados.length ? `apagados ${apagados.join(', ')}` : 'todos encendidos'}`);
    return { rut: r, modulos };
  }

  /* Para el listado de accesos: los módulos de varios RUT de una vez. */
  async deVarios(): Promise<Map<string, ModulosPortal> | null> {
    const { data, error } = await this.supabase.getClient().from('stock_clientes_portal').select('rut, modulos').range(0, 20000);
    if (error) return null; // migración pendiente: todos con todo
    const m = new Map<string, ModulosPortal>();
    for (const f of data || []) m.set(normalizarRut((f as any).rut), normalizarModulos((f as any).modulos));
    return m;
  }
}
