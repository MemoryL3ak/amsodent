import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { BsaleFacturacionService, normRut } from './bsale-facturacion.service';

/* ── Giros del cliente → Bsale (2026-10-23) ──────────────────────────────────
   Pedido de Ariel: "asignar más de un giro a un cliente, considerar que esto
   también se debe enviar a Bsale". La ficha del cliente guarda una LISTA de
   giros (clientes.giros; el primero es el principal). Bsale tiene UN solo
   texto de giro por cliente (`activity`, docs.bsale.dev/clientes), así que se
   mandan unidos con « / » y recortados a ACTIVITY_MAX.

   Cuándo se envía:
   · Al guardar la ficha (crear o editar) con giros distintos a los que tenía:
     si el RUT ya está en Bsale se actualiza su `activity` (PUT
     /clients/{id}.json, repitiendo los demás datos del cliente tal como están
     para no borrarlos). Si no está, no se crea nada: el cliente se crea en
     Bsale cuando se le emite su primer documento, y ahí van sus giros.
   · Al armar una guía, orden, factura libre o venta directa de un cliente que
     NO está en Bsale, el giro propuesto sale de la ficha (y si la ficha no
     tiene, del giro de la cotización, como antes).
   Nunca frena el guardado de la ficha: el resultado viaja en `bsale` para
   mostrarlo. Con BSALE_EMISION=off solo se informa (misma llave que el resto
   de la emisión). La misma lectura de giros está en src/lib/giros.js. */

export const GIRO_MAX = 80; // largo de cada giro en la ficha
export const GIROS_MAX = 6; // cuántos giros admite la ficha
export const ACTIVITY_MAX = 80; // lo que se manda a Bsale (un solo texto)
export const SEPARADOR_GIROS = ' / ';

const clave = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/* Lista limpia: sin vacíos ni repetidos (sin distinguir mayúsculas ni tildes),
   cada uno recortado a GIRO_MAX y como mucho GIROS_MAX. Acepta un arreglo o un
   texto con un giro por línea. */
export function normalizarGiros(valor: any): string[] {
  const crudos: any[] = Array.isArray(valor) ? valor : String(valor ?? '').split(/\r?\n/);
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const v of crudos) {
    const g = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, GIRO_MAX).trim();
    if (!g) continue;
    const k = clave(g);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(g);
    if (out.length >= GIROS_MAX) break;
  }
  return out;
}

/* Un solo texto para `activity`: los giros que quepan, en orden, unidos con « / ». */
export function girosParaBsale(giros: any): string {
  const lista = normalizarGiros(giros);
  if (!lista.length) return '';
  let acc = '';
  for (const g of lista) {
    const sig = acc ? `${acc}${SEPARADOR_GIROS}${g}` : g;
    if (sig.length > ACTIVITY_MAX) break;
    acc = sig;
  }
  return acc || lista[0].slice(0, ACTIVITY_MAX).trim();
}

/* Giros de una fila de `clientes` (tolera la columna sin migrar). */
export function leerGiros(fila: any): string[] {
  return normalizarGiros(Array.isArray(fila?.giros) ? fila.giros : []);
}

export type ResultadoGirosBsale = {
  estado: 'actualizado' | 'sin_cambios' | 'no_esta_en_bsale' | 'apagada' | 'sin_rut' | 'sin_giros' | 'error';
  mensaje: string;
  activity?: string;
  bsale_id?: number | null;
};

const COLS_FICHA = 'id, rut, nombre, tipo_cliente, direccion, comuna, region, email, telefono, condiciones_venta';

@Injectable()
export class BsaleClientesService {
  private readonly logger = new Logger(BsaleClientesService.name);

  constructor(
    private supabase: SupabaseService,
    private facturacion: BsaleFacturacionService,
  ) {}

  rutBsale(v: any): string {
    const n = normRut(v);
    return n.length > 1 ? `${n.slice(0, -1)}-${n.slice(-1)}` : n;
  }

