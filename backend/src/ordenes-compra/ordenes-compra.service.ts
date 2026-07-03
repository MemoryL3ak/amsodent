import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class OrdenesCompraService {
  constructor(private supabase: SupabaseService) {}

  async listar() {
    const { data, error } = await this.supabase.getClient()
      .from('ordenes_compra')
      .select('*')
      .order('numero', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data || [];
  }

  async getNextNumero() {
    const { data, error } = await this.supabase.getClient()
      .from('ordenes_compra')
      .select('numero')
      .order('numero', { ascending: false })
      .limit(1);
    if (error) throw new BadRequestException(error.message);
    const max = data && data.length ? Number(data[0].numero) : 0;
    return { numero: max + 1 };
  }

  async findOne(id: number) {
    const { data, error } = await this.supabase.getClient()
      .from('ordenes_compra')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Normaliza el body y recalcula totales en el servidor (fuente de verdad).
  private normalizar(body: any) {
    const items = Array.isArray(body?.items)
      ? body.items.map((it: any) => {
          const cantidad = Number(it?.cantidad || 0);
          const valor = Number(it?.valor_unitario || 0);
          return {
            sku: String(it?.sku || '').trim(),
            descripcion: String(it?.descripcion || '').trim(),
            cantidad,
            valor_unitario: valor,
            total: Math.round(cantidad * valor),
          };
        }).filter((it: any) => it.descripcion || it.sku)
      : [];
    const subtotal = items.reduce((a: number, it: any) => a + it.total, 0);
    const iva = Math.round(subtotal * 0.19);
    const total = subtotal + iva;
    return {
      fecha_emision: body?.fecha_emision || null,
      proveedor_razon_social: String(body?.proveedor_razon_social || '').trim(),
      proveedor_rut: String(body?.proveedor_rut || '').trim(),
      proveedor_correo: String(body?.proveedor_correo || '').trim(),
      vendedor_nombre: String(body?.vendedor_nombre || '').trim(),
      vendedor_correo: String(body?.vendedor_correo || '').trim(),
      items,
      subtotal_neto: subtotal,
      iva,
      total,
      observaciones: String(body?.observaciones || '').trim(),
    };
  }

  async create(body: any, creadoPor: string) {
    const fila = this.normalizar(body);
    const { numero } = await this.getNextNumero();
    const { data, error } = await this.supabase.getClient()
      .from('ordenes_compra')
      .insert([{ ...fila, numero, creado_por: creadoPor }])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: number, body: any) {
    const fila = this.normalizar(body);
    const { data, error } = await this.supabase.getClient()
      .from('ordenes_compra')
      .update(fila)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: number) {
    const { error } = await this.supabase.getClient()
      .from('ordenes_compra')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
