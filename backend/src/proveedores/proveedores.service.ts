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
      // Condición de compra (migración 20260916). El plazo solo se guarda
      // cuando la condición es crédito; en cualquier otro caso queda en null.
      condicion_compra: CONDICIONES_COMPRA.includes(String(body?.condicion_compra || ''))
        ? String(body.condicion_compra)
        : null,
      credito_dias:
        String(body?.condicion_compra || '') === 'credito' && Number.isFinite(Number(body?.credito_dias)) && String(body?.credito_dias ?? '') !== ''
          ? Math.max(0, Math.min(365, Math.round(Number(body.credito_dias))))
          : null,
    };
  }

  /* Si la migración de la condición de compra aún no está aplicada, se guarda
     el resto en vez de fallar (mismo criterio que el resto del proyecto). */
  private sinCondicion(fila: Record<string, any>) {
    const { condicion_compra, credito_dias, ...resto } = fila;
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
