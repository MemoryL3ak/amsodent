import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ClientesService {
  constructor(private supabase: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('*')
      .range(0, 20000)
      .order('id', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: number) {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException('Cliente no encontrado');
    return data;
  }

  async create(body: {
    rut: string;
    nombre: string;
    departamento?: string;
    municipalidad?: string;
    region: string;
    comuna: string;
    direccion: string;
    contacto: string;
    email: string;
    telefono?: string;
    condiciones_venta?: string;
  }) {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .insert([body])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: number, body: Record<string, any>) {
    const { data, error } = await this.supabase
      .getClient()
      .from('clientes')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async remove(id: number) {
    const { error } = await this.supabase
      .getClient()
      .from('clientes')
      .delete()
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
