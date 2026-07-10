import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

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
    return {
      razon_social: String(body?.razon_social || '').trim(),
      rut: String(body?.rut || '').trim(),
      correo: String(body?.correo || '').trim(),
      telefono: String(body?.telefono || '').trim(),
      contacto: String(body?.contacto || '').trim(),
      direccion: String(body?.direccion || '').trim(),
      rubro: String(body?.rubro || '').trim(),
      observaciones: String(body?.observaciones || '').trim(),
    };
  }

  async create(body: any, creadoPor: string) {
    const fila = this.normalizar(body);
    if (!fila.razon_social) throw new BadRequestException('La razón social es obligatoria.');
    const { data, error } = await this.supabase.getClient()
      .from('proveedores')
      .insert([{ ...fila, creado_por: creadoPor }])
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: number, body: any) {
    const fila = this.normalizar(body);
    if (!fila.razon_social) throw new BadRequestException('La razón social es obligatoria.');
    const { data, error } = await this.supabase.getClient()
      .from('proveedores')
      .update(fila)
      .eq('id', id)
      .select()
      .single();
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
