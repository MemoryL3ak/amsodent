import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

type EstadoBitacora = 'Pendiente' | 'Ingresada';

interface CrearInput {
  id_cotizacion: string;
  estado?: EstadoBitacora;
  observaciones?: string | null;
  creado_por_email: string;
  creado_por_nombre?: string | null;
}

interface ActualizarInput {
  estado?: EstadoBitacora;
  observaciones?: string | null;
  actualizado_por_email: string;
  actualizado_por_nombre?: string | null;
}

@Injectable()
export class BitacoraService {
  constructor(private supabase: SupabaseService) {}

  async listar() {
    const { data, error } = await this.supabase
      .getClient()
      .from('bitacora_cotizaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, 5000);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async crear(input: CrearInput) {
    const id_cotizacion = (input.id_cotizacion || '').trim();
    if (!id_cotizacion) throw new BadRequestException('id_cotizacion es obligatorio');

    const estado = input.estado || 'Pendiente';
    if (!['Pendiente', 'Ingresada'].includes(estado)) {
      throw new BadRequestException('Estado inválido');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('bitacora_cotizaciones')
      .insert([
        {
          id_cotizacion,
          estado,
          observaciones: input.observaciones || null,
          creado_por_email: input.creado_por_email,
          creado_por_nombre: input.creado_por_nombre || null,
        },
      ])
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async actualizar(id: string, input: ActualizarInput) {
    if (input.estado && !['Pendiente', 'Ingresada'].includes(input.estado)) {
      throw new BadRequestException('Estado inválido');
    }

    const body: Record<string, any> = {
      actualizado_por_email: input.actualizado_por_email,
      actualizado_por_nombre: input.actualizado_por_nombre || null,
    };
    if (input.estado !== undefined) body.estado = input.estado;
    if (input.observaciones !== undefined) body.observaciones = input.observaciones;

    const { data, error } = await this.supabase
      .getClient()
      .from('bitacora_cotizaciones')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Registro no encontrado');
    return data;
  }

  async eliminar(id: string) {
    const { error } = await this.supabase
      .getClient()
      .from('bitacora_cotizaciones')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true };
  }
}