  /* El RUT se guarda en la ficha en varios formatos (con puntos, con guion,
     plano, con k minúscula). Misma lista que creditoCliente (venta directa). */
  variantesRut(rut: any): string[] {
    const n = normRut(rut);
    if (n.length < 2) return [];
    const cuerpo = n.slice(0, -1);
    const dv = n.slice(-1);
    const conPuntos = `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
    return [...new Set([conPuntos, `${cuerpo}-${dv}`, n, conPuntos.toLowerCase(), `${cuerpo}-${dv}`.toLowerCase(), n.toLowerCase()])];
  }

  /* La ficha del cliente en el sistema (la más antigua si el RUT está
     repetido), con sus giros ya limpios. null si no existe o si falla. */
  async fichaPorRut(rut: any): Promise<any | null> {
    const variantes = this.variantesRut(rut);
    if (!variantes.length) return null;
    const db = this.supabase.getClient();
    const buscar = (cols: string) => db.from('clientes').select(cols).in('rut', variantes).order('id', { ascending: true }).limit(1);
    let r: any = await buscar(`${COLS_FICHA}, giros`);
    if (r.error && /giros|42703/i.test(`${r.error.message} ${r.error.code || ''}`)) r = await buscar(COLS_FICHA);
    if (r.error) {
      this.logger.warn(`Ficha del cliente ${this.rutBsale(rut)}: ${r.error.message}`);
      return null;
    }
    const fila = (r.data || [])[0] || null;
    return fila ? { ...fila, giros: leerGiros(fila) } : null;
  }

  /* El giro que se propone para un cliente que todavía no está en Bsale: los
     de su ficha; si la ficha no tiene, el que venga (el de la cotización). */
  async giroPropuesto(rut: any, respaldo: any): Promise<{ giro: string; giros: string[]; de_ficha: boolean }> {
    const ficha = await this.fichaPorRut(rut);
    const giros: string[] = ficha?.giros || [];
    if (giros.length) return { giro: girosParaBsale(giros), giros, de_ficha: true };
    const g = String(respaldo ?? '').replace(/\s+/g, ' ').trim().slice(0, ACTIVITY_MAX);
    return { giro: g, giros: g ? [g] : [], de_ficha: false };
  }

  /* Aviso cuando la ficha dice un giro y Bsale tiene otro: el documento sale
     con el de Bsale. null si coinciden o la ficha no tiene giros. */
  async avisoGiroDistinto(rut: any, activityBsale: any): Promise<string | null> {
    const ficha = await this.fichaPorRut(rut);
    const esperado = girosParaBsale(ficha?.giros || []);
    const enBsale = String(activityBsale ?? '').replace(/\s+/g, ' ').trim();
    if (!esperado || clave(esperado) === clave(enBsale)) return null;
    return `En Bsale el giro de este cliente es «${enBsale || '—'}» y en su ficha «${esperado}»: el documento sale con el de Bsale. Para cambiarlo, guarda la ficha del cliente (se envía a Bsale) o corrígelo en Bsale.`;
  }

  async clientePorRut(rut: any) {
    const code = this.rutBsale(rut);
    if (!code) return null;
    const r = await this.facturacion.apiGet(`/clients.json?code=${encodeURIComponent(code)}&limit=5`);
    const items: any[] = r?.items || [];
    return items.find((c) => normRut(c?.code) === normRut(code)) || null;
  }

  /* Pone en Bsale el giro de la ficha (los giros unidos). Solo si el RUT ya
     está en Bsale; nunca lanza: devuelve qué pasó. */
  async sincronizarGiros(rut: any, giros: any): Promise<ResultadoGirosBsale> {
    const activity = girosParaBsale(giros);
    const code = this.rutBsale(rut);
    if (!code) return { estado: 'sin_rut', mensaje: 'El cliente no tiene RUT: no se puede buscar en Bsale.' };
    // Sin giros no se toca Bsale: a una empresa le exige giro para emitir y
    // borrárselo la dejaría sin poder facturar.
    if (!activity) return { estado: 'sin_giros', mensaje: 'La ficha quedó sin giros: en Bsale se conserva el que tenía.' };
    if (!process.env.BSALE_ACCESS_TOKEN) return { estado: 'apagada', mensaje: 'La integración con Bsale no está configurada (falta el token): el giro no se envió.', activity };
    try {
      const c = await this.clientePorRut(code);
      if (!c) return { estado: 'no_esta_en_bsale', mensaje: `El RUT ${code} no está en Bsale: el giro irá cuando se cree el cliente al emitirle su primer documento.`, activity };
      const actual = String(c.activity ?? '').replace(/\s+/g, ' ').trim();
      if (actual === activity) return { estado: 'sin_cambios', mensaje: 'Bsale ya tiene este giro.', activity, bsale_id: Number(c.id) };
      if (!this.facturacion.emisionActiva) {
        return { estado: 'apagada', mensaje: `La emisión en Bsale está apagada (BSALE_EMISION=off): el giro «${activity}» no se envió. En Bsale el cliente sigue con «${actual || '—'}».`, activity, bsale_id: Number(c.id) };
      }
      // Se repiten los datos que Bsale ya tiene para que el PUT no los borre.
      const solicitud: Record<string, any> = { id: Number(c.id), activity };
      for (const k of ['firstName', 'lastName', 'company', 'email', 'phone', 'address', 'city', 'municipality', 'note', 'facebook', 'twitter', 'hasCredit', 'maxCredit', 'accumulatePoints']) {
        if (c[k] !== undefined && c[k] !== null) solicitud[k] = c[k];
      }
      const r = await this.facturacion.apiEnviar('PUT', `/clients/${Number(c.id)}.json`, solicitud);
      const quedo = String(r?.activity ?? '').replace(/\s+/g, ' ').trim();
      if (quedo && quedo !== activity) {
        return { estado: 'error', mensaje: `Bsale guardó «${quedo}» en vez de «${activity}»: revisa el largo del giro.`, activity, bsale_id: Number(c.id) };
      }
      this.logger.log(`Giro del cliente ${code} actualizado en Bsale (id ${c.id}): «${activity}»${actual ? ` (antes «${actual}»)` : ''}`);
      return { estado: 'actualizado', mensaje: `Giro actualizado en Bsale: «${activity}»${actual ? ` (antes «${actual}»)` : ''}.`, activity, bsale_id: Number(c.id) };
    } catch (e: any) {
      return { estado: 'error', mensaje: `No se pudo actualizar el giro en Bsale: ${String(e?.message || e).slice(0, 200)}`, activity };
    }
  }
}
