import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// Condiciones de compra acordadas con el proveedor (2026-09-16).
const CONDICIONES_COMPRA = ['credito', 'contado', 'tarjeta_credito'];

@Injectable()
export class ProveedoresService {
  constructor(private supabase: SupabaseService) {}

  async listar() {
    const { data, error } = await this.supabase.getClient()
      .from('proveedores')
      .select('*')
      .order('razon_social', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async findOne(id: number) {
    const { data, error } = await this.supabase.getClient()
      .from('proveedores')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  private normalizar(body: any) {
    // Listas de texto (marcas que distribuye / palabras clave): se limpian,
    // deduplican (case-insensitive) y acotan. Requiere la migración
    // 20260904_proveedores_marcas_keywords.sql.
    const lista = (v: any, max = 50) => {
      const vistos = new Set<string>();
      const out: string[] = [];
      for (const item of Array.isArray(v) ? v : []) {
        const s = String(item || '').trim().slice(0, 80);
        if (!s) continue;
        const k = s.toLowerCase();
        if (vistos.has(k)) continue;
        vistos.add(k);
        out.push(s);
        if (out.length >= max) break;
      }
      return out;
    };

    const condiciones = ProveedoresService.condicionesDe(body);
    const preferida = condiciones.find((c) => c.preferida) || condiciones[0] || null;

    return {
      razon_social: String(body?.razon_social || '').trim(),
      rut: String(body?.rut || '').trim(),
      correo: String(body?.correo || '').trim(),
      telefono: String(body?.telefono || '').trim(),
      contacto: String(body?.contacto || '').trim(),
      direccion: String(body?.direccion || '').trim(),
      rubro: String(body?.rubro || '').trim(),
      observaciones: String(body?.observaciones || '').trim(),
      marcas: lista(body?.marcas),
      palabras_clave: lista(body?.palabras_clave),
      // Condiciones de compra. Un proveedor puede ofrecer varias (crédito a
      // 30 días O contado con descuento, por ejemplo), así que se guardan como
      // lista; `condicion_compra` / `credito_dias` conservan la PREFERIDA para
      // que siga sirviendo todo lo que ya las lee.
      condiciones_compra: condiciones,
      condicion_compra: preferida?.condicion ?? null,
      credito_dias: preferida?.credito_dias ?? null,
    };
  }

  /* Normaliza la lista de condiciones de compra. Acepta tanto el formato nuevo
     (`condiciones_compra`) como el antiguo de un solo campo, para que un
     cliente sin actualizar siga guardando bien. */
  private static condicionesDe(body: any) {
    const crudas = Array.isArray(body?.condiciones_compra)
      ? body.condiciones_compra
      : body?.condicion_compra
      ? [{ condicion: body.condicion_compra, credito_dias: body.credito_dias, preferida: true }]
      : [];

    const vistas = new Set<string>();
    const out: Array<{ condicion: string; credito_dias: number | null; nota: string; preferida: boolean }> = [];
    for (const c of crudas) {
      const condicion = String(c?.condicion || '').trim();
      if (!CONDICIONES_COMPRA.includes(condicion)) continue;
      const dias =
        condicion === 'credito' && String(c?.credito_dias ?? '') !== '' && Number.isFinite(Number(c?.credito_dias))
          ? Math.max(0, Math.min(365, Math.round(Number(c.credito_dias))))
          : null;
      // La misma condición con el mismo plazo no se repite; con otro plazo sí
      // (crédito a 30 y a 60 días son dos opciones distintas).
      const clave = `${condicion}|${dias ?? ''}`;
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      out.push({ condicion, credito_dias: dias, nota: String(c?.nota || '').trim().slice(0, 120), preferida: !!c?.preferida });
      if (out.length >= 10) break;
    }
    // Siempre hay exactamente una preferida mientras haya alguna opción.
    if (out.length && !out.some((c) => c.preferida)) out[0].preferida = true;
    let yaHay = false;
    for (const c of out) {
      if (c.preferida && yaHay) c.preferida = false;
      if (c.preferida) yaHay = true;
    }
    return out;
  }

  /* Si la migración de la condición de compra aún no está aplicada, se guarda
     el resto en vez de fallar (mismo criterio que el resto del proyecto). */
  private sinCondicion(fila: Record<string, any>) {
    const { condicion_compra, credito_dias, condiciones_compra, ...resto } = fila;
    return resto;
  }
  private faltaColumna(error: any) {
    const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
    return /condicion_compra|credito_dias/.test(msg) && /column|schema cache/.test(msg);
  }

  async create(body: any, creadoPor: string) {
    const fila = this.normalizar(body);
    if (!fila.razon_social) throw new BadRequestException('La razón social es obligatoria.');
    const insertar = (f: Record<string, any>) =>
      this.supabase.getClient()
        .from('proveedores')
        .insert([{ ...f, creado_por: creadoPor }])
        .select()
        .single();
    let { data, error } = await insertar(fila);
    if (error && this.faltaColumna(error)) ({ data, error } = await insertar(this.sinCondicion(fila)));
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: number, body: any) {
    const fila = this.normalizar(body);
    if (!fila.razon_social) throw new BadRequestException('La razón social es obligatoria.');
    const actualizar = (f: Record<string, any>) =>
      this.supabase.getClient()
        .from('proveedores')
        .update(f)
        .eq('id', id)
        .select()
        .single();
    let { data, error } = await actualizar(fila);
    if (error && this.faltaColumna(error)) ({ data, error } = await actualizar(this.sinCondicion(fila)));
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: number) {
    const { error } = await this.supabase.getClient()
      .from('proveedores')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
